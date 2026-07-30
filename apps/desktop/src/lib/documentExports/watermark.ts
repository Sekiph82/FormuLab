/**
 * Phase 8 — the one place a document export decides whether it needs a
 * draft/unapproved warning. Reuses `draftWatermark()` from
 * `@formulab/shared` (`engine/exports.ts`) for the exact warning text every
 * other export in this app already uses — never a second, parallel
 * watermark string.
 */
import { draftWatermark, type FormulaStatus, type WatermarkState } from "@formulab/shared";

export interface DocumentWatermark {
  state: WatermarkState;
  /** `null` only when the source is confirmed production-approved. */
  text: string | null;
}

/**
 * `undefined` means the source's approval status was never supplied to
 * the assembly step — that is NOT the same as "known to be a draft", so
 * it gets its own distinct warning text rather than being folded into
 * `"draft"`. Anything else short of `production_approved` reuses
 * `draftWatermark()`'s exact string.
 */
export function computeSnapshotWatermark(approvalStatus: FormulaStatus | undefined): DocumentWatermark {
  if (approvalStatus === undefined) {
    return { state: "unapproved", text: "APPROVAL STATUS UNKNOWN — NOT CONFIRMED PRODUCTION APPROVED" };
  }
  const text = draftWatermark(approvalStatus);
  if (text === null) return { state: "none", text: null };
  return { state: approvalStatus === "concept" ? "draft" : "unapproved", text };
}
