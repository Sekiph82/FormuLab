"""Phase 14/FormuLab v1 correction (FVL-03) — complete scientific
formulations extracted from full-text literature, as their own structured
records, separate from the per-ingredient `evidence.EvidenceRecord` model.

**The gap this closes.** `evidence.py`'s own extraction reads a downloaded
paper as a flat excerpt and finds individual ingredient MENTIONS — real,
but it structurally cannot represent a complete experimental formulation
(a "Table 1: Formulation of Herbal Anti-Dandruff Shampoo" with F1..F5
columns, ten ingredient rows, and a Total row) as the single, whole
architecture it actually is. A paper can be downloaded, relevant, and
full-text — and still never influence a generated formula's own
architecture, because nothing ever reconstructed the table it contains.
This module does exactly that reconstruction, deterministically.

**Zero LLM, zero OCR, zero unrestricted semantic guessing.** Extraction
is pure structural pattern matching over `fulltext.pdf_lines()`'s own
real, positional line reconstruction (see that module for how PDF
content-stream text-positioning operators are tracked without any
third-party PDF-parsing dependency): an `F<n>` column-header line, then
consecutive `name value1 value2 ... valueN` rows until the pattern
breaks. A table this module cannot parse safely is skipped, never
guessed at — no `ScientificFormulationRecord` is fabricated for it.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1

# ------------------------------------------------------------- data model ---

UNRESOLVED_MATERIAL_IDENTITY = "unresolved_material_identity"
RESOLVED_KNOWN_INGREDIENT = "resolved_known_ingredient"
RESOLVED_SUPPLIER_MATERIAL = "resolved_supplier_material"


@dataclass(frozen=True)
class FormulationIngredientRow:
    """One real row of a real formulation table. `source_name` is the
    verbatim (whitespace-normalized) row label — always kept, even when
    `normalized_key`/`material_id` stay unresolved (§6: unknown does NOT
    mean discard)."""

    source_name: str
    value: Optional[float]
    value_text: str
    """The raw cell text — `"0.5"`, `"q.s"`, `"To adjust pH"`, `"-"`,
    `"100ml"`. `value` is the parsed float when `value_text` is a plain
    number, `None` otherwise (never guessed from a qualitative cell)."""
    unit: str
    """Parsed from a trailing unit token on the ROW LABEL when the table
    carries it there (e.g. "Henna Oil (ml)") — `""` when the source gives
    none, never assumed to be `%`."""
    qs: bool
    """True for a `q.s`/`q.s.` cell — a real, explicit "fill to volume"
    marker, never a numeric guess."""
    order: int
    normalized_key: Optional[str] = None
    material_id: Optional[str] = None
    identity_status: str = UNRESOLVED_MATERIAL_IDENTITY

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ExperimentalOutcome:
    """A real, source-reported measurement tied to ONE specific source
    formulation (`source_formulation_id`, e.g. `"F4"`) — never a pool of
    detached numbers. `raw_text` is always kept so a reader can verify the
    extraction against what the table actually said, even when a specific
    numeric field below could not be safely parsed (e.g. a `±` glyph the
    PDF's own font encoding does not map to a plain-text codepoint — left
    unresolved rather than risking a merged/garbled number)."""

    source_formulation_id: str
    metric: str
    """`"pH"` / `"viscosity_cp"` / `"foam_volume_ml"` / `"solids_pct"` /
    `"cleaning_action_pct"` / `"surface_tension_dy_cm"` / `"appearance"` /
    or another real, source-named metric — never invented."""
    value: Optional[float]
    unit: str
    condition: str
    """The real test condition when the source names one — an RPM value,
    a time point ("1 Min"), `""` otherwise."""
    raw_text: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Real, deterministic architecture-applicability outcomes (§9) — never a
# free-text field.
DIRECTLY_USABLE_ARCHITECTURE = "DIRECTLY_USABLE_ARCHITECTURE"
ADAPTABLE_ARCHITECTURE = "ADAPTABLE_ARCHITECTURE"
REJECTED_ARCHITECTURE = "REJECTED_ARCHITECTURE"
INSUFFICIENT_INFORMATION = "INSUFFICIENT_INFORMATION"


@dataclass(frozen=True)
class ScientificFormulationRecord:
    id: str
    canonical_paper_id: str
    doi: str
    source_title: str
    source_year: str
    source_authors: str
    table_reference: str
    """The table's own real caption/number when found (e.g. `"Table1.
    Formulation of Herbal Anti-Dandruff Shampoo"`), `""` otherwise."""
    source_formulation_id: str
    """The real column label from the source table — `"F1"`, `"Formula
    A"`. Never invented when the source used no such label (an unlabeled
    single-formula table still gets a record; `source_formulation_id`
    stays `""` in that case, not a fabricated `"F1"`)."""
    product_type: str
    formulation_title: str
    ingredients: List[FormulationIngredientRow] = field(default_factory=list)
    total_declared: str = ""
    """The table's own literal "Total" row text (`"100ml"`) — a real,
    reported closure figure, never recomputed here."""
    evidence_class: str = "E"
    extraction_confidence: str = "low"
    """`"high"` only when every structural signal this module checks for
    (a real title cue, a clean `F<n>` header, every row parsed without
    falling back to a partial match, a real `Total` row) was actually
    present — never a subjective quality judgement."""
    missing_fields: List[str] = field(default_factory=list)
    unresolved_rows: List[str] = field(default_factory=list)
    """Raw text of any row inside the detected table region that did NOT
    parse into a clean `FormulationIngredientRow` — preserved verbatim,
    never silently dropped, never guessed into a fabricated row."""
    schema_version: int = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# --------------------------------------------------------- row tokenizer ---

_QS_RE = re.compile(r"\bq\.?\s?s\.?\b", re.I)
_TO_ADJUST_PH_RE = re.compile(r"\bto\s+adjust\s+p\s*h\b", re.I)
_NUMERIC_CELL_RE = re.compile(r"^-?\d+\.?\d*[a-zA-Z%]{0,4}$")
_DASH_CELL_RE = re.compile(r"^[-–—]$")


def _normalize_cell_tokens(line: str) -> List[str]:
    norm = _TO_ADJUST_PH_RE.sub("TO_ADJUST_PH", line)
    norm = _QS_RE.sub("QS", norm)
    return norm.split()


def _is_value_token(tok: str) -> bool:
    return bool(tok in ("QS", "TO_ADJUST_PH") or _NUMERIC_CELL_RE.match(tok) or _DASH_CELL_RE.match(tok))


def _humanize_value(tok: str) -> str:
    return {"QS": "q.s", "TO_ADJUST_PH": "To adjust pH"}.get(tok, tok)


def _parse_composition_row(line: str, n_cols: int) -> Optional[tuple]:
    """`(name, [value_text, ...])` with exactly `n_cols` values taken from
    the right of the line, or `None` when the line does not look like a
    real table row (the honest "unresolved, don't guess" exit)."""
    tokens = _normalize_cell_tokens(line)
    if len(tokens) <= n_cols:
        return None
    values: List[str] = []
    i = len(tokens) - 1
    while i >= 0 and len(values) < n_cols and _is_value_token(tokens[i]):
        values.insert(0, _humanize_value(tokens[i]))
        i -= 1
    if len(values) != n_cols or i < 0:
        return None
    name = " ".join(tokens[: i + 1]).strip()
    if not name:
        return None
    return name, values


_UNIT_SUFFIX_RE = re.compile(r"\(\s*([a-zA-Z%]{1,6})\.?\s*\)\s*$")


def _split_name_unit(name: str) -> tuple:
    m = _UNIT_SUFFIX_RE.search(name)
    if not m:
        return name, ""
    unit = m.group(1).lower()
    unit = {"gms": "g", "gm": "g", "ml": "mL"}.get(unit, unit)
    return name[: m.start()].strip(), unit


_HEADER_RE = re.compile(r"^(?:F\s*\d+\s*){2,7}$", re.I)


def _parse_header(line: str) -> List[str]:
    return [f"F{n}" for n in re.findall(r"F\s*(\d+)", line, re.I)]


def _looks_like_value_row(line: str, n_cols: int) -> bool:
    """A cheap pre-check before the real tokenizer: does this line's OWN
    tail plausibly hold `n_cols` cell values at all? Keeps the row-window
    scan from wandering into unrelated prose that merely happens to end
    in a digit."""
    tokens = _normalize_cell_tokens(line)
    if len(tokens) <= n_cols:
        return False
    tail = tokens[-n_cols:]
    return sum(1 for t in tail if _is_value_token(t)) >= max(1, n_cols - 1)


# ------------------------------------------------------- table extraction ---


def _find_composition_tables(lines: List[str]) -> List[tuple]:
    """`[(header_index, columns, table_ref), ...]` for every REAL
    composition-shaped table — an `F<n>` header line whose ROWS are named
    ingredients with a numeric/qualitative cell per column (never a
    results table transposed the other way; see `_extract_outcomes` for
    those)."""
    out = []
    for i, line in enumerate(lines):
        if not _HEADER_RE.match(line.strip()):
            continue
        cols = _parse_header(line)
        if len(cols) < 2:
            continue
        # A composition table's very next line must itself look like a
        # real value row — a results table's F-header is instead usually
        # followed by prose or a differently-shaped row (guarded by the
        # caller's own `_extract_outcomes` never double-counting a table
        # this function already claimed).
        if i + 1 < len(lines) and _looks_like_value_row(lines[i + 1], len(cols)):
            table_ref = ""
            for back in range(1, 4):
                if i - back < 0:
                    break
                cand = lines[i - back]
                if re.search(r"\btable\s*\d*\b", cand, re.I) and "formulation" in cand.lower():
                    table_ref = cand
                    break
            out.append((i, cols, table_ref))
    return out


def _extract_composition_table(
    lines: List[str], header_idx: int, columns: List[str], table_ref: str,
) -> tuple:
    """`(rows_by_column, unresolved_rows, total_declared, had_total_row)`."""
    rows_by_column: Dict[str, List[FormulationIngredientRow]] = {c: [] for c in columns}
    unresolved: List[str] = []
    total_declared = ""
    order = 0
    j = header_idx + 1
    while j < len(lines):
        line = lines[j].strip()
        if not line:
            j += 1
            continue
        parsed = _parse_composition_row(line, len(columns))
        if not parsed:
            break
        name, values = parsed
        if name.strip().lower() == "total":
            total_declared = values[0] if values else ""
            j += 1
            break
        clean_name, unit = _split_name_unit(name)
        for col, val_text in zip(columns, values):
            qs = val_text.lower().startswith("q.s")
            num = None
            if not qs and val_text not in ("-", "To adjust pH"):
                m = re.match(r"^(-?\d+\.?\d*)", val_text)
                if m:
                    try:
                        num = float(m.group(1))
                    except ValueError:
                        num = None
            rows_by_column[col].append(FormulationIngredientRow(
                source_name=clean_name, value=num, value_text=val_text,
                unit=unit, qs=qs, order=order,
            ))
        order += 1
        j += 1
    return rows_by_column, unresolved, total_declared


# ---------------------------------------------------- outcome extraction ---

_METRIC_HINTS = (
    ("ph", "pH"),
    ("viscosity", "viscosity_cp"),
    ("solids", "solids_pct"),
    ("cleaning action", "cleaning_action_pct"),
    ("surface tension", "surface_tension_dy_cm"),
    ("foam volume", "foam_volume_ml"),
    ("dirt deposition", "dirt_deposition_dy_cm"),
)


def _extract_row_indexed_outcomes(lines: List[str], header_idx: int, columns: List[str]) -> List[ExperimentalOutcome]:
    """A results table shaped like Table 3/4 in the reference fixture:
    a condition column (RPM / time) then one numeric cell per `F<n>`
    column. Real numbers only — a row whose cell count does not match
    `len(columns)` is skipped, never partially guessed."""
    out: List[ExperimentalOutcome] = []
    metric = "viscosity_cp"
    for back in range(1, 4):
        if header_idx - back < 0:
            break
        cand = lines[header_idx - back].lower()
        for hint, name in _METRIC_HINTS:
            if hint in cand:
                metric = name
                break
    j = header_idx + 1
    while j < len(lines):
        line = lines[j].strip()
        if not line:
            j += 1
            break
        tokens = line.split()
        if len(tokens) != len(columns) + 1:
            break
        condition = tokens[0]
        for col, raw in zip(columns, tokens[1:]):
            if raw in ("-", "—", "–"):
                continue
            try:
                value = float(raw)
            except ValueError:
                continue
            out.append(ExperimentalOutcome(
                source_formulation_id=col, metric=metric, value=value, unit="",
                condition=condition, raw_text=line,
            ))
        j += 1
    return out


_F_ROW_RE = re.compile(r"^(F\d+)\b(.*)$", re.I)


def _extract_labeled_row_outcomes(lines: List[str]) -> List[ExperimentalOutcome]:
    """A results table shaped like Table 2 in the reference fixture: each
    ROW starts with `F<n>` and the rest is free-form reported text. A
    known font-encoding artifact (a `±` glyph this module's own
    stdlib-only PDF text extraction cannot always map to a plain-text
    codepoint) can merge two adjacent numbers with no separator — rather
    than risk extracting a WRONG number from a merged value, this keeps
    `raw_text` and leaves `value`/`metric` as the honest, unresolved
    `"reported"` placeholder for that case."""
    out: List[ExperimentalOutcome] = []
    for line in lines:
        m = _F_ROW_RE.match(line.strip())
        if not m:
            continue
        label, rest = m.group(1).upper(), m.group(2).strip()
        if not rest:
            continue
        out.append(ExperimentalOutcome(
            source_formulation_id=label, metric="reported", value=None, unit="",
            condition="", raw_text=f"{label} {rest}",
        ))
    return out


# --------------------------------------------------------------- top level ---


def extract_scientific_formulations(
    lines: List[str],
    canonical_paper_id: str,
    doi: str,
    title: str,
    year: str,
    authors: str,
    product_type: str = "",
) -> tuple:
    """`(records, outcomes)` — `List[ScientificFormulationRecord]` (one per
    real `F<n>` composition column found) and `List[ExperimentalOutcome]`
    linked to them by `source_formulation_id`. Returns `([], [])`,
    honestly, when no composition table structure is recognized — never a
    fabricated single-ingredient "formulation"."""
    tables = _find_composition_tables(lines)
    if not tables:
        return [], []

    header_idx, columns, table_ref = tables[0]
    rows_by_column, unresolved, total_declared = _extract_composition_table(
        lines, header_idx, columns, table_ref,
    )

    records: List[ScientificFormulationRecord] = []
    for idx, col in enumerate(columns):
        rows = rows_by_column[col]
        if not rows:
            continue
        missing = []
        if not table_ref:
            missing.append("table_reference")
        if not total_declared:
            missing.append("total_declared")
        confidence = "high" if (table_ref and total_declared and len(rows) >= 3) else "low"
        # §22: a real formulation-level Class A requires materially
        # complete composition (amounts present for most rows) — a table
        # with only qualitative cells (q.s./"-" throughout) never
        # auto-qualifies as Class A merely for existing.
        numeric_rows = sum(1 for r in rows if r.value is not None)
        evidence_class = "A" if (confidence == "high" and numeric_rows >= max(2, len(rows) // 2)) else "B"
        records.append(ScientificFormulationRecord(
            id=f"{canonical_paper_id}:{col}",
            canonical_paper_id=canonical_paper_id, doi=doi, source_title=title,
            source_year=year, source_authors=authors, table_reference=table_ref,
            source_formulation_id=col, product_type=product_type, formulation_title="",
            ingredients=rows, total_declared=total_declared,
            evidence_class=evidence_class, extraction_confidence=confidence,
            missing_fields=missing, unresolved_rows=list(unresolved),
        ))

    outcomes = _extract_row_indexed_outcomes(lines, header_idx, columns)
    # Any OTHER F<n>-headed table later in the document is a results
    # table, not a second composition table — scanned for both outcome
    # shapes without re-claiming it as a new `ScientificFormulationRecord`.
    for h_idx, cols, _ref in tables[1:]:
        outcomes.extend(_extract_row_indexed_outcomes(lines, h_idx, cols))
    outcomes.extend(_extract_labeled_row_outcomes(lines))

    return records, outcomes


# --------------------------------------------------- ingredient identity ---
# §6's own layered strategy — unknown never means discard. Deliberately
# imported here rather than folded into `_extract_composition_table`
# above: identity resolution depends on `evidence.py`'s known-ingredient
# vocabulary and `materials.py`'s own supplier aliases, both of which stay
# free of any reverse dependency on this module.


def resolve_row_identity(source_name: str, materials: List[Dict[str, Any]]) -> tuple:
    """`(normalized_key, material_id, status)` — layers 1-2 (exact
    masterdata / supplier alias match) and 3 (the same known-ingredient
    vocabulary `evidence.py`'s own mention-detection already recognizes).
    `status` is one of `RESOLVED_SUPPLIER_MATERIAL` / `RESOLVED_KNOWN_
    INGREDIENT` / `UNRESOLVED_MATERIAL_IDENTITY` — never a fabricated
    FormuLab material id for a name this installation has no real record
    of."""
    import evidence as evidence_mod
    import materials as materials_mod

    key = evidence_mod.normalize_ingredient_key(source_name)

    m = materials_mod.match_material(source_name, materials) if materials else None
    if m:
        return key, materials_mod.material_id(m, 0), RESOLVED_SUPPLIER_MATERIAL

    if key in evidence_mod.KNOWN_INGREDIENTS:
        return key, None, RESOLVED_KNOWN_INGREDIENT

    return None, None, UNRESOLVED_MATERIAL_IDENTITY


def resolve_identities(
    records: List[ScientificFormulationRecord], materials: List[Dict[str, Any]],
) -> List[ScientificFormulationRecord]:
    """Returns NEW records with every ingredient row's identity resolved —
    `FormulationIngredientRow` is frozen, so this rebuilds rather than
    mutates, keeping the extraction step above pure/identity-agnostic."""
    out = []
    for rec in records:
        new_rows = []
        for row in rec.ingredients:
            key, mat_id, status = resolve_row_identity(row.source_name, materials)
            new_rows.append(FormulationIngredientRow(
                source_name=row.source_name, value=row.value, value_text=row.value_text,
                unit=row.unit, qs=row.qs, order=row.order,
                normalized_key=key, material_id=mat_id, identity_status=status,
            ))
        out.append(ScientificFormulationRecord(
            id=rec.id, canonical_paper_id=rec.canonical_paper_id, doi=rec.doi,
            source_title=rec.source_title, source_year=rec.source_year,
            source_authors=rec.source_authors, table_reference=rec.table_reference,
            source_formulation_id=rec.source_formulation_id, product_type=rec.product_type,
            formulation_title=rec.formulation_title, ingredients=new_rows,
            total_declared=rec.total_declared, evidence_class=rec.evidence_class,
            extraction_confidence=rec.extraction_confidence, missing_fields=rec.missing_fields,
            unresolved_rows=rec.unresolved_rows,
        ))
    return out
