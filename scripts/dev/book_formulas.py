"""Split formulation handbooks into one citable PDF per formula for the folder import.

Owner decision 2026-11-16: the owner bought these books and may use their formulas.
A handbook prints many formulas per page; the reference importer reads one
formula per PDF. This tool finds each "% by weight" table, reads its title,
ingredient lines, procedure and SOURCE line, and writes a small PDF that cites
the book, its SHA-256 and the PDF page. Scanned-text digits are repaired only
by fixed rules ("30 00" -> 30.00, "69,OO" -> 69.00, "1 .o" -> 1.0); a line whose
amount does not survive those rules keeps its name with no amount (missing stays
missing). Output: data/book-formulas/<book>/Formulations/<chapter>/<n>_<title>.pdf

Usage: python scripts/dev/book_formulas.py <book.pdf> "<book folder name>"
"""
from __future__ import annotations

import hashlib
from collections import Counter
from difflib import get_close_matches
import os
import re
import sys

import pdfplumber
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HEADER = re.compile(r"%\s*(?:by|8y)\s*w(?:ei|el)ght|%\s*w/?w|\b(?:raw materials|ingredients)\b.*%", re.I)
SOURCE = re.compile(r"^\s*SOURCE\s*[:;]", re.I)
PROCEDURE = re.compile(r"^\s*(?:procedure|preparation|method of (?:manufacture|preparation)|directions|instructions)\b", re.I)
PHASE = re.compile(r"^\s*(?:(?:part|phase)\s+)?[A-H](?:[.:)]|\s)\s*(?=[A-Za-z(0-9])", re.I)
AMOUNT = re.compile(r"\s((?:\d[\dOo]*(?:\s?[.,]\s?[\dOo]+|\s[\dOo]{2})?)|q\.?\s?s\.?(?:\s?to\s?100)?|to\s?100)\s*%?\s*$", re.I)
CHAPTER = re.compile(r"^(?P<chapter>[A-Z][A-Za-z’'&,@ -]{2,60}?)\s+\d{1,4}$")


def repair_amount(raw: str) -> str | None:
    """Fixed digit repairs for scanned tables; None when the text is not a percentage."""
    text = raw.strip()
    if re.fullmatch(r"q\.?\s?s\.?(?:\s?to\s?100)?|to\s?100", text, re.I):
        return "q.s."
    if re.fullmatch(r"[\d\s.,Oo]+", text) and re.search(r"\d", text):
        text = re.sub(r"[Oo]", "0", text)
    text = re.sub(r"\s*[.,]\s*", ".", text)
    text = re.sub(r"^(\d+)\s+(\d{2})$", r"\1.\2", text)
    if not re.fullmatch(r"\d{1,3}(?:\.\d{1,4})?", text):
        return None
    return text if float(text) <= 100 else None


def is_title(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) >= 0.8 and not HEADER.search(line)


def formulas(pages: list[list[str]]):
    chapter = "General"
    for number, lines in enumerate(pages, 1):
        if lines and (match := CHAPTER.match(lines[0].strip())) and "Formulation" not in lines[0]:
            chapter = match.group("chapter").strip()
        index = 0
        while index < len(lines):
            if not HEADER.search(lines[index]):
                index += 1
                continue
            title_lines = []
            back = index - 1
            while back >= 0 and is_title(lines[back]) and len(title_lines) < 2:
                title_lines.insert(0, lines[back].strip())
                back -= 1
            rows, procedure, source = [], [], ""
            cursor = index + 1
            in_procedure = False
            while cursor < len(lines):
                line = lines[cursor].strip()
                if HEADER.search(line) or (is_title(line) and cursor + 2 < len(lines)
                                           and any(HEADER.search(nxt) for nxt in lines[cursor + 1:cursor + 3])):
                    break
                if SOURCE.match(line):
                    source = line
                    cursor += 1
                    break
                if PROCEDURE.match(line):
                    in_procedure = True
                if in_procedure:
                    procedure.append(line)
                elif line and line not in {",", "."}:
                    match = AMOUNT.search(" " + line)
                    amount = repair_amount(match.group(1)) if match else None
                    name = PHASE.sub("", (" " + line)[:match.start()] if match else line).strip(" .,:-")
                    if name and re.search(r"[A-Za-z]{2}", name):
                        rows.append((name, amount))
                cursor += 1
            while rows and rows[-1][1] is None:  # notes after the table ("Mix A, add B.")
                rows.pop()
            if title_lines and sum(1 for _, amount in rows if amount) >= 2:
                yield {"page": number, "chapter": chapter, "title": " ".join(title_lines),
                       "rows": rows, "procedure": procedure, "source": source}
            index = cursor


def write_pdf(path: str, formula: dict, book: str, digest: str) -> None:
    pdf = canvas.Canvas(path, pagesize=A4)
    y = 800

    def line(text: str, x: int = 50, size: int = 10) -> None:
        nonlocal y
        if y < 60:
            pdf.showPage()
            y = 800
        pdf.setFont("Helvetica", size)
        pdf.drawString(x, y, text[:110])

    line(formula["title"], size=13)
    y -= 20
    line(f"{book} - PDF page {formula['page']} - book SHA-256 {digest[:16]}")
    y -= 14
    line(f"Category: {formula['chapter']}")
    y -= 22
    line("Ingredient")
    line("% w/w", x=430)
    y -= 16
    for name, amount in formula["rows"]:
        line(name)
        if amount:
            line(amount, x=430)
        y -= 15
    y -= 10
    for text in formula["procedure"]:
        line(text)
        y -= 14
    if formula["source"]:
        y -= 6
        line(formula["source"])
        y -= 14
    y -= 8
    line("Published handbook formula (owner-purchased copy); amounts read from scanned text with fixed digit repairs.", size=8)
    pdf.save()


def main(book_path: str, book_name: str) -> None:
    with open(book_path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    with pdfplumber.open(book_path) as document:
        pages = [(page.extract_text() or "").split("\n") for page in document.pages]
    out_root = os.path.join(ROOT, "data", "book-formulas", book_name, "Formulations")
    found = list(formulas(pages))
    # Scanned running heads misspell chapters ("Perjhrnes"); rare spellings join the closest common one.
    counts = Counter(formula["chapter"] for formula in found)
    common = [chapter for chapter, total in counts.items() if total >= 20]
    for formula in found:
        if counts[formula["chapter"]] < 20:
            formula["chapter"] = (get_close_matches(formula["chapter"], common, n=1, cutoff=0.6) or [formula["chapter"]])[0]
    count = 0
    for count, formula in enumerate(found, 1):
        folder = os.path.join(out_root, re.sub(r"[^A-Za-z0-9 &-]+", "", formula["chapter"]).strip() or "General")
        os.makedirs(folder, exist_ok=True)
        slug = re.sub(r"[^A-Za-z0-9]+", "_", formula["title"]).strip("_")[:60]
        write_pdf(os.path.join(folder, f"{count:04d}_{slug}.pdf"), formula, book_name, digest)
    print(f"{count} formulas written to {out_root}")


if __name__ == "__main__":
    assert repair_amount("30 00") == "30.00" and repair_amount("69,OO") == "69.00" and repair_amount("1 ,oo") == "1.00"
    assert repair_amount("1 .o") == "1.0" and repair_amount("QS") == "q.s." and repair_amount("250") is None
    main(sys.argv[1], sys.argv[2])
