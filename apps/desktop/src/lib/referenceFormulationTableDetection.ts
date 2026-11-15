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
  ["amount", /^(%|% ?w\/?w|w\/?w ?%|wt\.? ?%|% ?wt|amount|quantity|dosage|dose|dose \(% ?w\/?w\)|concentration|percentage|percent|weight percent|(#?\d+ )?percentage \(%\)|% active|parts|parts by weight|composition %|weight ?\(?%\)?|wt\.? ?%|% by weight|% ?\(w\/w\)|weight %)$/],
  ["inci", /^(inci|inci name|inci names?|chemical name|chemical description|chemical identity|chemical)$/],
  ["function", /^(function|functionality|role|purpose|benefit)$/],
  ["supplier", /^(supplier|manufacturer|vendor|source)$/],
  ["ingredient", /^(ingredients?|ingredient ?\/ ?inci name|product|products|product name|component|components|raw materials?|trade ?name|commercial product|material|composition|[a-z]+ product ?\/ ?ingredient|formulation|formula)$/],
];

const STOP_HEADING = /^(method|procedure|procedures|processing|preparation|manufacturing( procedure| process)?|specifications?|technical characteristics|properties|physical properties|characteristics|notes?:?|additional information|description|stability|recommended operative method|directions?|instructions?|results?|performance)\b/i;
const PHASE_CELL = /^(?:[A-H]|[IVX]{1,4})\.?$/;

function normalizeHeader(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[®™©*^]/g, "").replace(/\s+/g, " ").trim();
}

export function headerColumn(text: string): DetectedColumn | undefined {
  const normalized = normalizeHeader(text);
  return HEADER_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0];
}

interface HeaderCell { column: DetectedColumn; x: number; label: string }

function fragmentsOf(line: PositionedLine): PositionedFragment[] {
  if (line.fragments?.length) return line.fragments.filter((fragment) => fragment.text.trim());
  return line.text.trim() ? [{ text: line.text.trim(), x: line.position?.x ?? 0 }] : [];
}

function detectHeader(line: PositionedLine): HeaderCell[] | undefined {
  const cells: HeaderCell[] = [];
  for (const fragment of fragmentsOf(line)) {
    const column = headerColumn(fragment.text);
    if (!column) return undefined;
    cells.push({ column, x: fragment.x, label: fragment.text.trim() });
  }
  const amountCount = cells.filter((cell) => cell.column === "amount").length;
  const ingredient = cells.filter((cell) => cell.column === "ingredient").length;
  if (ingredient !== 1 || amountCount < 1) return undefined;
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
        if (!hasPhase && fragment.x < firstX - 4 && PHASE_CELL.test(text)) { row.phase = text; continue; }
        // Nearest header start: headers are often centred over their column, so a
        // cell can begin left of its own header.
        const cell = header.reduce<HeaderCell>((best, candidate) =>
          Math.abs(candidate.x - fragment.x) < Math.abs(best.x - fragment.x) ? candidate : best, header[0]!);
        if (cell.column === "amount") {
          // A dash means "not in this formula" in side-by-side tables.
          if (/^[-–—]$/.test(text)) continue;
          const slot = amountCells.indexOf(cell);
          row.amounts[slot] = [row.amounts[slot], text].filter(Boolean).join(" ");
        } else {
          row[cell.column] = [row[cell.column], text].filter(Boolean).join(" ");
        }
      }
      const hasAmount = row.amounts.some(Boolean);
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
    const dataRows = rows.filter((row) => row.amounts.some(Boolean) && (row.ingredient || row.inci));
    if (dataRows.length < 2) continue;
    const columns = (["phase", "ingredient", "inci", "function", "supplier"] as const)
      .filter((column) => header.some((cell) => cell.column === column) || (column === "phase" && dataRows.some((row) => row.phase)));
    amountCells.forEach((amountCell, slot) => {
      const variantRows = dataRows.filter((row) => row.amounts[slot]);
      if (variantRows.length < 2) return;
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
