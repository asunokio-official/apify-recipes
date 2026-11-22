"""Command line: python -m asunoki_recipes {list|show|run} <preset> [options]."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from .catalog import list_presets, load_catalog, load_preset, parse_url_list
from .cost import estimate_cost, format_estimate, usd
from .csv_out import all_columns, to_csv
from .run import default_client_factory, run_recipe


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="asunoki_recipes", description="Run ASUNOKI Apify Actor recipes with a cost estimate first.")
    p.add_argument("command", choices=["list", "show", "run"])
    p.add_argument("preset", nargs="?")
    p.add_argument("--dry-run", action="store_true", help="never contact Apify; use redacted sample rows")
    p.add_argument("--yes", action="store_true", help="confirm a real (paid) run")
    p.add_argument("--out", help="CSV output path (default: stdout)")
    p.add_argument("--json", help="also write rows, summary and cost to this JSON file")
    p.add_argument("--bom", action="store_true", help="add a UTF-8 BOM (Excel)")
    p.add_argument("--all-columns", action="store_true")
    p.add_argument("--max-cost", type=float, help="spend cap in USD for the run (default: the estimate)")
    p.add_argument("--input", help='JSON object that overrides preset input keys, e.g. \'{"states":["CA"]}\'')
    p.add_argument("--urls-file", help="Tech Stack Detector: one domain per line (or first CSV column)")
    return p


def _write(path: str, text: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def main(argv: Optional[list] = None, env: Optional[dict] = None,
         client_factory: Callable[[str], Any] = default_client_factory,
         out: Callable[[str], None] = print, log: Callable[[str], None] = lambda m: print(m, file=sys.stderr)) -> int:
    args = build_parser().parse_args(argv)
    env = os.environ if env is None else env
    catalog = load_catalog()
    try:
        if args.command == "list":
            for p in list_presets():
                est = estimate_cost(p["actor"], p["input"], catalog)
                out(f"{p['id']:<36} {p['actor']:<26} max {usd(est['maxTotalUsd']):<8} {p['title']}")
            return 0
        if not args.preset:
            raise ValueError(f'"{args.command}" needs a preset id. Run "list" to see them.')
        preset = load_preset(args.preset)
        overrides = json.loads(args.input) if args.input else {}
        if args.urls_file:
            overrides["urls"] = parse_url_list(Path(args.urls_file).read_text(encoding="utf-8"))
        if args.command == "show":
            merged = {**preset["input"], **overrides}
            out(json.dumps({**preset, "input": merged}, indent=2))
            out(format_estimate(estimate_cost(preset["actor"], merged, catalog)))
            return 0
        result = run_recipe(preset, catalog, overrides=overrides, dry_run=args.dry_run, confirmed=args.yes,
                            token=env.get("APIFY_TOKEN"), max_cost_usd=args.max_cost,
                            client_factory=client_factory, log=log)
    except (ValueError, RuntimeError, json.JSONDecodeError, OSError) as e:
        log(f"Error: {e}")
        return 1
    actor = catalog["actors"][preset["actor"]]
    columns = all_columns(result["rows"]) if args.all_columns else actor["columns"]
    text = to_csv(result["rows"], columns, bom=args.bom)
    if args.out:
        _write(args.out, text)
        log(f"Wrote {len(result['rows'])} row(s) to {args.out}")
    else:
        out(text)
    if args.json:
        payload = {"preset": preset["id"], "dryRun": result["dryRun"], "input": result["input"], "estimate": result["estimate"],
                   "chargedUsd": result["chargedUsd"], "runId": (result["run"] or {}).get("id"),
                   "summary": result["summary"], "rows": result["rows"]}
        _write(args.json, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    if result["summary"]:
        log("Summary row: " + json.dumps(result["summary"])[:400])
    if not result["dryRun"] and result["chargedUsd"] is not None:
        log(f"Charged (from run events): {usd(result['chargedUsd'])}")
    return 2 if result["run"] and result["run"]["status"] != "SUCCEEDED" else 0


if __name__ == "__main__":
    sys.exit(main())
