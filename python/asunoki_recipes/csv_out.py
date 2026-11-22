"""Flat, spreadsheet-safe CSV from Actor dataset rows (same rules as node/src/csv.js)."""
from __future__ import annotations

import csv
import io
import json
import re
from typing import Any, Iterable, Optional

_NUMERIC = re.compile(r"^-?\d+(\.\d+)?([eE][-+]?\d+)?$")


def get_path(obj: Any, path: str) -> Any:
    parts = str(path).split(".")
    cur = obj
    for i, part in enumerate(parts):
        if cur is None:
            return None
        if part.endswith("[]"):
            arr = cur.get(part[:-2]) if isinstance(cur, dict) else None
            if not isinstance(arr, list):
                return None
            rest = ".".join(parts[i + 1:])
            return [v for v in (get_path(el, rest) for el in arr) if v is not None] if rest else arr
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def guard_formula(text: str) -> str:
    if text == "" or _NUMERIC.match(text):
        return text
    return "'" + text if text[0] in "=+-@\t\r" else text


def _json(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def to_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return guard_formula("; ".join(_json(v) if isinstance(v, (dict, list)) else to_cell_plain(v) for v in value))
    if isinstance(value, dict):
        return guard_formula(_json(value))
    if isinstance(value, (int, float)):
        return to_cell_plain(value)
    return guard_formula(str(value))


def to_cell_plain(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return "" if v is None else str(v)


def all_columns(rows: Iterable[dict]) -> list[str]:
    seen: dict = {}
    for r in rows:
        for k in r:
            seen.setdefault(k, None)
    return list(seen)


def to_csv(rows: list[dict], columns: list[str], bom: bool = False) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(columns)
    for row in rows:
        w.writerow([to_cell(get_path(row, c)) for c in columns])
    return ("﻿" if bom else "") + buf.getvalue()


def split_rows(items: Iterable[dict]) -> tuple[list[dict], Optional[dict]]:
    rows, summaries = [], []
    for it in items:
        (summaries if isinstance(it, dict) and it.get("type") == "summary" else rows).append(it)
    return rows, (summaries[-1] if summaries else None)
