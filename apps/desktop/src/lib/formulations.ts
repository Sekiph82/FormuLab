/**
 * Formulation persistence + the working copy the builder edits.
 *
 * The builder edits a draft in memory and saves it as a NEW immutable version.
 * There is deliberately no "update this version" path: a version is what a
 * batch record, an export or an audit trail points at, so changing one after
 * the fact would rewrite history.
 */
import type {
  ApprovalRecord,
  AttachmentReference,
  AuditEvent,
  Formulation,
  FormulationDraft,
  FormulationLine,
  FormulationVersion,
  MaterialFunction,
} from "@ai4s/shared";
import { newId } from "@ai4s/shared";
import { isTauri } from "./tauri";

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface FormulationWithVersions {
  formulation: Formulation;
  versions: FormulationVersion[];
}

export async function listFormulations(): Promise<Formulation[]> {
  if (!isTauri) return [];
  return call<Formulation[]>("list_formulations");
}

export async function readFormulation(id: string): Promise<FormulationWithVersions> {
  return call<FormulationWithVersions>("read_formulation", { id });
}

export async function saveFormulation(formulation: Formulation): Promise<Formulation> {
  return call<Formulation>("save_formulation", { formulation });
}

/** Append an immutable version. Rejected if the id already exists. */
export async function saveFormulationVersion(
  version: FormulationVersion,
): Promise<FormulationVersion> {
  return call<FormulationVersion>("save_formulation_version", { version });
}

export async function deleteFormulation(id: string): Promise<void> {
  return call<void>("delete_formulation", { id });
}

// ------------------------------------------------------------------ drafts ---

/** The working copy. Autosave writes here; versions are saved deliberately. */
export async function readDraft(
  formulationId: string,
): Promise<FormulationDraft | null> {
  if (!isTauri) return null;
  return call<FormulationDraft | null>("read_formulation_draft", { formulationId });
}

export async function saveDraft(draft: FormulationDraft): Promise<FormulationDraft> {
  return call<FormulationDraft>("save_formulation_draft", { draft });
}

export async function discardDraft(formulationId: string): Promise<void> {
  return call<void>("discard_formulation_draft", { formulationId });
}

// ------------------------------------------------------- approvals + audit ---

export async function saveApprovalRecord(
  record: ApprovalRecord,
): Promise<ApprovalRecord> {
  return call<ApprovalRecord>("save_approval_record", { record });
}

export async function listApprovalRecords(
  formulationId: string,
): Promise<ApprovalRecord[]> {
  if (!isTauri) return [];
  return call<ApprovalRecord[]>("list_approval_records", { formulationId });
}

/** Append-only. Every status change, save and import lands here. */
export async function appendAudit(event: AuditEvent): Promise<void> {
  if (!isTauri) return;
  return call<void>("append_audit_event", { event });
}

export async function readAuditLog(formulationId: string): Promise<AuditEvent[]> {
  if (!isTauri) return [];
  return call<AuditEvent[]>("read_audit_log", { formulationId });
}

// ----------------------------------------------------------- attachments ---

/** The Rust command always populates every field — unlike `AttachmentReference`
 *  itself, whose corresponding fields are optional only because they are
 *  absent on attachments recorded before this phase. */
interface AttachmentCopyResult {
  location: string;
  originalFileName: string;
  fileCategory: NonNullable<AttachmentReference["fileCategory"]>;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * Copy a user-picked file (from `pickFile()` in `./tauri`) into the
 * formulation's own attachments folder, returning the metadata an
 * `AttachmentReference` needs. Rejects any file outside the allow-listed
 * categories (image/PDF/spreadsheet/text document) — see
 * `src-tauri/src/attachments.rs`.
 */
export async function copyAttachmentIntoProject(
  formulationId: string,
  sourcePath: string,
): Promise<AttachmentCopyResult> {
  return call<AttachmentCopyResult>("copy_attachment_into_project", { formulationId, sourcePath });
}

export async function openAttachment(formulationId: string, location: string): Promise<void> {
  return call<void>("open_attachment", { formulationId, location });
}

export function auditEvent(
  formulationId: string,
  action: string,
  opts: {
    versionId?: string;
    actor?: string;
    actorKind?: AuditEvent["actorKind"];
    detail?: string;
    metadata?: Record<string, string>;
  } = {},
): AuditEvent {
  return {
    id: newId("audit"),
    formulationId,
    versionId: opts.versionId,
    at: new Date().toISOString(),
    actor: opts.actor ?? "local",
    actorKind: opts.actorKind ?? "human",
    action,
    detail: opts.detail,
    metadata: opts.metadata,
  };
}

// ------------------------------------------------------------- draft helpers ---

export { newId };

export function emptyLine(lineNumber: number, phase = "A"): FormulationLine {
  return {
    id: newId("line"),
    lineNumber,
    phase,
    displayName: "",
    percent: "0",
    isQsToHundred: false,
    functions: [],
    // An operator-entered value is a chemist's decision, not a model's guess.
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

export function newFormulation(
  name: string,
  productFamilyCode: string,
  opts: {
    code?: string;
    targetSkuCodes?: string[];
    targetMarkets?: string[];
    brief?: string;
    targetClaims?: string[];
    targetBatchKg?: string;
  } = {},
): Formulation {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("formulation"),
    // The project code is the handle a batch record and an ERP row will use, so
    // a chemist may set it; the generated fallback is only there to guarantee
    // one exists.
    code: opts.code?.trim() || `${productFamilyCode}-${Date.now().toString(36).toUpperCase()}`,
    name,
    productFamilyCode,
    targetSkuCodes: opts.targetSkuCodes ?? [],
    targetMarkets: opts.targetMarkets ?? ["KE"],
    brief: opts.brief,
    targetClaims: opts.targetClaims ?? [],
    targetBatchKg: opts.targetBatchKg ?? "100",
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

export function newVersion(
  formulationId: string,
  lines: FormulationLine[],
  opts: {
    versionNumber: number;
    parentVersionId?: string;
    changeReason?: string;
    basisBatchKg?: string;
  },
): FormulationVersion {
  return {
    schemaVersion: "1.0",
    id: newId("version"),
    formulationId,
    versionNumber: opts.versionNumber,
    parentVersionId: opts.parentVersionId,
    // A new version always starts as a draft. Reaching an approved status is a
    // separate, human, audited step.
    status: "concept",
    author: "local",
    createdAt: new Date().toISOString(),
    changeReason: opts.changeReason,
    lines,
    basisBatchKg: opts.basisBatchKg ?? "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  };
}

/** Convert a generated card's formula JSON into editable builder lines. */
export function linesFromGeneratedFormula(formula: unknown): FormulationLine[] {
  const ingredients =
    (formula as { ingredients?: Record<string, unknown>[] })?.ingredients ?? [];
  return ingredients.map((ing, i) => {
    const raw = String(ing.weight_pct ?? "").trim();
    const isQs = /q\.?s\.?/i.test(raw);
    const numeric = raw.replace(/[^\d.]/g, "");
    return {
      id: newId("line"),
      lineNumber: i + 1,
      phase: "A",
      displayName: String(ing.inci ?? ing.name ?? ""),
      inciName: String(ing.inci ?? ""),
      percent: isQs ? "0" : numeric || "0",
      isQsToHundred: isQs,
      functions: guessFunctions(String(ing.function ?? "")),
      // Carried through honestly: the model proposed this number.
      provenance: { origin: "model_estimate", evidenceClaimIds: [] },
    };
  });
}

/**
 * Map the model's free-text function label onto our functional groups. Only
 * unambiguous matches are taken — a wrong group would corrupt the group totals
 * a specification limit is checked against, so anything unclear is left empty
 * for a chemist to set.
 */
function guessFunctions(label: string): MaterialFunction[] {
  const l = label.toLowerCase();
  const hits: MaterialFunction[] = [];
  const rules: [RegExp, MaterialFunction][] = [
    [/\bwater|aqua\b/, "water"],
    [/anionic/, "anionic_surfactant"],
    [/amphoteric|betaine/, "amphoteric_surfactant"],
    [/nonionic|glucoside/, "nonionic_surfactant"],
    [/cationic|quat/, "cationic_surfactant"],
    [/preservat/, "preservative"],
    [/chelat|sequestr/, "chelating_agent"],
    [/humectant/, "humectant"],
    [/emollient/, "emollient"],
    [/condition/, "conditioning_agent"],
    [/thicken|rheolog|viscosity/, "rheology_modifier"],
    [/\bph\b|acidifier|alkali/, "ph_adjuster"],
    [/fragrance|parfum/, "fragrance"],
    [/colou?r/, "colorant"],
    [/builder/, "builder"],
    [/abrasive/, "abrasive"],
    [/solvent/, "solvent"],
    [/fluoride/, "fluoride_active"],
    [/enzyme/, "enzyme"],
    [/bleach/, "bleaching_agent"],
    [/opacif/, "opacifier"],
    [/\bfiller\b/, "filler"],
  ];
  for (const [re, fn] of rules) if (re.test(l)) hits.push(fn);
  // "Surfactant" alone does not say which class, and guessing would be worse
  // than leaving it for the chemist.
  return [...new Set(hits)];
}
