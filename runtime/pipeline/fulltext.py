"""Read the full texts we downloaded, so a formulation rests on the papers
themselves rather than on their abstracts.

Europe PMC serves open-access articles as JATS XML, which is structured: the
body is a tree of <sec> elements with titles. That lets us pull the parts that
actually decide a formulation — what was made, at what concentration, and what
happened — instead of feeding an entire 100 KB article to the model and burying
the useful lines.

Stdlib only (xml.etree), same as the rest of the pipeline.
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
import zlib
from typing import List

# Section titles worth reading for formulation work, best first. A paper's
# methods say what was actually mixed; results say whether it worked.
_SECTION_PRIORITY = (
    "material", "method", "formulation", "composition", "preparation",
    "experimental", "result", "discussion", "conclusion", "introduction",
)

# Lines that carry formulation substance: a quantity, a concentration, a pH.
_SUBSTANCE = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:%|wt|w/w|w/v|ppm|mg/|g/|mmol|mol/|µg|ug/)|"
    r"\bpH\s*\d|\bconcentration\b|\bformulation\b|\bcontaining\b)",
    re.I,
)


def _text_of(el: ET.Element) -> str:
    """All descendant text, tags stripped, whitespace collapsed."""
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def _sections(root: ET.Element) -> List[tuple[str, str]]:
    """(title, text) for each body section; untitled sections keep an empty title."""
    out: List[tuple[str, str]] = []
    body = root.find(".//body")
    if body is None:
        return out
    for sec in body.iter("sec"):
        title_el = sec.find("title")
        title = _text_of(title_el) if title_el is not None else ""
        # Only the section's own paragraphs, so a parent doesn't repeat its children.
        paras = [_text_of(p) for p in sec.findall("p")]
        text = " ".join(t for t in paras if t)
        if text:
            out.append((title, text))
    return out


def _rank(title: str) -> int:
    t = title.lower()
    for i, key in enumerate(_SECTION_PRIORITY):
        if key in t:
            return i
    return len(_SECTION_PRIORITY)


def excerpt(path: str, max_chars: int = 3000) -> str:
    """A formulation-relevant excerpt of one downloaded article.

    Sections are ordered by how much they usually say about composition, and
    within the budget we favour sentences that carry a quantity or a
    concentration — the lines a formulator would actually copy.
    """
    try:
        root = ET.parse(path).getroot()
    except Exception:
        return ""

    parts: List[str] = []
    abstract = root.find(".//abstract")
    if abstract is not None:
        a = _text_of(abstract)
        if a:
            parts.append(f"ABSTRACT: {a}")

    for title, text in sorted(_sections(root), key=lambda s: _rank(s[0])):
        if sum(len(p) for p in parts) >= max_chars:
            break
        # Prefer the substantive sentences when a section is long.
        if len(text) > 900:
            sentences = re.split(r"(?<=[.!?])\s+", text)
            keep = [s for s in sentences if _SUBSTANCE.search(s)] or sentences
            text = " ".join(keep)
        parts.append(f"{title.upper() or 'SECTION'}: {text}")

    joined = "\n".join(parts)
    return joined[:max_chars].rstrip()


def _pdf_text(path: str, max_chars: int) -> str:
    """Pull readable text out of a PDF using only the standard library.

    A PDF's text lives in compressed content streams; each stream holds show-text
    operators whose arguments are the literal strings drawn on the page. Decoding
    those gets us the wording — enough to read concentrations and method text —
    without taking on a PDF-parsing dependency for what is a minority of
    downloads. Encrypted or purely scanned PDFs yield nothing, and that is fine:
    the paper falls back to its abstract.
    """
    try:
        raw = open(path, "rb").read()
    except Exception:
        return ""

    out: List[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.S):
        chunk = match.group(1)
        try:
            chunk = zlib.decompress(chunk)
        except Exception:
            continue  # not Flate-compressed (or an image); skip it
        # Text-showing operators: (literal) Tj / TJ, and arrays of them.
        for tm in re.finditer(rb"\((?:\\.|[^\\()])*\)", chunk):
            s = tm.group(0)[1:-1]
            s = re.sub(rb"\\([()\\])", rb"\1", s)
            s = s.replace(rb"\n", b" ").replace(rb"\r", b" ").replace(rb"\t", b" ")
            try:
                text = s.decode("utf-8", "ignore")
            except Exception:
                continue
            if text.strip():
                out.append(text)
        if sum(len(t) for t in out) > max_chars * 4:
            break

    text = re.sub(r"\s+", " ", " ".join(out)).strip()
    # Below this, we got glyph soup rather than prose — not worth showing.
    return text if len(text) > 200 else ""


def excerpt_for(paper: dict, pdf_dir: str, max_chars: int = 3000) -> str:
    """Excerpt for a paper whose full text we downloaded, XML or PDF."""
    name = paper.get("pdf_file") or ""
    path = os.path.join(pdf_dir, name)
    if not name or not os.path.isfile(path):
        return ""
    if name.endswith(".xml"):
        return excerpt(path, max_chars)
    if name.endswith(".pdf"):
        # Prefer the sections we can identify; a PDF gives us flat text, so lead
        # with the substantive sentences rather than the title page.
        text = _pdf_text(path, max_chars)
        if not text:
            return ""
        sentences = re.split(r"(?<=[.!?])\s+", text)
        keep = [s for s in sentences if _SUBSTANCE.search(s)]
        body = " ".join(keep) if len(" ".join(keep)) > 400 else text
        return body[:max_chars].rstrip()
    return ""
