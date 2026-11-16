// Turns positioned PDF text rows into ingredient-table rows the shared
// layout analyzer understands, across the supplier layouts seen in the
// owner's corpus (Croda, Evonik, Seppic, BASF, Kao, Dow, Clariant, ...).
// Header cells are mapped to canonical labels; every data cell keeps its
// original text. Nothing is inferred that the page does not print.

export interface PositionedFragment { text: string; x: number; width?: number }
export interface PositionedLine { text: string; position?: { x: number; y: number }; fragments?: PositionedFragment[] }

export type DetectedColumn = "phase" | "ingredient" | "inci" | "function" | "amount" | "supplier";

/** Canonical header text per column, chosen to match the shared analyzer's aliases. */
const CANONICAL_HEADER: Record<DetectedColumn, string> = {
  phase: "Phase",
  ingredient: "Ingredient",
  inci: "INCI",
  function: "Function",
  amount: "% w/w",
  supplier: "Supplier",
};

const HEADER_PATTERNS: Array<[DetectedColumn, RegExp]> = [
  ["phase", /^(phase|step|stage)$/],
  ["amount", /^(%|% ?w\/?w|w\/?w ?%|wt\.? ?%|% ?wt\.?|amount|quantity|dosage|dose|dose \(%?|dose \(% ?w\/?w\)?|concentration|percentage|percent|weight percent|(#?\d+ )?percentage \(%\)|% active|parts|parts by weight|composition %|weight ?-? ?\(?%\)?|% by weight|% ?\(w\/w\)|weight %|amount ?\(?%\)?|% inclusion|inclusion ?\(?%\)?|% ?w\/?w in [a-z0-9* ]+|% by wt\.?|% as is)$/],
  ["inci", /^(inci\)?|inci name|inci names?|inci ?\/ ?ctfa( name)?|inci name ?\/.+|chemical description\)|chemical name|chemical description|chemical identity|chemical)$/],
  ["function", /^(function|functionality|role|purpose|benefit)$/],
  ["supplier", /^(supplier|manufacturer|vendor|source)$/],
  ["ingredient", /^(ingredients?|ingredient ?names?|ingredients? \(trade ?name.*|ingredient ?\/ ?inci name|product|products|product name|component|components|raw materials?|trade ?names?|trade ?names? ?\/ ?suppliers?|trade ?names? ?\/ ?inci|name|commercial product|material|composition|[a-z]+ product ?\/ ?ingredient|formulation|formula)$/],
];
/** Preferred name column when a header has several ("Ingredient" and "Trade Name"). */
const PRIMARY_NAME = /^(ingredients?|component|components|product|products|composition|raw materials?)/;

const STOP_HEADING = /^(method|procedure|procedures|processing|preparation|manufacturing( procedure| process)?|specifications?|technical characteristics|properties|physical properties|characteristics|notes?:?|additional information|description|stability|recommended operative method|directions?|instructions?|results?|performance)\b/i;
const PHASE_CELL = /^(?:[A-H]|[IVX]{1,4})\.?$/;
/** Words that legitimately appear in an amount cell ("q.s.", "to pH 5.5", "Ad. 100", "100 mg"). */
const AMOUNT_WORDS = /\b(?:q\.?\s*s\.?|qsp|up|to|ad|add|balance|rest|remainder|as|required|desired|needed|suit|ph|adj(?:ust)?\.?|approx|ca|e\.?q\.?|mg|g|ppm|range|formulation|dependent|too|sufficient|quantum|satis|parts?)\b/gi;

/** Text with words that are not amount vocabulary, e.g. "Crosspolymer)". */
function isNameText(text: string): boolean {
  return /[A-Za-z]{3,}/.test(text.replace(AMOUNT_WORDS, ""));
}

function normalizeHeader(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[®™©*^]/g, "").replace(/\s+/g, " ").trim();
}

export function headerColumn(text: string): DetectedColumn | undefined {
  const normalized = normalizeHeader(text);
  return HEADER_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0];
}

/** "ignore" marks a header cell the table prints but FormuLab does not read (e.g. "Order"). */
interface HeaderCell { column: DetectedColumn | "ignore"; x: number; width?: number; label: string }

function fragmentsOf(line: PositionedLine): PositionedFragment[] {
  if (line.fragments?.length) return line.fragments.filter((fragment) => fragment.text.trim());
  return line.text.trim() ? [{ text: line.text.trim(), x: line.position?.x ?? 0 }] : [];
}

function detectHeader(line: PositionedLine): HeaderCell[] | undefined {
  const cells: HeaderCell[] = [];
  for (const fragment of fragmentsOf(line)) {
    const label = fragment.text.trim();
    const width = fragment.width;
    const column = headerColumn(label);
    // "Phase Trade name / supplier" printed as one fragment.
    const split = !column && /^phase\s+(.+)$/i.exec(label);
    if (split && headerColumn(split[1]!)) {
      cells.push({ column: "phase", x: fragment.x, width: 0, label: "Phase" });
      cells.push({ column: headerColumn(split[1]!)!, x: fragment.x + 1, width, label: split[1]! });
      continue;
    }
    cells.push({ column: column ?? "ignore", x: fragment.x, width, label });
  }
  const names = cells.filter((cell) => cell.column === "ingredient");
  if (names.length > 1) {
    const primary = names.find((cell) => PRIMARY_NAME.test(normalizeHeader(cell.label))) ?? names[0]!;
    for (const cell of names) if (cell !== primary) cell.column = /supplier/i.test(cell.label) ? "supplier" : "ignore";
  }
  const known = cells.filter((cell) => cell.column !== "ignore").length;
  // Some cards name each line only by INCI ("Phase | INCI | Quantity"): that column is
  // then the line's name, since the formula reader needs a name column.
  if (!cells.some((cell) => cell.column === "ingredient")) {
    const inci = cells.find((cell) => cell.column === "inci");
    if (inci) inci.column = "ingredient";
  }
  const hasIngredient = cells.some((cell) => cell.column === "ingredient");
  const hasAmount = cells.some((cell) => cell.column === "amount");
  if (!hasIngredient || !hasAmount || known < 2 || known < cells.length - known) return undefined;
  return cells.sort((left, right) => left.x - right.x);
}

export interface DetectedIngredientTable {
  /** First row is the canonical header; the rest are data rows. */
  rows: string[][];
  /** Raw header label of the amount column this table was read from. */
  amountHeader: string;
  /** 1-based variant number when one table prints several formulas side by side. */
  variant?: number;
  variantCount: number;
  position?: { x: number; y: number };
}

/**
 * Find ingredient tables on one page. A table with several amount columns
 * (e.g. "#1 Percentage", "#2 Percentage") yields one table per column so each
 * printed formula becomes its own record.
 */
export function detectIngredientTables(lines: PositionedLine[]): DetectedIngredientTable[] {
  const ordered = [...lines].sort((left, right) => (right.position?.y ?? 0) - (left.position?.y ?? 0));
  const tables: DetectedIngredientTable[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const header = detectHeader(ordered[index]!);
    if (!header) continue;
    const firstX = header[0]!.x;
    const hasPhase = header.some((cell) => cell.column === "phase");
    type Row = Partial<Record<DetectedColumn, string>> & { amounts: string[] };
    const amountCells = header.filter((cell) => cell.column === "amount");
    const rows: Row[] = [];
    const last = header[header.length - 1]!;
    // Text right of the last header (e.g. a procedure printed beside the table) is not a cell.
    const rightEdge = last.width === undefined ? Number.POSITIVE_INFINITY : last.x + Math.max(last.width, 15) + 8;
    let sectionPhase: string | undefined;
    let previousY = ordered[index]!.position?.y ?? 0;
    let consumed = index;
    for (let next = index + 1; next < ordered.length; next += 1) {
      const line = ordered[next]!;
      const y = line.position?.y ?? previousY;
      if (previousY - y > 36) break;
      if (STOP_HEADING.test(line.text.trim()) && fragmentsOf(line).length <= 2) break;
      if (detectHeader(line)) break;
      const row: Row = { amounts: amountCells.map(() => "") };
      for (const fragment of fragmentsOf(line)) {
        const text = fragment.text.trim();
        if (fragment.x > rightEdge) continue;
        if (!hasPhase && fragment.x < firstX - 4 && PHASE_CELL.test(text)) { row.phase = text; continue; }
        // Nearest header start: headers are often centred over their column, so a
        // cell can begin left of its own header.
        const cell = header.reduce<HeaderCell>((best, candidate) =>
          Math.abs(candidate.x - fragment.x) < Math.abs(best.x - fragment.x) ? candidate : best, header[0]!);
        if (cell.column === "amount" && isNameText(text)) {
          // The tail of a long name that spilled under the amount header belongs to the column on its left;
          // a trailing number in the same fragment stays the amount.
          const left = [...header].reverse().find((candidate) => candidate.x < cell.x && candidate.column !== "ignore" && candidate.column !== "amount");
          const split = /^(.*\S)\s+(\d+(?:[.,]\d+)?\s*%?)$/.exec(text);
          if (left && left.column !== "ignore" && left.column !== "amount") {
            const nameText = split ? split[1]! : text;
            row[left.column] = [row[left.column], nameText].filter(Boolean).join(" ");
            if (!split) continue;
            const slot = amountCells.indexOf(cell);
            row.amounts[slot] = [row.amounts[slot], split[2]!].filter(Boolean).join(" ");
            continue;
          }
        }
        if (cell.column === "ignore") continue;
        if (cell.column === "amount") {
          // A dash means "not in this formula"; "1." is a procedure step number printed beside the table.
          if (/^[-–—]$/.test(text) || /^\d{1,2}\.$/.test(text)) continue;
          const slot = amountCells.indexOf(cell);
          row.amounts[slot] = [row.amounts[slot], text].filter(Boolean).join(" ").replace(/(\d) \.(\d)/g, "$1.$2");
        } else {
          row[cell.column] = [row[cell.column], text].filter(Boolean).join(" ");
        }
      }
      const hasAmount = row.amounts.some(Boolean);
      // A "Phase A" line inside the table labels the rows below it.
      const sectionLabel = !hasAmount && /^phase\s+([A-Z0-9]{1,3})\.?$/i.exec((row.ingredient ?? "").trim());
      if (sectionLabel) { sectionPhase = sectionLabel[1]!.toUpperCase(); previousY = y; consumed = next; continue; }
      if (hasAmount && !row.phase && sectionPhase) row.phase = sectionPhase;
      const hasName = Boolean(row.ingredient || row.inci);
      if (!hasAmount && !hasName && !row.function) { previousY = y; continue; }
      const previous = rows[rows.length - 1];
      if (!hasAmount && previous && !row.phase) {
        // A wrapped cell: append to the row above instead of inventing a new ingredient.
        for (const column of ["ingredient", "inci", "function", "supplier"] as const) {
          if (row[column]) previous[column] = [previous[column], row[column]].filter(Boolean).join(" ");
        }
      } else if (hasAmount || hasName) {
        rows.push(row);
      }
      previousY = y;
      consumed = next;
    }
    // A row with its own phase marker but no printed amount (e.g. "E · Citric Acid") is a real
    // ingredient whose amount is not stated; it is kept, never given an invented value.
    const dataRows = rows.filter((row) => (row.ingredient || row.inci) && (row.amounts.some(Boolean) || row.phase));
    if (dataRows.length < 2) continue;
    const columns = (["phase", "ingredient", "inci", "function", "supplier"] as const)
      .filter((column) => header.some((cell) => cell.column === column) || (column === "phase" && dataRows.some((row) => row.phase)));
    amountCells.forEach((amountCell, slot) => {
      const variantRows = dataRows.filter((row) => row.amounts[slot] || (amountCells.length === 1 && !row.amounts.some(Boolean)));
      if (variantRows.filter((row) => row.amounts[slot]).length < 2) return;
      tables.push({
        rows: [
          [...columns.map((column) => CANONICAL_HEADER[column]), CANONICAL_HEADER.amount],
          ...variantRows.map((row) => [...columns.map((column) => row[column] ?? ""), row.amounts[slot]!]),
        ],
        amountHeader: amountCell.label,
        ...(amountCells.length > 1 ? { variant: slot + 1 } : {}),
        variantCount: amountCells.length,
        ...(ordered[index]!.position ? { position: ordered[index]!.position } : {}),
      });
    });
    index = consumed;
  }
  return tables;
}
