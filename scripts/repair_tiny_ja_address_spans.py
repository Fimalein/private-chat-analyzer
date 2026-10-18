"""Conservative address-only boundary expansion (synthetic research spike).

This never creates a new entity and never modifies non-ADDRESS predictions.
It can still include non-PII characters and miss identifiers: NOT an export gate.
Coordinates are original-text Unicode code-point indices (Python/JS parity).
"""
from __future__ import annotations

import re

# Administrative ending is needed for attaching numbered/chome suffixes.
# No hard-coded city/person/company names from the synthetic test set.
_ADMIN_END = re.compile(r"[都道府県市区郡町村]$")
_ADMIN_NEAR = re.compile(r"[都道府県市区郡町村].{0,16}$")
_NUMBERED = re.compile(
    r"^(?:"
    r"[0-9０-９一二三四五六七八九十百千]+丁目"
    r"|[0-9０-９]+(?:[-－‐‑−][0-9０-９]+){1,4}"
    r"|[0-9０-９]+番地?(?:[0-9０-９]+号)?"
    r")"
)
_BUILDING = re.compile(
    r"^[ 　]?[一-龯々ぁ-んァ-ヶーA-Za-z0-9０-９]{1,12}"
    r"(?:ビル|マンション|ハイツ|コーポ|タワー)"
    r"(?:[0-9０-９]{1,4}号室)?"
)
_ROOM = re.compile(r"^[0-9０-９]{1,4}号室$")
_TAIL_NUMBER = re.compile(r"^[-－‐‑−][0-9０-９]+")
_CHOME_END = re.compile(r"[0-9０-９一二三四五六七八九十百千]$")


def repair_address_spans(text: str, spans: list[dict]) -> list[dict]:
    """Return copied spans; append conservative suffixes to predicted addresses.

    This is intentionally limited to already-detected ADDRESS predictions.
    It does NOT strip possible leading particles, infer unseen entities, or
    extend into adjacent prose without a structured suffix pattern.
    """
    out = []
    for item in spans:
        span = item.copy()
        start, end = span["start"], span["end"]
        if span["type"] != "ADDRESS" or not (0 <= start < end <= len(text)):
            out.append(span)
            continue

        original = text[start:end]
        if not _ADMIN_NEAR.search(original):
            out.append(span)
            continue

        extension = ""
        rest = text[end:]
        if _ADMIN_END.search(original):
            match = _NUMBERED.match(rest)
            if match:
                extension = match.group(0)
        elif _CHOME_END.search(original) and rest.startswith("丁目"):
            extension = "丁目"
        elif original[-1] in "0123456789０１２３４５６７８９":
            match = _TAIL_NUMBER.match(rest)
            if match:
                extension = match.group(0)

        # Building can follow either just the administrative place or a
        # complete numeric/chome extension, never unanchored ordinary text.
        next_text = rest[len(extension):]
        if _ADMIN_END.search(original) or extension:
            building = _BUILDING.match(next_text)
            if building:
                extension += building.group(0)

        # If a partial building room was predicted, only extend a directly
        # adjacent final "号室" when its numeric part is inside the prediction.
        # (No standalone non-address expansion.)
        if extension:
            span["end"] = end + len(extension)
            span["value"] = text[start:span["end"]]
        out.append(span)
    return out
