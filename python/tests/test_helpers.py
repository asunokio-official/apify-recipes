import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

from asunoki_recipes.catalog import list_presets, load_catalog, load_preset, load_sample, merge_input, parse_url_list
from asunoki_recipes.cli import main
from asunoki_recipes.cost import actual_cost, estimate_cost, format_estimate, normalize_site, usd
from asunoki_recipes.csv_out import get_path, guard_formula, split_rows, to_cell, to_csv
from asunoki_recipes.run import run_recipe

CATALOG = load_catalog()
QUIET = lambda *_: None  # noqa: E731


def mock_client(items=(), status="SUCCEEDED", charged=None, as_model=False):
    """A MagicMock shaped like apify_client.ApifyClient. Never touches the network."""
    client = mock.MagicMock(name="ApifyClient")
    run = {"id": "RUN1", "status": status, "defaultDatasetId": "DS1",
           "chargedEventCounts": charged if charged is not None else {"notice": 2, "apify-actor-start": 1}}
    if as_model:  # apify-client 3.x returns a model with snake_case attributes
        run = mock.Mock(id="RUN1", status=mock.Mock(__str__=lambda s: f"ActorJobStatus.{status}"),
                        default_dataset_id="DS1", charged_event_counts=run["chargedEventCounts"])
    client.actor.return_value.call.return_value = run
    client.dataset.return_value.iterate_items.return_value = iter(list(items))
    return client


class CostTests(unittest.TestCase):
    def test_max_items_estimate(self):
        e = estimate_cost("uk-public-tenders-feed", {"maxItems": 300}, CATALOG)
        self.assertEqual((e["items"], e["itemsCostUsd"], e["startFeeUsd"], e["maxTotalUsd"]), (300, 1.2, 0.00005, 1.20005))

    def test_defaults_and_bool_is_not_int(self):
        self.assertEqual(estimate_cost("nppes-new-providers-feed", {}, CATALOG)["items"], 500)
        self.assertEqual(estimate_cost("nppes-new-providers-feed", {"maxItems": True}, CATALOG)["items"], 500)

    def test_tsd_counts_unique_sites_and_browser_upper_bound(self):
        e = estimate_cost("tech-stack-detector", {"urls": ["https://www.Example.com/", "example.com", "b.com"]}, CATALOG)
        self.assertEqual((e["items"], e["maxTotalUsd"]), (2, 0.01005))
        e = estimate_cost("tech-stack-detector", {"urls": ["a.com"], "alwaysUseBrowser": True}, CATALOG)
        self.assertEqual((e["unitPriceUsd"], e["startFeeUsd"], e["event"]), (0.015, 0.0001, "full-scan"))

    def test_same_numbers_as_node(self):
        # node/test/cost.test.js asserts the same values; keep both ports in step.
        self.assertEqual(estimate_cost("us-building-permits-feed", {}, CATALOG)["maxTotalUsd"], 0.40005)
        self.assertEqual(normalize_site("HTTPS://www.Shop.com/path/?a=1"), "shop.com/path")

    def test_usd_matches_node(self):
        self.assertEqual([usd(x) for x in (0.015, 0.005, 0.40005, 0.6, 1.20005, 0)],
                         ["$0.015", "$0.005", "$0.40005", "$0.60", "$1.20", "$0.00"])

    def test_format_and_actual(self):
        e = estimate_cost("uk-public-tenders-feed", {"maxItems": 100}, CATALOG)
        self.assertIn("Estimate (max): $0.40", format_estimate(e))
        self.assertIn("may stop early", format_estimate(e, 0.1))
        self.assertEqual(actual_cost({"notice": 12, "apify-actor-start": 1}, "uk-public-tenders-feed", CATALOG), 0.04805)
        self.assertIsNone(actual_cost(None, "uk-public-tenders-feed", CATALOG))


class CsvTests(unittest.TestCase):
    def test_get_path(self):
        row = {"a": {"b": 1}, "list": [{"name": "x"}, {}, {"name": "y"}]}
        self.assertEqual(get_path(row, "a.b"), 1)
        self.assertEqual(get_path(row, "list[].name"), ["x", "y"])
        self.assertIsNone(get_path(row, "missing.deep"))

    def test_cells_and_guard(self):
        self.assertEqual(guard_formula("=1+1"), "'=1+1")
        self.assertEqual(guard_formula("-97.7"), "-97.7")
        self.assertEqual(to_cell(["a", "b"]), "a; b")
        self.assertEqual(to_cell({"k": 1}), '{"k":1}')
        self.assertEqual(to_cell(None), "")
        self.assertEqual(to_cell(False), "false")
        self.assertEqual(to_cell(2.0), "2")

    def test_to_csv_matches_node_output(self):
        self.assertEqual(to_csv([{"t": 'a, "b"\nc', "n": 2}], ["t", "n"]), 't,n\r\n"a, ""b""\nc",2\r\n')
        self.assertTrue(to_csv([], ["x"], bom=True).startswith("﻿x"))

    def test_split_rows(self):
        rows, summary = split_rows([{"type": "notice"}, {"type": "summary", "charged": 1}])
        self.assertEqual((len(rows), summary["charged"]), (1, 1))


class PresetTests(unittest.TestCase):
    def test_presets_load_and_merge(self):
        self.assertGreaterEqual(len(list_presets()), 12)
        p = load_preset("tx-dental-new-npis-weekly")
        self.assertEqual(merge_input(p["input"], {"states": ["CA"]})["states"], ["CA"])
        self.assertEqual(p["input"]["states"], ["TX"])
        with self.assertRaises(ValueError):
            load_preset("../catalog")
        with self.assertRaises(ValueError):
            merge_input({}, ["x"])

    def test_parse_url_list(self):
        self.assertEqual(parse_url_list('domain,owner\nshop.com,me\n# c\n\n"b.com",x\r\nc.com'), ["shop.com", "b.com", "c.com"])

    def test_sample_rows_have_catalog_columns(self):
        for key, actor in CATALOG["actors"].items():
            rows = [r for r in load_sample(key)["rows"] if r.get("type") != "summary"]
            for col in actor["columns"]:
                top = col.split(".")[0].replace("[]", "")
                self.assertTrue(any(top in r for r in rows), f"{key}:{col}")


class RunTests(unittest.TestCase):
    def test_real_run_with_mocked_client(self):
        client = mock_client(items=[{"type": "notice", "title": "A"}, {"type": "summary", "charged": 1}])
        factory = mock.Mock(return_value=client)
        r = run_recipe(load_preset("uk-it-tenders-100k-weekly"), CATALOG, overrides={"regions": ["UKM"]},
                       token="test-token-not-real", confirmed=True, client_factory=factory, log=QUIET)
        factory.assert_called_once_with("test-token-not-real")
        client.actor.assert_called_once_with("asunoki/uk-public-tenders-feed")
        kwargs = client.actor.return_value.call.call_args.kwargs
        self.assertEqual(kwargs["run_input"]["regions"], ["UKM"])
        self.assertEqual(kwargs["max_total_charge_usd"], Decimal("1.20005"))
        self.assertEqual(kwargs["memory_mbytes"], 256)
        client.dataset.assert_called_once_with("DS1")
        client.dataset.return_value.iterate_items.assert_called_once_with(clean=True)
        self.assertEqual((len(r["rows"]), r["summary"]["charged"], r["chargedUsd"]), (1, 1, 0.00805))

    def test_model_style_run_object(self):
        client = mock_client(items=[{"type": "permit"}], status="FAILED", as_model=True)
        r = run_recipe(load_preset("sf-adu-permits"), CATALOG, token="t", confirmed=True,
                       client_factory=lambda _t: client, log=QUIET)
        self.assertEqual(r["run"]["status"], "FAILED")
        self.assertEqual(len(r["rows"]), 1)

    def test_dry_run_never_creates_client(self):
        factory = mock.Mock()
        r = run_recipe(load_preset("tx-dental-new-npis-weekly"), CATALOG, dry_run=True, token="x", client_factory=factory, log=QUIET)
        factory.assert_not_called()
        self.assertTrue(r["dryRun"])
        self.assertTrue(all(row["type"] == "provider" for row in r["rows"]))

    def test_guards(self):
        factory = mock.Mock()
        p = load_preset("uk-it-tenders-100k-weekly")
        with self.assertRaisesRegex(ValueError, "APIFY_TOKEN"):
            run_recipe(p, CATALOG, client_factory=factory, log=QUIET)
        with self.assertRaisesRegex(ValueError, "--yes"):
            run_recipe(p, CATALOG, token="t", client_factory=factory, log=QUIET)
        with self.assertRaisesRegex(ValueError, "positive"):
            run_recipe(p, CATALOG, dry_run=True, max_cost_usd=0, log=QUIET)
        with self.assertRaisesRegex(ValueError, "no websites"):
            run_recipe(load_preset("tsd-shopify-prospect-check"), CATALOG, overrides={"urls": []}, token="t",
                       confirmed=True, client_factory=factory, log=QUIET)
        factory.assert_not_called()


class CliTests(unittest.TestCase):
    def test_dry_run_writes_csv_and_json(self):
        with tempfile.TemporaryDirectory() as d:
            code = main(["run", "uk-it-tenders-100k-weekly", "--dry-run", "--out", f"{d}/o.csv", "--json", f"{d}/o.json"],
                        env={}, out=QUIET, log=QUIET)
            self.assertEqual(code, 0)
            csv_text = Path(f"{d}/o.csv").read_bytes().decode("utf-8")
            self.assertTrue(csv_text.startswith("publishedAt,noticeType,title,buyerName"))
            self.assertEqual(len(csv_text.strip().split("\r\n")), 4)
            self.assertTrue(json.loads(Path(f"{d}/o.json").read_text())["dryRun"])

    def test_same_csv_as_node_for_dry_run(self):
        # Both ports must produce byte-identical CSV for the same rows and columns.
        with tempfile.TemporaryDirectory() as d:
            main(["run", "tsd-shopify-prospect-check", "--dry-run", "--out", f"{d}/py.csv"], env={}, out=QUIET, log=QUIET)
            golden = Path(__file__).with_name("golden_tsd_dry_run.csv")
            # The golden file is written by: node node/src/cli.js run tsd-shopify-prospect-check --dry-run --out ...
            self.assertEqual(Path(f"{d}/py.csv").read_bytes(), golden.read_bytes())

    def test_real_run_without_token_fails_cleanly(self):
        self.assertEqual(main(["run", "sf-adu-permits", "--yes"], env={}, client_factory=mock.Mock(), out=QUIET, log=QUIET), 1)

    def test_failed_run_exit_code_2(self):
        client = mock_client(status="FAILED")
        code = main(["run", "sf-adu-permits", "--yes"], env={"APIFY_TOKEN": "not-a-real-token"},
                    client_factory=lambda _t: client, out=QUIET, log=QUIET)
        self.assertEqual(code, 2)

    def test_list(self):
        lines = []
        self.assertEqual(main(["list"], env={}, out=lines.append, log=QUIET), 0)
        self.assertTrue(any(l.startswith("uk-it-tenders-100k-weekly") and "$1.20" in l for l in lines))


if __name__ == "__main__":
    unittest.main()
