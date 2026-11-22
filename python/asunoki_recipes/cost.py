"""Upper-bound cost estimate from the Actors' pay-per-event prices in catalog.json. Never calls Apify."""
from __future__ import annotations

import math
import re
from typing import Any, Optional


def _r6(n: float) -> float:
    return round(n + 0.0, 6)


def normalize_site(u: str) -> str:
    s = str(u).strip().lower()
    s = re.sub(r"^[a-z]+://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.sub(r"[?#].*$", "", s)
    return s.rstrip("/")


def estimate_cost(actor_key: str, run_input: dict, catalog: dict) -> dict:
    actor = catalog["actors"].get(actor_key)
    if not actor:
        raise ValueError(f'Unknown Actor "{actor_key}" in catalog.json.')
    unit_price = actor["priceUsd"]
    event = actor["event"]
    memory_mb = actor["memoryMb"]
    if actor.get("countFrom") == "urls":
        urls = run_input.get("urls") or []
        items = len({normalize_site(u) for u in urls if normalize_site(u)})
        if run_input.get("alwaysUseBrowser") or run_input.get("browserFallback"):
            unit_price = actor["browserPriceUsd"]
            event = actor["browserEvent"]
            memory_mb = actor["browserMemoryMb"]
        basis = f"{items} unique website(s); blocked, robots-skipped and failed sites are free"
    else:
        mi = run_input.get("maxItems")
        items = mi if isinstance(mi, int) and not isinstance(mi, bool) else actor["defaultMaxItems"]
        basis = f"maxItems cap of {items}; filtered-out and already-seen rows are free, so most runs cost less"
    gb = max(1, math.ceil(memory_mb / 1024))
    start_fee = _r6(catalog["startFeeUsdPerGb"] * gb)
    items_cost = _r6(items * unit_price)
    return {
        "actorKey": actor_key, "actorId": actor["actorId"], "event": event, "unit": actor["unit"],
        "unitPriceUsd": unit_price, "items": items, "itemsCostUsd": items_cost, "startFeeUsd": start_fee,
        "maxTotalUsd": _r6(items_cost + start_fee), "memoryMb": memory_mb, "basis": basis,
    }


def usd(n: float) -> str:
    """$1.20 for amounts of a dollar or more; up to 5 decimals below that ($0.005, $0.40005, $0.60)."""
    if abs(n) >= 1:
        return f"${n:.2f}"
    return "$" + re.sub(r"0{1,3}$", "", f"{n:.5f}")


def format_estimate(est: dict, max_cost_usd: Optional[float] = None) -> str:
    cap = est["maxTotalUsd"] if max_cost_usd is None else max_cost_usd
    lines = [
        f"Actor:          {est['actorId']}",
        f"Price:          {usd(est['unitPriceUsd'])} per {est['unit']} (event \"{est['event']}\") + {usd(est['startFeeUsd'])} start fee",
        f"Estimate (max): {usd(est['maxTotalUsd'])}  ({est['items']} x {usd(est['unitPriceUsd'])} + start fee; {est['basis']})",
        f"Run spend cap:  {usd(cap)} (maxTotalChargeUsd; the Actor stops storing before it would exceed it)",
    ]
    if max_cost_usd is not None and max_cost_usd < est["maxTotalUsd"]:
        lines.append('Note: the cap is below the estimate, so the run may stop early. Rows it did not store stay "new" for the next run.')
    return "\n".join(lines)


def actual_cost(charged_event_counts: Any, actor_key: str, catalog: dict) -> Optional[float]:
    if not isinstance(charged_event_counts, dict):
        return None
    actor = catalog["actors"][actor_key]
    prices = {actor["event"]: actor["priceUsd"], "apify-actor-start": catalog["startFeeUsdPerGb"]}
    if actor.get("browserEvent"):
        prices[actor["browserEvent"]] = actor["browserPriceUsd"]
    return _r6(sum(prices[e] * float(c or 0) for e, c in charged_event_counts.items() if e in prices))
