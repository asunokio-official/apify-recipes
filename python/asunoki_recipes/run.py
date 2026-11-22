"""Runs one preset: estimate -> (dry run with sample data | Actor run with a spend cap) -> rows + summary."""
from __future__ import annotations

import sys
from decimal import Decimal
from typing import Any, Callable, Optional

from .catalog import load_sample, merge_input
from .cost import actual_cost, estimate_cost, format_estimate
from .csv_out import split_rows


def default_client_factory(token: str) -> Any:
    from apify_client import ApifyClient  # imported lazily: dry runs and tests do not need the package

    return ApifyClient(token)


def _field(obj: Any, camel: str, snake: str) -> Any:
    """apify-client 2.x returns run dicts (camelCase); 3.x returns models (snake_case attributes)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(camel)
    return getattr(obj, snake, None)


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def run_recipe(
    preset: dict,
    catalog: dict,
    overrides: Optional[dict] = None,
    dry_run: bool = False,
    confirmed: bool = False,
    token: Optional[str] = None,
    max_cost_usd: Optional[float] = None,
    client_factory: Callable[[str], Any] = default_client_factory,
    log: Callable[[str], None] = _log,
) -> dict:
    actor = catalog["actors"].get(preset["actor"])
    if not actor:
        raise ValueError(f'Preset "{preset["id"]}" uses unknown Actor "{preset["actor"]}".')
    run_input = merge_input(preset["input"], overrides)
    est = estimate_cost(preset["actor"], run_input, catalog)
    if max_cost_usd is not None and not max_cost_usd > 0:
        raise ValueError("--max-cost must be a positive number.")
    cap = est["maxTotalUsd"] if max_cost_usd is None else max_cost_usd
    log(format_estimate(est, max_cost_usd))

    if dry_run:
        sample = load_sample(preset["actor"])
        log("Dry run: Apify was not contacted. Rows below are redacted real sample rows, not results for your filters.")
        rows, summary = split_rows(sample["rows"])
        return {"dryRun": True, "input": run_input, "estimate": est, "rows": rows, "summary": summary, "run": None, "chargedUsd": 0}
    if not token:
        raise ValueError("APIFY_TOKEN is not set. Use --dry-run to try the recipe without an Apify account.")
    if not confirmed:
        raise ValueError(f"Not started: this run can cost up to ${cap}. Re-run with --yes to start it, or --dry-run to preview.")
    if est["items"] == 0:
        raise ValueError("Nothing to do: the input has no websites.")

    client = client_factory(token)
    log(f"Starting {actor['actorId']} ...")
    run = client.actor(actor["actorId"]).call(
        run_input=run_input, max_total_charge_usd=Decimal(str(cap)), memory_mbytes=est["memoryMb"]
    )
    if run is None:
        raise RuntimeError("The Actor run did not return run details.")
    dataset_id = _field(run, "defaultDatasetId", "default_dataset_id")
    items = list(client.dataset(dataset_id).iterate_items(clean=True))
    status = str(_field(run, "status", "status") or "")
    status = status.split(".")[-1].upper()  # enum repr in 3.x, plain string in 2.x
    charged = _field(run, "chargedEventCounts", "charged_event_counts")
    charged_usd = actual_cost(charged if isinstance(charged, dict) else None, preset["actor"], catalog)
    log(f"Run {_field(run, 'id', 'id')} finished with status {status}; {len(items)} dataset item(s).")
    if status != "SUCCEEDED":
        log("The run did not succeed. Rows stored before the failure are still written; see the summary row and the run log in Apify Console.")
    rows, summary = split_rows(items)
    return {"dryRun": False, "input": run_input, "estimate": est, "rows": rows, "summary": summary,
            "run": {"id": _field(run, "id", "id"), "status": status}, "chargedUsd": charged_usd}
