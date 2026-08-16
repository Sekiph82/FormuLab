/**
 * Phase 13 closure session — the frontend UI for the four Production
 * Manager workflow gates (`raw_material_verification`,
 * `supplier_document_verification`, `production_engineering_handoff`,
 * `production_release`), previously backend-only (`workflow_gates.rs`).
 *
 * This component never decides who may submit or decide a gate, or
 * whether a subject exists — `authz::authorize_app` and
 * `validate_subject_exists` on the Rust side are authoritative for both.
 * `can()` here (from the same canonical `rolePolicy.ts` matrix Rust's
 * `role_policy.rs` is generated from) only controls which buttons this
 * component *offers* — a worker/manager distinction the backend enforces
 * independently, so hiding a button here is UX, not the security boundary.
 * A rejected gate is not resubmitted through a second code path: submit
 * and resubmit are the same action (`submitWorkflowGate`), because
 * `rejected -> submitted` is a normal edge in the gate's own state machine.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { can } from "@formulab/shared";
import { useTrustedActor } from "@/lib/currentActor";
import {
  decideWorkflowGate,
  readWorkflowGate,
  submitWorkflowGate,
  type WorkflowGateRecord,
  type WorkflowGateType,
} from "@/lib/workflowGates";

const GATE_AREA: Record<WorkflowGateType, string> = {
  raw_material_verification: "rawMaterials",
  supplier_document_verification: "supplierDocuments",
  production_engineering_handoff: "productionEngineering",
  production_release: "production",
};

/** Mirrors `workflow_gates.rs`'s `gate_spec()` `unified_decide_capability`:
 *  the two masterdata gates decide both approve/reject through one
 *  `verify` capability; the two production gates use distinct
 *  `approve`/`reject` capabilities. UI-only mirror — Rust is canonical. */
const UNIFIED_VERIFY: Record<WorkflowGateType, boolean> = {
  raw_material_verification: true,
  supplier_document_verification: true,
  production_engineering_handoff: false,
  production_release: false,
};

function stateIcon(state: string) {
  if (state === "approved") return <CheckCircle2 size={14} className="text-success" />;
  if (state === "rejected") return <XCircle size={14} className="text-error" />;
  if (state === "submitted") return <Clock size={14} className="text-accent" />;
  return <Circle size={14} className="text-muted" />;
}

export function WorkflowGatePanel({
  gateType,
  subjectId,
  parentId,
  heading,
  /** production_engineering_handoff only: the parent formulation version's
   *  current status, so the "must be production_approved first" prerequisite
   *  can be explained before the worker even tries to submit — the caller
   *  (ApprovalPanel) already computes this for its own status display. */
  formulaStatus,
}: {
  gateType: WorkflowGateType;
  subjectId: string;
  parentId?: string;
  heading: string;
  formulaStatus?: string;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as (key: string, opts?: Record<string, unknown>) => string;
  const trusted = useTrustedActor();

  const [record, setRecord] = useState<WorkflowGateRecord | null>(null);
  const [upstreamApproved, setUpstreamApproved] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rec = await readWorkflowGate(gateType, subjectId, parentId);
      setRecord(rec);
      if (gateType === "production_release") {
        const upstream = await readWorkflowGate("production_engineering_handoff", subjectId, parentId);
        setUpstreamApproved(upstream?.state === "approved");
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, [gateType, subjectId, parentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const area = GATE_AREA[gateType];
  const role = trusted?.role;
  const canSubmit = !!role && can(role, area, "edit");
  const canDecide =
    !!role && (UNIFIED_VERIFY[gateType] ? can(role, area, "verify") : can(role, area, "approve") || can(role, area, "reject"));

  const state = record?.state ?? "pending";
  const isRejected = state === "rejected";

  const prerequisiteReason: string | null =
    gateType === "production_engineering_handoff" && formulaStatus !== undefined && formulaStatus !== "production_approved"
      ? t("workflowGate.reasons.handoffPrerequisite", {
          defaultValue: 'Blocked: the formulation version must be "production_approved" first (currently "{{status}}").',
          status: formulaStatus,
        })
      : gateType === "production_release" && upstreamApproved === false
        ? t("workflowGate.reasons.releasePrerequisite", {
            defaultValue: "Blocked: production engineering handoff must be approved first.",
          })
        : null;

  const canSubmitNow = (state === "pending" || isRejected) && canSubmit && !prerequisiteReason;
  const canDecideNow = state === "submitted" && canDecide;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const rec = await submitWorkflowGate(gateType, subjectId, parentId, reason.trim() || undefined);
      setRecord(rec);
      setReason("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      const rec = await decideWorkflowGate(gateType, subjectId, decision, parentId, reason.trim() || undefined);
      setRecord(rec);
      setReason("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="rounded-card border border-border p-3 text-[12px]">
      <div className="mb-2 flex items-center gap-2">
        {stateIcon(state)}
        <span className="font-medium text-text">{heading}</span>
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {t(`workflowGate.states.${state}`, { defaultValue: state })}
        </span>
      </div>

      {record?.submittedBy && (
        <div className="text-muted">
          {t("workflowGate.submittedBy", { defaultValue: "Submitted by {{role}}", role: record.submittedByRole })} — {record.submittedAt}
        </div>
      )}
      {record?.approvedBy && (
        <div className="text-success">
          {t("workflowGate.approvedBy", { defaultValue: "Approved by {{role}}", role: record.approvedByRole })} — {record.approvedAt}
        </div>
      )}
      {record?.rejectedBy && (
        <div className="text-error">
          {t("workflowGate.rejectedBy", { defaultValue: "Rejected by {{role}}", role: record.rejectedByRole })} — {record.rejectedAt}
          {record.reason ? ` — ${record.reason}` : ""}
        </div>
      )}
      {isRejected && canSubmit && (
        <div className="mt-1 text-accent">{t("workflowGate.resubmitAvailable", { defaultValue: "Resubmission is available." })}</div>
      )}

      {prerequisiteReason && <div className="mt-2 rounded-input bg-warning/10 px-2 py-1 text-warning">{prerequisiteReason}</div>}
      {error && (
        <div role="alert" className="mt-2 rounded-input bg-error/10 px-2 py-1 text-error">
          {error}
        </div>
      )}

      {(canSubmitNow || canDecideNow) && (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("workflowGate.reasonPlaceholder", { defaultValue: "Note (optional)" })}
            className="rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text"
          />
          <div className="flex gap-2">
            {canSubmitNow && (
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="rounded-input bg-accent px-2 py-1 text-[11px] text-white disabled:opacity-50"
              >
                {isRejected ? t("workflowGate.resubmit", { defaultValue: "Resubmit" }) : t("workflowGate.submit", { defaultValue: "Submit for verification" })}
              </button>
            )}
            {canDecideNow && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("approved")}
                  className="rounded-input bg-success px-2 py-1 text-[11px] text-white disabled:opacity-50"
                >
                  {t("workflowGate.approve", { defaultValue: "Approve" })}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("rejected")}
                  className="rounded-input bg-error px-2 py-1 text-[11px] text-white disabled:opacity-50"
                >
                  {t("workflowGate.reject", { defaultValue: "Reject" })}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!canSubmitNow && !canDecideNow && !prerequisiteReason && (
        <div className="mt-2 text-muted">
          {state === "approved"
            ? t("workflowGate.reasons.terminal", { defaultValue: "Approved — no further action available." })
            : !role
              ? t("workflowGate.reasons.noSession", { defaultValue: "Sign in to act on this gate." })
              : state === "submitted"
                ? t("workflowGate.reasons.awaitingDecision", { defaultValue: "Awaiting a Production Manager decision." })
                : t("workflowGate.reasons.wrongRole", { defaultValue: "Your role cannot act on this gate." })}
        </div>
      )}
    </div>
  );
}
