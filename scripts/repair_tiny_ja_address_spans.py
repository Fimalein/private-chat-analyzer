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



# If a numeric suffix is immediately followed by an ordinary measurement,
# treat it as ambiguous prose rather than silently extending the ADDRESS.
# This deliberately trades recall for less over-redaction.
_PROSE_NUMBER_END = re.compile(
    r"^(?:分|秒|時間|日|週間?|年|回|個|件|人|枚|本|ページ|目|番目|"
    r"km|ｋｍ|m|ｍ|㎞|メートル)"
)
_TITLE_HINTS = ("映画", "短編", "小説", "漫画", "模型", "作品", "題名", "タイトル")


def _in_quoted_work_title(text: str, start: int) -> bool:
    """Do not extend a seeded location inside a clearly indicated work title."""
    prefix = text[:start]
    for opening, closing in (("『", "』"), ("「", "」")):
        left = prefix.rfind(opening)
        if left > prefix.rfind(closing):
            context = prefix[max(0, left - 16):left]
            if any(hint in context for hint in _TITLE_HINTS):
                return True
    return False


def _safe_numeric_extension(rest: str, candidate: str) -> str:
    if candidate and _PROSE_NUMBER_END.match(rest[len(candidate):]):
        return ""
    return candidate


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
        if _in_quoted_work_title(text, start):
            out.append(span)
            continue
        if not _ADMIN_NEAR.search(original):
            out.append(span)
            continue

        extension = ""
        rest = text[end:]
        if _ADMIN_END.search(original):
            match = _NUMBERED.match(rest)
            if match:
                extension = _safe_numeric_extension(rest, match.group(0))
        elif _CHOME_END.search(original) and rest.startswith("丁目"):
            extension = "丁目"
        elif original[-1] in "0123456789０１２３４５６７８９":
            match = _TAIL_NUMBER.match(rest)
            if match:
                extension = _safe_numeric_extension(rest, match.group(0))

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
