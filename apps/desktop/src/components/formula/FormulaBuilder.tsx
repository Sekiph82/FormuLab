import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  GripVertical,
  Info,
  OctagonAlert,
  Plus,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  MATERIAL_FUNCTIONS,
  computeTotals,
  convertQsToFixed,
  displayMoney,
  functionalSummary,
  isValid,
  scaleToBatch,
  setQsLine,
  toDecimalString,
  validateFormula,
  type FormulationLine,
  type MaterialFunction,
  type RawMaterial,
  type ValidationFinding,
  type ValidationOptions,
} from "@ai4s/shared";
import Decimal from "decimal.js";
import { cn } from "@/lib/cn";
import { emptyLine, newId } from "@/lib/formulations";

/**
 * The formula editor — the surface a formulator actually works on.
 *
 * Every derived number (q.s. remainder, totals, active matter, batch weights,
 * line cost) comes from the shared engine, never from arithmetic in this
 * component, so the figures here are identical to the ones an export or an ERP
 * row will carry.
 *
 * The grid is dense on purpose. A formulator compares a dozen lines at a glance;
 * a comfortable card layout would put three on screen and make the comparison
 * impossible.
 */

/** Columns beyond the core set, hidden by default to keep the grid readable. */
const OPTIONAL_COLUMNS = [
  "materialCode",
  "tradeName",
  "inciName",
  "supplier",
  "price",
  "lineCost",
  "notes",
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

export interface FormulaBuilderProps {
  lines: FormulationLine[];
  onChange: (lines: FormulationLine[], opts?: { checkpoint?: boolean }) => void;
  onSave?: () => void;
  batchKg: string;
  onBatchChange: (kg: string) => void;
  /** Template-driven; the engine never guesses whether a product is aqueous. */
  validation?: ValidationOptions;
  /** Library used by the material picker and for cost lookups. */
  materials?: RawMaterial[];
  currency?: string;
  dirty?: boolean;
  saving?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Autosave status, shown so "is my work safe?" is always answerable. */
  autosaveState?: "idle" | "saving" | "saved";
  /** Set (to a new value, even the same id again) to select and scroll a line
   *  into view — used by the Compatibility/Safety tabs' "go to line" links. */
  focusLineId?: string | null;
}

export function FormulaBuilder({
  lines,
  onChange,
  onSave,
  batchKg,
  onBatchChange,
  validation = {},
  materials = [],
  currency = "KES",
  dirty = false,
  saving = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  autosaveState = "idle",
  focusLineId,
}: FormulaBuilderProps) {
  const { t } = useTranslation(["session", "common"]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!focusLineId) return;
    setSelected(focusLineId);
    const row = gridRef.current?.querySelector(`[data-line-id="${CSS.escape(focusLineId)}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLineId]);
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState<Set<OptionalColumn>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  const totals = useMemo(() => computeTotals(lines), [lines]);
  const batch = useMemo(() => scaleToBatch(lines, batchKg || "100"), [lines, batchKg]);
  const findings = useMemo(
    () => validateFormula(lines, { ...validation, batchKg }),
    [lines, validation, batchKg],
  );
  const quantities = useMemo(() => new Map(batch.map((b) => [b.lineId, b])), [batch]);
  const groups = useMemo(() => functionalSummary(lines), [lines]);
  const blocked = !isValid(findings);

  /** Findings that point at a specific line, so a row can show its own state. */
  const findingsByLine = useMemo(() => {
    const map = new Map<string, ValidationFinding[]>();
    for (const f of findings) {
      for (const id of f.lineId ? [f.lineId] : (f.lineIds ?? [])) {
        map.set(id, [...(map.get(id) ?? []), f]);
      }
    }
    return map;
  }, [findings]);

  // ------------------------------------------------------------- mutations ---

  const update = useCallback(
    (id: string, patch: Partial<FormulationLine>) => {
      onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    [lines, onChange],
  );

  const renumber = (next: FormulationLine[]) =>
    next.map((l, i) => ({ ...l, lineNumber: i + 1 }));

  const addLine = useCallback(() => {
    const last = lines[lines.length - 1];
    onChange([...lines, emptyLine(lines.length + 1, last?.phase ?? "A")], { checkpoint: true });
  }, [lines, onChange]);

  const removeLine = useCallback(
    (id: string) => onChange(renumber(lines.filter((l) => l.id !== id)), { checkpoint: true }),
    [lines, onChange],
  );

  const duplicateLine = useCallback(
    (id: string) => {
      const i = lines.findIndex((l) => l.id === id);
      if (i < 0) return;
      const copy: FormulationLine = {
        ...lines[i],
        id: newId("line"),
        // A duplicate must not silently create a second q.s. line; the split
        // between them would be ambiguous.
        isQsToHundred: false,
      };
      onChange(renumber([...lines.slice(0, i + 1), copy, ...lines.slice(i + 1)]), {
        checkpoint: true,
      });
    },
    [lines, onChange],
  );

  const move = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const from = lines.findIndex((l) => l.id === fromId);
      const to = lines.findIndex((l) => l.id === toId);
      if (from < 0 || to < 0) return;
      const next = [...lines];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(renumber(next), { checkpoint: true });
    },
    [lines, onChange],
  );

  const toggleQs = useCallback(
    (id: string, on: boolean) => onChange(setQsLine(lines, id, on), { checkpoint: true }),
    [lines, onChange],
  );

  /** Freeze the q.s. line at what it currently resolves to. */
  const pinQs = useCallback(
    (id: string) => onChange(convertQsToFixed(lines, id), { checkpoint: true }),
    [lines, onChange],
  );

  /** Attach a library material, carrying its known data onto the line. */
  const pickMaterial = useCallback(
    (lineId: string, m: RawMaterial) => {
      update(lineId, {
        materialId: m.code,
        materialCode: m.code,
        displayName: m.displayName,
        tradeName: m.tradeName,
        inciName: m.inciName,
        // Only copy what the library actually knows. An absent active-matter
        // figure stays absent rather than becoming a confident 100%.
        activeMatterPercent: m.activeMatterPercent,
        technicalMaxPercent: m.technicalMaxPercent,
        functions: m.functions.length > 0 ? m.functions : undefined,
      });
      setPickerFor(null);
    },
    [update],
  );

  // ------------------------------------------------------- keyboard support ---

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey && onUndo) {
        e.preventDefault();
        onUndo();
      } else if ((k === "y" || (k === "z" && e.shiftKey)) && onRedo) {
        e.preventDefault();
        onRedo();
      } else if (k === "s" && onSave) {
        e.preventDefault();
        onSave();
      } else if (k === "enter") {
        e.preventDefault();
        addLine();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndo, onRedo, onSave, addLine]);

  /**
   * Arrow-key movement between cells.
   *
   * Tab already moves along a row; up and down are what a spreadsheet user
   * reaches for and what the browser does not provide.
   */
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    const cell = target.closest("td");
    const row = target.closest("tr");
    if (!cell || !row) return;
    const columnIndex = Array.from(row.children).indexOf(cell);
    const sibling = e.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
    const next = sibling?.children[columnIndex]?.querySelector<HTMLElement>("input, select");
    if (next) {
      e.preventDefault();
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    }
  };

  /**
   * Paste a block of cells from a spreadsheet.
   *
   * Formulators keep their working formulas in Excel; retyping thirty lines to
   * get one into the builder is the thing that would stop them using it.
   */
  const onPaste = (e: React.ClipboardEvent, lineId: string) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // a single cell: let it paste normally
    e.preventDefault();

    const rows = text
      .split(/\r?\n/)
      .filter((r) => r.trim())
      .map((r) => r.split("\t"));
    const start = lines.findIndex((l) => l.id === lineId);
    if (start < 0) return;

    const next = [...lines];
    rows.forEach((cells, i) => {
      const [name, percent, active] = cells;
      const target = next[start + i];
      const patch: Partial<FormulationLine> = {};
      if (name?.trim()) patch.displayName = name.trim();
      if (percent?.trim()) patch.percent = percent.trim().replace(",", ".").replace(/[^\d.-]/g, "") || "0";
      if (active?.trim()) patch.activeMatterPercent = active.trim().replace(",", ".");

      if (target) {
        next[start + i] = { ...target, ...patch };
      } else {
        next.push({ ...emptyLine(next.length + 1, next[next.length - 1]?.phase ?? "A"), ...patch });
      }
    });
    onChange(renumber(next), { checkpoint: true });
  };

  // ------------------------------------------------------------------ view ---

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) =>
      [l.displayName, l.tradeName, l.inciName, l.materialCode, l.phase, ...l.functions]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [lines, filter]);

  const focusLine = (id: string) => {
    setSelected(id);
    setFilter("");
    requestAnimationFrame(() => {
      const row = gridRef.current?.querySelector<HTMLElement>(`[data-line-id="${id}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.querySelector<HTMLInputElement>("input")?.focus();
    });
  };

  const col = (c: OptionalColumn) => visible.has(c);
  // Resolved before the JSX: a bare string literal inside markup reads as
  // display text to the i18n lint rule, and these are column keys.
  const show = {
    materialCode: col("materialCode"),
    tradeName: col("tradeName"),
    inciName: col("inciName"),
    supplier: col("supplier"),
    price: col("price"),
    lineCost: col("lineCost"),
    notes: col("notes"),
  };
  const toggleCol = (c: OptionalColumn) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  /** Line cost, computed here only from values already on the line. */
  const lineCost = (line: FormulationLine): string | undefined => {
    if (!line.unitPrice) return undefined;
    const q = quantities.get(line.id);
    if (!q) return undefined;
    return displayMoney(
      new Decimal(q.quantity).times(new Decimal(line.unitPrice)),
      line.currency ?? currency,
    );
  };

  const totalCost = useMemo(() => {
    let sum = new Decimal(0);
    let complete = true;
    for (const line of lines) {
      const q = quantities.get(line.id);
      if (!line.unitPrice || !q) {
        complete = false;
        continue;
      }
      sum = sum.plus(new Decimal(q.quantity).times(new Decimal(line.unitPrice)));
    }
    return { sum, complete };
  }, [lines, quantities]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="print-hide flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={addLine}
          className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 py-1 text-xs text-text hover:bg-surface-2"
        >
          <Plus size={13} /> {t("builder.addLine")}
        </button>

        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={onUndo}
            disabled={!canUndo}
            label={t("builder.undo")}
            icon={<Undo2 size={13} />}
          />
          <IconButton
            onClick={onRedo}
            disabled={!canRedo}
            label={t("builder.redo")}
            icon={<Redo2 size={13} />}
          />
        </div>

        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          {t("builder.batch")}
          <input
            value={batchKg}
            onChange={(e) => onBatchChange(e.target.value)}
            inputMode="decimal"
            aria-label={t("builder.batch")}
            className="w-24 rounded-input border border-border bg-surface px-2 py-1 text-right text-[12px] text-text outline-none focus:border-accent"
          />
          {t("builder.kgUnit")}
        </label>

        <label className="flex items-center gap-1 text-[12px] text-muted">
          <Search size={13} aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("builder.filter")}
            aria-label={t("builder.filter")}
            className="w-36 rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>

        <ColumnMenu visible={visible} onToggle={toggleCol} />

        <div className="flex-1" />

        <span
          className="text-[11px] text-muted"
          aria-live="polite"
          title={t("builder.autosaveTitle")}
        >
          {autosaveState === "saving"
            ? t("builder.autosaving")
            : dirty
              ? t("builder.unsaved")
              : autosaveState === "saved"
                ? t("builder.autosaved")
                : ""}
        </span>

        <TotalsBadge
          label={t("builder.total")}
          value={`${toDecimalString(totals.totalPercent, 4)}%`}
          tone={totals.totalPercent.equals(100) ? "ok" : blocked ? "error" : "warn"}
        />
        <TotalsBadge
          label={t("builder.activeMatter")}
          value={`${toDecimalString(totals.totalActiveMatterPercent, 2)}%`}
          tone="neutral"
        />

        {onSave && (
          <button
            onClick={onSave}
            disabled={saving || !dirty}
            title={dirty ? t("builder.saveTitle") : t("builder.noChanges")}
            className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            <Save size={13} />
            {saving ? t("builder.saving") : t("builder.saveVersion")}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table
          ref={gridRef}
          onKeyDown={onGridKeyDown}
          className="w-full border-collapse text-[12px]"
        >
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border text-left text-muted">
              <Th className="w-8" />
              <Th className="w-10">#</Th>
              <Th className="w-16">{t("builder.phase")}</Th>
              {show.materialCode && <Th className="w-28">{t("builder.materialCode")}</Th>}
              <Th className="min-w-44">{t("builder.material")}</Th>
              {show.tradeName && <Th className="w-36">{t("builder.tradeName")}</Th>}
              {show.inciName && <Th className="w-40">{t("builder.inci")}</Th>}
              <Th className="w-44">{t("builder.function")}</Th>
              {show.supplier && <Th className="w-28">{t("builder.supplier")}</Th>}
              <Th className="w-24 text-right">{t("builder.percent")}</Th>
              <Th className="w-24 text-right">{t("builder.activeCol")}</Th>
              <Th className="w-28 text-right">{t("builder.quantity")}</Th>
              {show.price && <Th className="w-28 text-right">{t("builder.unitPrice")}</Th>}
              {show.lineCost && <Th className="w-32 text-right">{t("builder.lineCost")}</Th>}
              <Th className="w-28">{t("builder.origin")}</Th>
              {show.notes && <Th className="w-40">{t("builder.notes")}</Th>}
              <Th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {shown.map((line, i) => {
              const q = quantities.get(line.id);
              const lineFindings = findingsByLine.get(line.id) ?? [];
              const worst = severityOf(lineFindings);
              const previous = shown[i - 1];
              const newPhase = !previous || previous.phase !== line.phase;

              return (
                <>
                  {newPhase && (
                    <tr key={`phase-${line.phase}-${line.id}`} className="bg-surface-2/40">
                      <Td
                        colSpan={20}
                        className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted"
                      >
                        {t("builder.phaseLabel", { phase: line.phase })}
                      </Td>
                    </tr>
                  )}
                  <tr
                    key={line.id}
                    data-line-id={line.id}
                    draggable
                    onDragStart={() => setDragId(line.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragId) move(dragId, line.id);
                      setDragId(null);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onFocus={() => setSelected(line.id)}
                    className={cn(
                      "border-b border-border-faint",
                      selected === line.id && "bg-surface-2/50",
                      dragId === line.id && "opacity-40",
                      worst === "blocking" && "bg-error/10",
                      worst === "error" && "bg-error/5",
                    )}
                  >
                    <Td className="cursor-grab text-center text-muted" title={t("builder.dragHint")}>
                      <GripVertical size={12} className="mx-auto" aria-hidden />
                    </Td>
                    <Td className="text-muted tabular-nums">{line.lineNumber}</Td>
                    <Td>
                      <Cell
                        value={line.phase}
                        onChange={(v) => update(line.id, { phase: v || "A" })}
                        aria-label={t("builder.phase")}
                        className="w-12"
                      />
                    </Td>
                    {show.materialCode && (
                      <Td>
                        <Cell
                          value={line.materialCode ?? ""}
                          onChange={(v) => update(line.id, { materialCode: v || undefined })}
                          aria-label={t("builder.materialCode")}
                          placeholder="—"
                        />
                      </Td>
                    )}
                    <Td>
                      <div className="flex items-center gap-1">
                        <Cell
                          value={line.displayName}
                          onChange={(v) => update(line.id, { displayName: v })}
                          onPaste={(e) => onPaste(e, line.id)}
                          aria-label={t("builder.material")}
                          placeholder={t("builder.materialPlaceholder")}
                        />
                        {materials.length > 0 && (
                          <button
                            onClick={() => setPickerFor(line.id)}
                            aria-label={t("builder.pickMaterial")}
                            title={t("builder.pickMaterial")}
                            className="shrink-0 rounded p-0.5 text-muted hover:text-text"
                          >
                            <Search size={12} />
                          </button>
                        )}
                      </div>
                    </Td>
                    {show.tradeName && (
                      <Td>
                        <Cell
                          value={line.tradeName ?? ""}
                          onChange={(v) => update(line.id, { tradeName: v || undefined })}
                          aria-label={t("builder.tradeName")}
                          placeholder="—"
                        />
                      </Td>
                    )}
                    {show.inciName && (
                      <Td>
                        <Cell
                          value={line.inciName ?? ""}
                          onChange={(v) => update(line.id, { inciName: v || undefined })}
                          aria-label={t("builder.inci")}
                          placeholder="—"
                        />
                      </Td>
                    )}
                    <Td>
                      <FunctionPicker
                        value={line.functions}
                        onChange={(functions) => update(line.id, { functions })}
                      />
                    </Td>
                    {show.supplier && (
                      <Td>
                        <Cell
                          value={line.supplierCode ?? ""}
                          onChange={(v) => update(line.id, { supplierCode: v || undefined })}
                          aria-label={t("builder.supplier")}
                          placeholder="—"
                        />
                      </Td>
                    )}
                    <Td className="text-right">
                      {line.isQsToHundred ? (
                        <button
                          onClick={() => pinQs(line.id)}
                          title={t("builder.pinQs")}
                          className="w-full text-right tabular-nums text-muted hover:text-text"
                        >
                          {toDecimalString(totals.qsRemainder, 4)} <em>{t("builder.qsAbbrev")}</em>
                        </button>
                      ) : (
                        <Cell
                          value={line.percent}
                          onChange={(v) => update(line.id, { percent: v || "0" })}
                          onPaste={(e) => onPaste(e, line.id)}
                          aria-label={t("builder.percent")}
                          className="text-right tabular-nums"
                          inputMode="decimal"
                        />
                      )}
                    </Td>
                    <Td className="text-right">
                      <Cell
                        value={line.activeMatterPercent ?? ""}
                        onChange={(v) => update(line.id, { activeMatterPercent: v || undefined })}
                        aria-label={t("builder.activeCol")}
                        placeholder="—"
                        className="text-right tabular-nums"
                        inputMode="decimal"
                      />
                    </Td>
                    <Td className="text-right tabular-nums text-muted">{q?.quantity ?? "—"}</Td>
                    {show.price && (
                      <Td className="text-right">
                        <Cell
                          value={line.unitPrice ?? ""}
                          onChange={(v) =>
                            update(line.id, {
                              unitPrice: v || undefined,
                              currency: v ? (line.currency ?? currency) : line.currency,
                            })
                          }
                          aria-label={t("builder.unitPrice")}
                          placeholder="—"
                          className="text-right tabular-nums"
                          inputMode="decimal"
                        />
                      </Td>
                    )}
                    {show.lineCost && (
                      <Td className="text-right tabular-nums text-muted">
                        {lineCost(line) ?? "—"}
                      </Td>
                    )}
                    <Td>
                      <span
                        className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted"
                        title={t("builder.originTitle")}
                      >
                        {line.provenance.origin.replace(/_/g, " ")}
                      </span>
                    </Td>
                    {show.notes && (
                      <Td>
                        <Cell
                          value={line.notes ?? ""}
                          onChange={(v) => update(line.id, { notes: v || undefined })}
                          aria-label={t("builder.notes")}
                          placeholder="—"
                        />
                      </Td>
                    )}
                    <Td>
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={line.isQsToHundred}
                          onChange={(e) => toggleQs(line.id, e.target.checked)}
                          title={t("builder.qsToggle")}
                          aria-label={t("builder.qsToggle")}
                        />
                        <button
                          onClick={() => duplicateLine(line.id)}
                          aria-label={t("builder.duplicateLine")}
                          title={t("builder.duplicateLine")}
                          className="rounded p-0.5 text-muted hover:text-text"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => removeLine(line.id)}
                          aria-label={t("builder.removeLine")}
                          title={t("builder.removeLine")}
                          className="rounded p-0.5 text-muted hover:text-error"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                </>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <Td className="py-6 text-center text-muted" colSpan={20}>
                  {lines.length === 0 ? t("builder.empty") : t("builder.noMatches")}
                </Td>
              </tr>
            )}
          </tbody>

          {/* Sticky totals: the two numbers a formulator checks constantly. */}
          <tfoot className="sticky bottom-0 z-10 bg-surface">
            <tr className="border-t border-border font-medium">
              <Td colSpan={3} className="text-muted">
                {t("builder.totalRow")}
              </Td>
              <Td
                colSpan={countLeadingCols(visible)}
                className="text-right tabular-nums text-muted"
              />
              <Td className="text-right tabular-nums">
                {toDecimalString(totals.totalPercent, 4)}%
              </Td>
              <Td className="text-right tabular-nums text-muted">
                {toDecimalString(totals.totalActiveMatterPercent, 2)}%
              </Td>
              <Td className="text-right tabular-nums text-muted">{batchKg || "100"}</Td>
              {show.price && <Td />}
              {show.lineCost && (
                <Td className="text-right tabular-nums" title={t("builder.costBasisTitle")}>
                  {totalCost.sum.isZero()
                    ? "—"
                    : `${displayMoney(totalCost.sum, currency)}${totalCost.complete ? "" : " +"}`}
                </Td>
              )}
              <Td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Findings + group totals */}
      <div className="print-hide max-h-52 shrink-0 overflow-y-auto border-t border-border px-4 py-2">
        {groups.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <span
                key={g.fn}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px]",
                  g.status === "incomplete"
                    ? "bg-warn/10 text-warn"
                    : "bg-surface-2 text-muted",
                )}
                title={
                  g.status === "incomplete"
                    ? t("builder.groupIncompleteTitle", { pct: g.unknownActivePercent })
                    : t("builder.groupActiveTitle")
                }
              >
                {g.fn.replace(/_/g, " ")}: {g.activePercent}%
                {g.status === "incomplete" && ` ${t("builder.incomplete")}`}
              </span>
            ))}
          </div>
        )}
        {findings.length === 0 ? (
          <p className="text-[12px] text-muted">{t("builder.noFindings")}</p>
        ) : (
          <>
            <p className="mb-1 text-[11px] text-muted">
              {t("builder.findingSummary", {
                errors: findings.filter((f) => f.severity === "error" || f.severity === "blocking")
                  .length,
                warnings: findings.filter((f) => f.severity === "warning").length,
              })}
            </p>
            <ul className="space-y-1">
              {findings.map((f) => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  onGoToLine={f.lineId ? () => focusLine(f.lineId!) : undefined}
                  goToLabel={t("builder.goToLine")}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {pickerFor && (
        <MaterialPicker
          materials={materials}
          onPick={(m) => pickMaterial(pickerFor, m)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

/** Columns between the phase column and the percentage column. */
function countLeadingCols(visible: Set<OptionalColumn>): number {
  let n = 2; // material + function are always shown
  for (const c of ["materialCode", "tradeName", "inciName", "supplier"] as const) {
    if (visible.has(c)) n++;
  }
  return n;
}

function severityOf(findings: ValidationFinding[]): ValidationFinding["severity"] | undefined {
  const order = ["blocking", "error", "warning", "info"] as const;
  for (const s of order) if (findings.some((f) => f.severity === s)) return s;
  return undefined;
}

function IconButton({
  onClick,
  disabled,
  label,
  icon,
}: {
  onClick?: () => void;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-input border border-border bg-surface p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
    >
      {icon}
    </button>
  );
}

function ColumnMenu({
  visible,
  onToggle,
}: {
  visible: Set<OptionalColumn>;
  onToggle: (c: OptionalColumn) => void;
}) {
  const { t } = useTranslation("session");
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-muted hover:bg-surface-2"
      >
        {t("builder.columns")} <ChevronDown size={11} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-44 rounded-input border border-border bg-surface p-1 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {OPTIONAL_COLUMNS.map((c) => (
            <label
              key={c}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-text hover:bg-surface-2"
            >
              <input type="checkbox" checked={visible.has(c)} onChange={() => onToggle(c)} />
              {t(`builder.col.${c}`)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Functions are multi-select: a betaine is a surfactant AND a thickener, and
 * forcing one role would corrupt the group totals a specification is checked
 * against.
 */
function FunctionPicker({
  value,
  onChange,
}: {
  value: MaterialFunction[];
  onChange: (fns: MaterialFunction[]) => void;
}) {
  const { t } = useTranslation("session");
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("builder.function")}
        className="w-full truncate rounded border border-transparent px-1 py-0.5 text-left text-[12px] text-text hover:border-border focus:border-accent focus:outline-none"
      >
        {value.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          value.map((f) => f.replace(/_/g, " ")).join(", ")
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-input border border-border bg-surface p-1 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {MATERIAL_FUNCTIONS.map((fn) => (
            <label
              key={fn}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-text hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={value.includes(fn)}
                onChange={() =>
                  onChange(
                    value.includes(fn) ? value.filter((f) => f !== fn) : [...value, fn],
                  )
                }
              />
              {fn.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialPicker({
  materials,
  onPick,
  onClose,
}: {
  materials: RawMaterial[];
  onPick: (m: RawMaterial) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("session");
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = materials.filter((m) => m.active);
    if (!q) return active.slice(0, 60);
    return active
      .filter((m) =>
        [m.code, m.displayName, m.tradeName, m.inciName, ...m.casNumbers, ...m.functions]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
      .slice(0, 60);
  }, [materials, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("builder.pickMaterial")}
    >
      <div
        className="w-[36rem] max-w-[90vw] rounded-card border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder={t("builder.searchMaterials")}
          aria-label={t("builder.searchMaterials")}
          className="w-full border-b border-border bg-transparent px-3 py-2 text-[13px] text-text outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.map((m) => (
            <li key={m.code}>
              <button
                onClick={() => onPick(m)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-surface-2"
              >
                <span className="font-mono text-[11px] text-muted">{m.code}</span>
                <span className="text-text">{m.displayName}</span>
                {m.activeMatterPercent && (
                  <span className="text-[11px] text-muted">{t("builder.activePercent", { pct: m.activeMatterPercent })}</span>
                )}
                {!m.activeMatterPercent && (
                  <span className="text-[11px] text-warn">{t("builder.noActiveData")}</span>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-4 text-center text-[12px] text-muted">
              {t("builder.noMaterials")}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  onGoToLine,
  goToLabel,
}: {
  finding: ValidationFinding;
  onGoToLine?: () => void;
  goToLabel: string;
}) {
  const Icon =
    finding.severity === "blocking"
      ? OctagonAlert
      : finding.severity === "error"
        ? XCircle
        : finding.severity === "warning"
          ? AlertTriangle
          : Info;
  const tone =
    finding.severity === "blocking" || finding.severity === "error"
      ? "text-error"
      : finding.severity === "warning"
        ? "text-warn"
        : "text-muted";
  return (
    <li className="flex items-start gap-1.5 text-[12px]">
      {/* Severity is carried by the icon and the text, not by colour alone. */}
      <Icon size={13} className={cn("mt-0.5 shrink-0", tone)} aria-hidden />
      <span className="sr-only">{finding.severity}: </span>
      <span className={tone}>
        {finding.message}
        {finding.suggestedAction && (
          <span className="text-muted"> {finding.suggestedAction}</span>
        )}
      </span>
      {onGoToLine && (
        <button
          onClick={onGoToLine}
          className="shrink-0 text-[11px] text-accent underline-offset-2 hover:underline"
        >
          {goToLabel}
        </button>
      )}
    </li>
  );
}

function TotalsBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "error" | "neutral";
}) {
  return (
    <span
      className={cn(
        "rounded-input px-2 py-1 text-[11px] tabular-nums",
        tone === "ok" && "bg-ok/10 text-ok",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "error" && "bg-error/10 text-error",
        tone === "neutral" && "bg-surface-2 text-muted",
      )}
    >
      {label} <strong>{value}</strong>
    </span>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-2 py-1.5 font-medium", className)}>{children}</th>;
}

function Td({
  children,
  className,
  colSpan,
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td className={cn("px-2 py-1 align-middle", className)} colSpan={colSpan} title={title}>
      {children}
    </td>
  );
}

/** A borderless grid cell that only looks like an input when engaged. */
function Cell({
  value,
  onChange,
  onPaste,
  placeholder,
  className,
  inputMode,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  placeholder?: string;
  className?: string;
  inputMode?: "decimal" | "text";
  "aria-label"?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onPaste}
      onFocus={(e) => e.target.select()}
      placeholder={placeholder}
      inputMode={inputMode}
      aria-label={ariaLabel}
      className={cn(
        "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-text",
        "hover:border-border focus:border-accent focus:outline-none placeholder:text-muted",
        className,
      )}
    />
  );
}
