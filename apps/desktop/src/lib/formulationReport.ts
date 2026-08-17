// Phase 14 Session 6 correction gate — a dedicated report document,
// independent of the currently-active tab, selected version, scroll
// position, or any overflow/clipped container. Built as a plain HTML
// string directly from the already-loaded `SessionDetail` (the same data
// the result screen itself renders), never from the live app DOM — this is
// what makes it complete regardless of what the user currently has open.
import type { FormulationCard, LiteratureDocument, SessionDetail } from "./formulationV2";
import { asGeneratedFormula } from "./generatedFormula";

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function section(title: string, body: string): string {
  return `<section class="report-section"><h2>${esc(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: (string | number | undefined)[][]): string {
  if (rows.length === 0) return `<p class="muted">None.</p>`;
  const thead = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function versionSection(card: FormulationCard): string {
  const formula = asGeneratedFormula(card.formula);
  const ingredients = formula?.ingredients ?? [];
  const origins = card.ingredient_origins ?? {};
  const rows = ingredients.map((i) => {
    const key = (i.inci ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return [i.inci ?? "", i.function ?? "", i.weight_pct ?? "", (origins[key] ?? []).join(", ")];
  });
  const parts: string[] = [];
  parts.push(`<h3>${esc(card.version.toUpperCase())} — ${esc(card.strategy?.title ?? "")}</h3>`);
  parts.push(`<p class="muted">${esc(card.strategy?.rationale ?? "")}</p>`);
  parts.push(`<p><strong>Formula state:</strong> ${esc(card.formula_state ?? "—")} &nbsp; <strong>Mass balance:</strong> ${esc(card.mass_balance?.status ?? "—")} (${esc(card.mass_balance?.final_total ?? "—")}%)</p>`);
  parts.push(table(["Ingredient", "Function", "Weight %", "Origin"], rows));

  if (card.quality_gate && card.quality_gate.length > 0) {
    parts.push(`<h4>Quality Gate Findings</h4>`);
    parts.push(table(["Factor", "Severity", "Message"], card.quality_gate.map((f) => [f.factor, f.severity, f.message])));
  }

  if (card.manufacturing?.ready) {
    parts.push(`<h4>Manufacturing Procedure</h4>`);
    parts.push(table(
      ["#", "Phase", "Ingredients", "Instruction", "Temp", "Time", "Basis"],
      card.manufacturing.steps.map((s) => [s.order, s.phase, s.ingredients.join(", "), s.instruction, s.temperature_c ?? "—", s.time_minutes ?? "—", s.basis]),
    ));
    parts.push(`<h4>Critical Parameters</h4>`);
    parts.push(table(
      ["Parameter", "Type", "Range/Limit", "Source", "Confidence"],
      card.manufacturing.critical_parameters.map((p) => [p.parameter, p.param_type, p.range_or_limit, p.source_type, p.confidence]),
    ));
    parts.push(`<h4>Equipment</h4>`);
    parts.push(table(
      ["Equipment", "Purpose", "Requirement", "Capacity", "Available"],
      card.manufacturing.equipment.map((e) => [e.equipment, e.purpose, e.requirement_level, e.suggested_capacity, e.available_in_facility]),
    ));
  } else if (card.manufacturing) {
    parts.push(`<p class="muted">Manufacturing: ${esc(card.manufacturing.not_ready_reason)}</p>`);
  }

  if (card.safety) {
    parts.push(`<h4>Safety — Overall: ${esc(card.safety.overall_status)}</h4>`);
    parts.push(table(
      ["Subject", "Status", "Rule", "Rationale"],
      card.safety.findings.map((f) => [f.subject, f.status, f.rule_id, f.rationale]),
    ));
  }
  if (card.regulatory) {
    parts.push(`<h4>Regulatory — Market: ${esc(card.regulatory.target_market || "unspecified")}, Overall: ${esc(card.regulatory.overall_status)} (${esc(card.regulatory.coverage)})</h4>`);
    parts.push(table(
      ["Subject", "Status", "Rule", "Rationale"],
      card.regulatory.findings.map((f) => [f.subject, f.status, f.rule_id, f.rationale]),
    ));
    parts.push(`<h5>Claim Review</h5>`);
    parts.push(table(["Claim", "Type", "Status"], card.regulatory.claims.map((c) => [c.claim, c.check_type, c.status])));
  }
  if (card.evidence_gaps && card.evidence_gaps.length > 0) {
    parts.push(`<h4>Evidence Gaps</h4>`);
    parts.push(table(["Category", "Gap"], card.evidence_gaps.map((g) => [g.category, g.gap])));
  }
  if (card.validation_plan && card.validation_plan.length > 0) {
    parts.push(`<h4>Validation Plan</h4>`);
    parts.push(table(["Check", "Reason"], card.validation_plan.map((v) => [v.check, v.reason])));
  }
  return parts.join("\n");
}

function sourcesTable(literature: LiteratureDocument[]): string {
  return table(
    ["Title", "Authors", "Year", "DOI", "Full Text", "Discovered Via", "Resolved Via"],
    literature.map((d) => [
      d.title, d.authors, d.year, d.doi,
      d.pdf_file ? "Yes" : (d.fulltext || "No"),
      (d.provenance_sources ?? [d.source_db]).join(" + "),
      d.resolved_via || "—",
    ]),
  );
}

export function buildReportHtml(session: SessionDetail, sessionId: string): string {
  const generatedAt = new Date().toISOString();
  const corpus = session.cards[0]?.research_corpus;
  const style = `
    body { font-family: system-ui, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #ccc; }
    h3 { font-size: 14px; margin-top: 20px; } h4 { font-size: 12px; margin-top: 14px; } h5 { font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10.5px; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .report-section { page-break-before: always; }
    .report-section:first-of-type { page-break-before: auto; }
    .muted { color: #666; font-size: 11px; }
    @page { size: A4; margin: 16mm; }
  `;
  const body = [
    `<h1>FormuLab — Formulation Report</h1>`,
    `<p class="muted">Generated ${esc(generatedAt)} — Session ${esc(sessionId)}</p>`,
    section("Original Request", `<p>${esc(session.brief?.target ?? "—")}</p>`),
    corpus ? section("Research", `<p>Full-text sources: ${esc(corpus.full_text_count)}/${esc(corpus.target_count)} &nbsp; Relevant candidates: ${esc(corpus.qualifying_count)}/${esc(corpus.target_count)} &nbsp; Evidence records: ${esc(corpus.evidence_record_count)} &nbsp; Unique studies: ${esc(corpus.unique_evidence_study_count)}</p>`) : "",
    section("Version Overview", table(
      ["Version", "Strategy", "State", "Mass Balance"],
      session.cards.map((c) => [c.version, c.strategy?.title ?? "—", c.formula_state ?? c.status, c.mass_balance?.status ?? "—"]),
    )),
    ...session.cards.map((c) => section(`Formula ${c.version.toUpperCase()}`, versionSection(c))),
    section("Evidence & Sources", sourcesTable(session.literature ?? [])),
  ].join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>FormuLab Report — ${esc(sessionId)}</title><style>${style}</style></head><body>${body}</body></html>`;
}

/** Opens the report in a new window and triggers print. Real browser API,
 *  not a screenshot of the current viewport. */
export function openAndPrintReport(session: SessionDetail, sessionId: string): void {
  const html = buildReportHtml(session, sessionId);
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
