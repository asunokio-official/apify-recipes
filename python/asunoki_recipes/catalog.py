"""Shared catalog (prices, columns), presets and redacted samples, read from the repository root."""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
_PRESET_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_catalog(root: Path = REPO_ROOT) -> dict:
    return _read(root / "catalog.json")


def list_presets(root: Path = REPO_ROOT) -> list[dict]:
    return [_read(p) for p in sorted((root / "presets").glob("*.json"))]


def load_preset(preset_id: str, root: Path = REPO_ROOT) -> dict:
    if not _PRESET_ID.match(str(preset_id)):
        raise ValueError(f'Invalid preset id "{preset_id}". Use lowercase letters, digits and dashes.')
    path = root / "presets" / f"{preset_id}.json"
    if not path.exists():
        raise ValueError(f'Unknown preset "{preset_id}". Run "list" to see the presets.')
    preset = _read(path)
    if preset.get("id") != preset_id:
        raise ValueError(f'Preset file {preset_id}.json has id "{preset.get("id")}".')
    return preset


def load_sample(actor_key: str, root: Path = REPO_ROOT) -> dict:
    return _read(root / "samples" / f"{actor_key}.json")


def merge_input(base: dict, overrides: Any = None) -> dict:
    overrides = {} if overrides is None else overrides
    if not isinstance(overrides, dict):
        raise ValueError('Input overrides must be a JSON object, e.g. {"states":["CA"]}.')
    merged = copy.deepcopy(base)
    merged.update(copy.deepcopy(overrides))
    return merged


def parse_url_list(text: str) -> list[str]:
    out = []
    for line in str(text).splitlines():
        v = line.split(",")[0].strip().strip('"')
        if v and not v.startswith("#") and v.lower() not in ("url", "domain", "website"):
            out.append(v)
    return out
