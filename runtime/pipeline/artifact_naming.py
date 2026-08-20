"""FVL-04.026 -- deterministic, cross-platform-safe naming for literature
documents. Python mirror of `packages/shared/src/engine/artifactNaming.ts`,
implementing the SAME frozen contract (`docs/ARTIFACT_NAMING_SPEC.md`).
Both adapters pass the same golden vectors
(`packages/shared/src/engine/artifactNaming.goldenVectors.json`) -- proven
by `test_artifact_naming.py`.

Only literature naming is mirrored here: formulation export naming has no
Python caller anywhere in this codebase (every formulation export path is
TypeScript, `apps/desktop`), so it stays TypeScript-only per the "keep
language-specific adapters minimal" rule -- no unused Python surface.

No LLM/heuristic summarization anywhere in this module -- every rule is a
fixed, deterministic string transform, matching the TypeScript adapter
rule-for-rule.

Known cross-runtime limitation (disclosed, not hidden): truncation slices
by Unicode CODEPOINT here, matching TypeScript's UTF-16 CODE UNIT slicing
for every character in the Basic Multilingual Plane (everything this
literature pipeline's real sources produce). Neither adapter's golden
vectors exercise a character outside the BMP (e.g. an astral emoji), where
the two would diverge by at most one truncation boundary -- disclosed here
rather than solved, since no real input this pipeline handles needs it.
"""

from __future__ import annotations

import re
import unicodedata

_WINDOWS_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')

_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}

_YEAR_RE = re.compile(r"^\d{4}$")
_WS_RUN_RE = re.compile(r"\s+")
_HYPHEN_RUN_RE = re.compile(r"-{2,}")
_EDGE_SEP_RE = re.compile(r"^[-.]+|[-.]+$")
_TRAILING_SEP_RE = re.compile(r"[-.]+$")


def sanitize_filename_component(raw: str | None, max_length: int = 60) -> str:
    """Sanitizes ONE filename component -- never a display title, which
    stays human Unicode text untouched."""
    s = unicodedata.normalize("NFC", raw or "")
    s = _WINDOWS_ILLEGAL.sub("", s)
    s = _WS_RUN_RE.sub(" ", s).strip()
    s = s.replace(" ", "-")
    s = _HYPHEN_RUN_RE.sub("-", s)
    s = _EDGE_SEP_RE.sub("", s)
    if len(s) > max_length:
        s = _TRAILING_SEP_RE.sub("", s[:max_length])
    if s.upper() in _RESERVED_NAMES:
        s = f"{s}-file"
    return s


def sanitize_id_component(raw: str | None) -> str:
    """Sanitizes a STABLE identifier component (a DOI or another external
    source id) -- DOI slashes map to `-`, kept recognizable, never dropped."""
    s = (raw or "").strip()
    s = s.replace("/", "-")
    s = _WINDOWS_ILLEGAL.sub("", s)
    s = _EDGE_SEP_RE.sub("", s)
    if not s:
        return "UNKNOWN-ID"
    if s.upper() in _RESERVED_NAMES:
        s = f"{s}-id"
    return s


def literature_display_title(first_author: str | None, year: str | int | None, title: str | None) -> str:
    """Human-readable, NEVER sanitized -- kept separate from the physical filename."""
    author = (first_author or "").strip() or "Unknown Author"
    year_s = str(year if year is not None else "").strip() or "n.d."
    title_s = (title or "").strip() or "Untitled"
    return f"{author} ({year_s}) — {title_s}"


def literature_filename(
    first_author: str | None,
    year: str | int | None,
    title: str | None,
    stable_source_id: str,
    extension: str,
) -> str:
    year_raw = str(year if year is not None else "").strip()
    year_s = year_raw if _YEAR_RE.match(year_raw) else "UnknownYear"
    author_raw = (first_author or "").strip()
    author = (sanitize_filename_component(author_raw, 40) or "UnknownAuthor") if author_raw else "UnknownAuthor"
    short_title = sanitize_filename_component(title or "", 60) or "Untitled"
    source_id = sanitize_id_component(stable_source_id)
    ext = (extension or "pdf").lstrip(".").lower()
    return f"LIT_{year_s}_{author}_{short_title}_{source_id}.{ext}"
