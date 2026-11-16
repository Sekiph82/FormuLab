"""Offline MinerU reader output for formula PDFs the app's layout parser reads no formula from.

For every stored formula PDF whose current record has no ingredient lines, run the local MinerU
install (tools/mineru, see tools/mineru/env.sh) and write its tables as OCR-style lines with word
boxes to data/supplier-documents/mineru/<sha256>.json. The app reads that file when it imports the
PDF again and records the result under its own parser version
("formulab-reference-formulation-layout-v10-mineru-card-columns"). Nothing leaves this computer:
MinerU runs on its local server only (no --remote), telemetry off.

Usage (from the repository root, FormuLab closed or idle):
  python scripts/dev/mineru_reader_output.py            # every unread PDF
  python scripts/dev/mineru_reader_output.py --limit 5  # a few, to check
  python scripts/dev/mineru_reader_output.py --rewrite  # also rewrite every cached MinerU output
                                                         # after a converter change (no new MinerU run)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MASTER = os.path.join(ROOT, "data", "master")
STORE = os.path.join(ROOT, "data", "supplier-documents")
TOOL = os.path.join(ROOT, "tools", "mineru")
READER = "mineru-4.2.2-standard"
CHAR_WIDTH, ROW_HEIGHT, GAP = 6, 14, 24
AMOUNT = re.compile(r"^(.*?[A-Za-z].*?)\s+(\d+(?:[.,]\d+)?)\s*%\s*$")
PHASE = re.compile(r"^([A-H]|[IVX]{1,4})\s+(.+)$")


def _plain(text: str) -> str:
    """MinerU writes marks as LaTeX ("ACULYN $^{TM}$"); keep the printed sign."""
    text = re.sub(r"\$\s*\^\s*\{\s*(?:TM|tm)\s*\}\s*\$", "™", text)
    text = re.sub(r"\$\s*\^\s*\{\s*(?:\\textregistered|R|®)\s*\}\s*\$", "®", text)
    return re.sub(r"\$\s*\^\s*\{([^}]*)\}\s*\$", r"\1", text)


class _Tables(HTMLParser):
    """HTML tables as grids, rowspan and colspan cells repeated into every row and column they cover."""

    def __init__(self):
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._rows: list[list[tuple[str, int, int]]] | None = None
        self._cell: list[str] | None = None
        self._span = (1, 1)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "table":
            self._rows = []
        elif tag == "tr" and self._rows is not None:
            self._rows.append([])
        elif tag in ("td", "th") and self._rows:
            self._cell = []
            self._span = (int(attributes.get("rowspan") or 1), int(attributes.get("colspan") or 1))

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._rows:
            self._rows[-1].append((_plain(" ".join("".join(self._cell).split())), *self._span))
            self._cell = None
        elif tag == "table" and self._rows is not None:
            self.tables.append(_grid(self._rows))
            self._rows = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _grid(rows):
    grid: list[list[str]] = []
    pending: dict[tuple[int, int], str] = {}
    for r, cells in enumerate(rows):
        line: list[str] = []
        c = 0
        for text, rowspan, colspan in cells:
            while (r, c) in pending:
                line.append(pending.pop((r, c))); c += 1
            for k in range(colspan):
                line.append(text)
                for down in range(1, rowspan):
                    pending[(r + down, c + k)] = text
            c += colspan
        while (r, c) in pending:
            line.append(pending.pop((r, c))); c += 1
        grid.append(line)
    return grid


def _pipe_tables(text):
    tables, current = [], []
    for line in text.splitlines():
        if line.strip().startswith("|"):
            cells = [_plain(c.strip()) for c in line.strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                current.append(cells)
        elif current:
            tables.append(current); current = []
    return tables + ([current] if current else [])


def _listed_table(text):
    """A formula OCR'd as a list ("- A WATER 53.30%", "- PLANTASENS™ VL", "- Ricinus ... 5.00%")."""
    rows, trade, phase = [], None, ""
    for raw in text.splitlines():
        if not re.match(r"^\s*[-*]\s+", raw):
            continue
        item = _plain(re.sub(r"^\s*[-*]\s+", "", raw).strip())
        match = PHASE.match(item)
        if match:
            phase, item = match.group(1), match.group(2)
        amount = AMOUNT.match(item)
        if amount:
            name, inci = (trade, amount.group(1)) if trade else (amount.group(1), "")
            rows.append([phase, name, inci, amount.group(2)])
            trade, phase = None, ""
        elif re.search(r"[A-Za-z]{3}", item) and not re.search(r"w\s*/\s*w", item, re.I):
            trade = item
    return [["Phase", "Ingredient", "INCI", "% w/w"], *rows] if len(rows) >= 3 else None


def _row_lines(page, rows, top):
    """Grid rows as OCR lines whose word boxes put every cell under its column header."""
    widths = [max((len(r[i]) if i < len(r) else 0) for r in rows) for i in range(max(len(r) for r in rows))]
    xs, x = [], 40
    for width in widths:
        xs.append(x); x += CHAR_WIDTH * max(width, 1) + GAP
    lines = []
    for index, row in enumerate(rows):
        y = top + index * ROW_HEIGHT
        cells = [re.sub(r"%\.$", "%", cell.strip()) for cell in row]
        words = [{"text": cell, "x0": xs[i], "x1": xs[i] + CHAR_WIDTH * len(cell), "y0": y}
                 for i, cell in enumerate(cells) if cell]
        if words:
            lines.append({"pageNumber": page, "text": " ".join(w["text"] for w in words), "words": words})
    return lines, top + len(rows) * ROW_HEIGHT + 3 * ROW_HEIGHT


# "0.20%." : a card may end an amount with a stray period.
AMOUNT_CELL = re.compile(r"^(?:(?:ad|add|to|q\.?\s*s\.?(?:\s*(?:to|ad))?)\s*)?\d+(?:[.,]\d+)?\s*%?\.?$|^(?:ad|add|to)\s*100|^q\.?\s*s\.?$", re.I)
AMOUNT_HEADER = re.compile(r"%|weight|wt\b|amount|quantity|w/w|dose|dosage|inclusion|percent", re.I)
PHASE_CELL = re.compile(r"^(?:[A-H]\d?|[IVX]{1,4})\.?$")


HEADER_WORD = re.compile(r"phase|ingredient|inci|trade|name|function|supplier|product|component", re.I)
# Scanned cards print the trade name and, under it, the INCI name in one cell; OCR joins the two
# lines without a space: "Hostapon® SCI 85 P (Clariant)Sodium Cocoyl Isethionate",
# "Agenajel 21287Zea Mays (Corn) Starch", "Biobranil water solubleWater (Aqua), Propylene Glycol".
SUPPLIER_GLUE = re.compile(r"^(.+?\([A-Z][^()]{1,40}\))([A-Z][A-Za-z0-9].*)$")
WORD_GLUE = re.compile(r"^(\S.*?\s\S*?[a-z0-9])([A-Z][a-z].*)$")


def _without_title_rows(table: list[list[str]]) -> list[list[str]]:
    """Drop the card title printed inside the table above its first formula row
    ("Hair Conditioner/ Treatment | BII/ 2024", "With Octopirox®"): a spanned row with at most
    two distinct texts, no amount and no column-header word."""
    width = max(len(r) for r in table)
    if width < 3:
        return table
    out = list(table)
    while out and not any(AMOUNT_CELL.match(c.strip()) for c in out[0]):
        texts = {c.strip() for c in out[0] if c.strip()}
        if len(texts) > 2 or any(HEADER_WORD.search(t) or AMOUNT_HEADER.search(t) for t in texts):
            break
        out.pop(0)
    return out if len(out) >= 3 else table


def _split_glued(name: str) -> tuple[str, str] | None:
    for pattern in (SUPPLIER_GLUE, WORD_GLUE):
        match = pattern.match(name.strip())
        if match:
            return match.group(1).strip(), match.group(2).strip()
    return None


def _unglued(table: list[list[str]]) -> list[list[str]]:
    """Give the INCI names OCR joined to trade names their own column, when a table has no INCI
    column and at least two of its names are joined this way. Names with nothing joined keep
    their cell and leave the INCI cell empty; no text is dropped."""
    header = table[0]
    if any(re.search(r"inci", cell, re.I) for cell in header):
        return table
    col = next((i for i, cell in enumerate(header) if re.match(r"ingredient|trade|name|product", cell.strip(), re.I)), None)
    if col is None:
        return table
    splits = [(_split_glued(row[col]) if col < len(row) else None) for row in table[1:]]
    if sum(split is not None for split in splits) < 2:
        return table
    out = [header[:col + 1] + ["INCI"] + header[col + 1:]]
    for row, split in zip(table[1:], splits):
        name, inci = split or ((row[col] if col < len(row) else ""), "")
        out.append(row[:col] + [name, inci] + row[col + 1:])
    return out


def _shaped(table: list[list[str]]) -> list[list[str]]:
    """Name the columns a MinerU table leaves unnamed, from what the cells hold. No value changes.

    - an amount header with an empty column of names beside it ("" | Supplier | % by wt): "Ingredient";
    - no header row at all (A | Water | Solvent | ad 100.00 %): a header from the cell contents.
    """
    width = max(len(r) for r in table)
    rows = [r + [""] * (width - len(r)) for r in table]
    columns = list(zip(*rows[1:]))
    amount_col = max(range(width), key=lambda i: sum(bool(AMOUNT_CELL.match(c.strip())) for c in columns[i])) if columns else None
    amounts = sum(bool(AMOUNT_CELL.match(c.strip())) for c in columns[amount_col]) if columns else 0
    named = lambda i: sum(bool(re.search(r"[A-Za-z]{3}", c)) for c in columns[i])
    if any(AMOUNT_HEADER.search(c) for c in rows[0]) and not any(AMOUNT_CELL.match(c.strip()) for c in rows[0]):
        header = list(rows[0])
        if amounts >= 2:
            for i in range(width):
                if not header[i].strip() and i != amount_col and named(i) >= max(2, len(columns[i]) // 2):
                    header[i] = "Ingredient"
                    break
        return [header, *rows[1:]]
    # No header row: the first row is data too.
    columns = list(zip(*rows))
    amount_col = max(range(width), key=lambda i: sum(bool(AMOUNT_CELL.match(c.strip())) for c in columns[i]))
    if sum(bool(AMOUNT_CELL.match(c.strip())) for c in columns[amount_col]) < 3:
        return rows
    header = [""] * width
    header[amount_col] = "% w/w"
    for i in range(width):
        if i != amount_col and sum(bool(PHASE_CELL.match(c.strip())) for c in columns[i] if c.strip()) >= 2 \
                and all(PHASE_CELL.match(c.strip()) for c in columns[i] if c.strip()):
            header[i] = "Phase"
    name_col = next((i for i in range(width) if not header[i] and sum(bool(re.search(r"[A-Za-z]{3}", c)) for c in columns[i]) >= 3), None)
    if name_col is None:
        return rows
    header[name_col] = "Ingredient"
    # The text column after the names on a card is the printed function ("Anionic surfactant").
    function_col = next((i for i in range(name_col + 1, width) if not header[i]
                         and sum(bool(re.search(r"[A-Za-z]{3}", c)) for c in columns[i]) >= 3), None)
    if function_col is not None:
        header[function_col] = "Function"
    return [header, *rows]


def _transposed(table: list[list[str]]) -> list[list[list[str]]]:
    """Formulas as rows and ingredients as columns ("Formulations | Water | DOWANOL PnB | ..."):
    one Ingredient | % w/w table per formula row."""
    head = table[0]
    if not head or not re.match(r"formu-?\s?lations?\b", head[0].strip(), re.I) or len(head) < 4:
        return []
    out = []
    for row in table[1:]:
        values = [(name, row[i]) for i, name in enumerate(head[1:], start=1)
                  if i < len(row) and name.strip() and AMOUNT_CELL.match(row[i].strip())]
        if len(values) >= 2:
            out.append([["Ingredient", "% w/w"], *[[name, value] for name, value in values]])
    return out


def _plausible(table: list[list[str]]) -> bool:
    """A formula, not a property table or a grams recipe: its amount column closes to 100
    ("q.s./ad/to 100") or adds up to about 100 (80-120 %)."""
    header = table[0]
    col = next((i for i, cell in enumerate(header) if cell == "% w/w" or AMOUNT_HEADER.search(cell)), None)
    if col is None:
        return False
    cells = [row[col].strip() for row in table[1:] if col < len(row) and row[col].strip()]
    if any(re.search(r"q\.?\s*s|ad\s*100|add\s*100|to\s*100|balance", cell, re.I) for cell in cells):
        return True
    values = []
    for cell in cells:
        match = re.match(r"^(\d+(?:[.,]\d+)?)", cell)
        if match:
            values.append(float(match.group(1).replace(",", ".")))
    return len(values) >= 2 and 80 <= sum(values) <= 120


def reader_lines(markdown: str) -> list[dict]:
    """MinerU markdown (pages marked "<!-- page N of M -->") as OCR-style lines per page."""
    lines: list[dict] = []
    parts = re.split(r"<!--\s*page\s+(\d+)\s+of\s+\d+\s*-->", markdown)
    pages = [(int(parts[i]), parts[i + 1]) for i in range(1, len(parts) - 1, 2)] or [(1, markdown)]
    for page, text in pages:
        top = 40
        for heading in re.findall(r"^#{1,3}\s+(.+)$", text, re.M)[:3]:
            words = [{"text": heading.strip(), "x0": 40, "x1": 40 + CHAR_WIDTH * len(heading.strip()), "y0": top}]
            lines.append({"pageNumber": page, "text": heading.strip(), "words": words}); top += 2 * ROW_HEIGHT
        parser = _Tables(); parser.feed(text)
        tables = []
        for table in (t for t in parser.tables + _pipe_tables(text) if len(t) >= 3):
            table = _without_title_rows(table)
            tables.extend(_unglued(t) for t in (_transposed(table) or [_shaped(table)]) if _plausible(t))
        listed = _listed_table(text) if not tables else None
        if listed and not _plausible(listed):
            listed = None
        for table in tables + ([listed] if listed else []):
            table_lines, top = _row_lines(page, table, top)
            lines.extend(table_lines)
    return lines


def _unread(master: str) -> list[str]:
    sys.path.insert(0, os.path.join(ROOT, "runtime", "pipeline"))
    from reference_formulation_prior_adapter import _array, _current
    rows = _current(_array(master, "reference_formulations"))
    return sorted({str(r["sourceDocumentHash"]).lower() for r in rows if not r.get("ingredientLines")})


def run(limit: int | None, rewrite: bool = False) -> dict[str, int]:
    env = {**os.environ, "MINERU_HOME": os.path.join(TOOL, "home"), "MINERU_TELEMETRY_DISABLED": "1",
           "HF_HOME": os.path.join(TOOL, "hf"), "MODELSCOPE_CACHE": os.path.join(TOOL, "modelscope"), "MINERU_MODEL_SOURCE": "huggingface"}
    cli = os.path.join(TOOL, "venv", "Scripts", "mineru.exe")
    os.makedirs(os.path.join(STORE, "mineru"), exist_ok=True)
    os.makedirs(os.path.join(TOOL, "out", "docs"), exist_ok=True)
    counts = {"pdfs": 0, "written": 0, "no_formula": 0, "failed": 0}
    digests = _unread(MASTER)
    if rewrite:
        cached = sorted(name[:-3] for name in os.listdir(os.path.join(TOOL, "out", "docs")) if re.fullmatch(r"[0-9a-f]{64}\.md", name))
        digests = list(dict.fromkeys(digests + cached))
    for digest in digests[:limit]:
        pdf = os.path.join(STORE, "sha256", digest[:2], f"{digest}.pdf")
        if not os.path.exists(pdf):
            continue
        counts["pdfs"] += 1
        markdown_path = os.path.join(TOOL, "out", "docs", f"{digest}.md")
        if not os.path.exists(markdown_path):
            result = subprocess.run([cli, "parse", pdf, "--pages", "all", "--tier", "standard", "--wait", "1800", "-o", markdown_path],
                                    env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if result.returncode != 0 or not os.path.exists(markdown_path):
                counts["failed"] += 1
                continue
        lines = reader_lines(open(markdown_path, encoding="utf-8", errors="replace").read())
        sidecar = os.path.join(STORE, "mineru", f"{digest}.json")
        if not any(len(line["words"]) >= 2 for line in lines):
            counts["no_formula"] += 1
            # An earlier output this run no longer accepts must not be read by the app.
            if os.path.exists(sidecar):
                os.remove(sidecar)
            continue
        output = {"schemaVersion": "1.0", "reader": READER, "sourceDocumentHash": digest,
                  "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "lines": lines}
        with open(sidecar, "w", encoding="utf-8") as handle:
            json.dump(output, handle, ensure_ascii=False)
        counts["written"] += 1
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--rewrite", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.limit, args.rewrite)))
