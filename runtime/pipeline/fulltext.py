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


def jats_to_markdown(data: bytes) -> str:
    """Render a JATS article as readable Markdown.

    We store this instead of the raw XML: the reader wants a paper they can
    open, and a .xml file shows up as markup (Windows even labels it an "Edge
    HTML Document"). Markdown keeps the section structure the excerpt logic
    relies on while being plain text a person can read.
    """
    try:
        root = ET.fromstring(data)
    except Exception:
        return ""

    def first(path: str) -> str:
        el = root.find(path)
        return _text_of(el) if el is not None else ""

    out: List[str] = []
    title = first(".//article-title")
    if title:
        out.append(f"# {title}\n")

    authors = []
    for c in root.findall(".//contrib"):
        sur, given = c.find(".//surname"), c.find(".//given-names")
        name = " ".join(x.text for x in (given, sur) if x is not None and x.text)
        if name:
            authors.append(name)
    meta = []
    if authors:
        meta.append("**Authors:** " + "; ".join(authors[:12]))
    journal = first(".//journal-title")
    if journal:
        meta.append(f"**Journal:** {journal}")
    for el in root.findall(".//article-id"):
        if el.get("pub-id-type") == "doi" and el.text:
            meta.append(f"**DOI:** {el.text}")
            break
    if meta:
        out.append("\n".join(meta) + "\n")

    abstract = root.find(".//abstract")
    if abstract is not None:
        a = _text_of(abstract)
        if a:
            out.append(f"## Abstract\n\n{a}\n")

    for title_text, body in _sections(root):
        out.append(f"## {title_text or 'Section'}\n\n{body}\n")

    return "\n".join(out).strip()


def markdown_excerpt(path: str, max_chars: int = 3000) -> str:
    """Excerpt a stored Markdown paper, methods/results first."""
    try:
        text = open(path, encoding="utf-8").read()
    except Exception:
        return ""
    blocks: List[tuple[str, str]] = []
    current, buf = "", []
    for line in text.split("\n"):
        if line.startswith("## "):
            if buf:
                blocks.append((current, " ".join(buf).strip()))
            current, buf = line[3:].strip(), []
        elif not line.startswith("# "):
            buf.append(line.strip())
    if buf:
        blocks.append((current, " ".join(buf).strip()))

    parts: List[str] = []
    for title_text, body in sorted(blocks, key=lambda b: _rank(b[0])):
        if not body or sum(len(p) for p in parts) >= max_chars:
            continue
        if len(body) > 900:
            sentences = re.split(r"(?<=[.!?])\s+", body)
            keep = [s for s in sentences if _SUBSTANCE.search(s)] or sentences
            body = " ".join(keep)
        parts.append(f"{title_text.upper() or 'SECTION'}: {body}")
    return "\n".join(parts)[:max_chars].rstrip()


# --------------------------------------------------- positional PDF lines ---
# 2026-08-17 correction: `_pdf_text()` below joins every Tj/TJ show-text
# string in a PDF with a single space, in raw content-stream order — real
# wording for prose, but it structurally destroys a TABLE's own row/column
# layout (a formulation table's "Neem oil 0.5 1.0 1.5 2.0 2.5" becomes
# indistinguishable word-soup mixed in with the rest of the page). This
# section adds a real, deterministic, standard-library-only alternative
# that tracks the SAME PDF content-stream text-positioning operators every
# real PDF renderer already relies on (`Td`/`TD`/`T*` relative moves and
# `Tm` absolute matrix resets) to reconstruct each VISUAL LINE of the page
# as its own line — good enough to keep a scientific formulation table's
# own rows intact. No PDF-parsing dependency added (still stdlib-only,
# `re`/`zlib`), no OCR, no language model of any kind.
_TJ_OP_RE = re.compile(
    rb"\((?:\\.|[^\\()])*+\)\s*Tj"
    rb"|\[(?:\\.|[^\[\]])*+\]\s*TJ"
    rb"|-?[\d.]++\s++-?[\d.]++\s++Td"
    rb"|-?[\d.]++\s++-?[\d.]++\s++TD"
    rb"|T\*"
    rb"|-?[\d.]++\s++-?[\d.]++\s++-?[\d.]++\s++-?[\d.]++\s++-?[\d.]++\s++-?[\d.]++\s++Tm"
)
_PDF_STR_RE = re.compile(rb"\((?:\\.|[^\\()])*+\)")
_TD_NUMS_RE = re.compile(rb"(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]$")
_TM_NUMS_RE = re.compile(
    rb"-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm$"
)


def _decode_pdf_string(raw: bytes) -> str:
    s = raw[1:-1]
    s = re.sub(rb"\\([()\\])", rb"\1", s)
    s = re.sub(rb"\\[0-7]{1,3}", lambda m: bytes([int(m.group(0)[1:], 8) & 0xFF]), s)
    s = s.replace(rb"\n", b" ").replace(rb"\r", b" ").replace(rb"\t", b" ")
    try:
        return s.decode("utf-8", "ignore")
    except Exception:
        return ""


def pdf_lines(path: str, max_chars: int = 400_000) -> List[str]:
    """The PDF's own visual lines, row by row — real positional
    reconstruction, not a flat word-soup join. A `TJ` array's own string
    fragments (one per glyph/kerning run) are joined with no separator
    (a real inter-word space is already its own `( )` fragment inside the
    array); separate text-showing operators are joined with a single
    space. A line boundary fires on a genuine vertical move: `Td`/`TD`'s
    own (tx, ty) is RELATIVE, so `|ty| < 1` is a same-line horizontal
    shift (e.g. aligning a table column) and anything else is a new row;
    `T*` is always a new line; `Tm` is ABSOLUTE, so a new line fires only
    when its own y differs from the previous text run's y. Encrypted or
    purely scanned PDFs yield nothing, same honest fallback `_pdf_text()`
    already has."""
    try:
        raw = open(path, "rb").read()
    except Exception:
        return []

    lines: List[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.S):
        chunk = match.group(1)
        try:
            chunk = zlib.decompress(chunk)
        except Exception:
            continue
        current: List[str] = []
        last_y: float | None = None
        for op in _TJ_OP_RE.finditer(chunk):
            text = op.group(0)
            if text.endswith(b"Tj"):
                m = _PDF_STR_RE.search(text)
                if m:
                    s = _decode_pdf_string(m.group(0))
                    if s.strip():
                        current.append(s)
            elif text.endswith(b"TJ"):
                piece = "".join(_decode_pdf_string(m.group(0)) for m in _PDF_STR_RE.finditer(text))
                if piece.strip():
                    current.append(piece)
            elif text.endswith(b"Td") or text.endswith(b"TD"):
                nums = _TD_NUMS_RE.search(text)
                same_line = False
                if nums:
                    try:
                        same_line = abs(float(nums.group(2))) < 1.0
                    except ValueError:
                        pass
                if current and not same_line:
                    lines.append(" ".join(current))
                    current = []
            elif text == b"T*":
                if current:
                    lines.append(" ".join(current))
                    current = []
            elif text.endswith(b"Tm"):
                nums = _TM_NUMS_RE.search(text)
                if nums:
                    try:
                        y = float(nums.group(2))
                        if last_y is not None and current and abs(y - last_y) > 0.5:
                            lines.append(" ".join(current))
                            current = []
                        last_y = y
                    except ValueError:
                        pass
        if current:
            lines.append(" ".join(current))
        if sum(len(l) for l in lines) > max_chars:
            break

    return [re.sub(r"\s+", " ", l).strip() for l in lines if l.strip()]


def pdf_lines_for(paper: dict, pdf_dir: str, max_chars: int = 400_000) -> List[str]:
    """`pdf_lines()` for a paper whose `pdf_file` we downloaded — `[]` for
    anything that isn't a real, locally-downloaded PDF (an XML/Markdown
    full text has its own real structure already; use `excerpt_for` for
    those)."""
    name = paper.get("pdf_file") or ""
    if not name.endswith(".pdf"):
        return []
    path = os.path.join(pdf_dir, name)
    if not os.path.isfile(path):
        return []
    return pdf_lines(path, max_chars)


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
    if name.endswith(".md"):
        return markdown_excerpt(path, max_chars)
    if name.endswith(".xml"):  # papers stored before the Markdown switch
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
