import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ShieldAlert } from "lucide-react";
import {
  APPROVAL_ROLES,
  LABORATORY_METHOD_MANAGER_ROLES,
  SEED_LABORATORY_STANDARDS,
  SEED_LABORATORY_TEST_METHODS,
  assignMethodToTest,
  assertNoDuplicateAssignment,
  assertSupersededAcknowledged,
  assertUniqueStandardCode,
  createInternalStandard,
  isAuthorizedLaboratoryMethodActor,
  newId,
  type ApprovalRole,
  type Actor,
  type LaboratoryStandard,
  type LaboratoryTestMethod,
  type TestDefinition,
} from "@formulab/shared";
import { listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";
import { InfoTooltip } from "@/components/help/InfoTooltip";
import { DisabledActionButton } from "@/components/help/DisabledActionButton";
import type { DisabledReason } from "@/lib/help/disabledReason";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const DEFAULT_STANDARD_STATUS: LaboratoryStandard["status"] = "draft";

/** Built directly from the same guards `engine/laboratoryStandards.ts`
 *  itself enforces (`isAuthorizedLaboratoryMethodActor`,
 *  `assertSupersededAcknowledged`) — never a separately-invented reason. */
function makePrimaryDisabledReason(
  t: SimpleT,
  authorized: boolean,
  standard: LaboratoryStandard | undefined,
  acknowledgedSupersededId: string | null,
): DisabledReason | null {
  if (!authorized) {
    return {
      code: "laboratory_method_not_authorized",
      messageKey: "tests.method.disabledReason",
      requiredRole: LABORATORY_METHOD_MANAGER_ROLES.join(", "),
      relatedTopicId: "laboratory",
      resolvable: false,
    };
  }
  if (standard?.status === "superseded" && acknowledgedSupersededId !== standard.id) {
    return {
      code: "laboratory_method_superseded_unacknowledged",
      messageKey: "tests.method.supersededBlockReason",
      prerequisite: t("tests.method.acknowledgeSuperseded"),
      relatedTopicId: "laboratory",
      resolvable: true,
    };
  }
  return null;
}

/**
 * Per-test standard/method inspector — opened from `TestDefinitionsPanel`'s
 * own row, scoped to exactly one `TestDefinition`. Reads/writes the
 * `laboratory_standards`/`laboratory_test_methods` master collections
 * directly (same thin-binding convention `TestDefinitionsPanel` already
 * uses for `test_definitions`) rather than introducing a second data layer.
 * A side drawer, not a route or a second inspector — matches
 * `ConfirmDialog.tsx`'s overlay/Escape/focus conventions, scaled up.
 */
export function TestMethodDrawer({ definition, onClose }: { definition: TestDefinition; onClose: () => void }) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const [standards, setStandards] = useState<LaboratoryStandard[]>([]);
  const [methods, setMethods] = useState<LaboratoryTestMethod[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingRole, setActingRole] = useState<ApprovalRole>("research_manager");
  const [actingUserId, setActingUserId] = useState("");
  const [acknowledgedSupersededId, setAcknowledgedSupersededId] = useState<string | null>(null);
  const [showCreateInternal, setShowCreateInternal] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    openerFocusRef.current = document.activeElement;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (openerFocusRef.current instanceof HTMLElement) openerFocusRef.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void Promise.all([
      listRecordsSeeded("laboratory_standards", SEED_LABORATORY_STANDARDS),
      listRecordsSeeded("laboratory_test_methods", SEED_LABORATORY_TEST_METHODS),
    ]).then(([s, m]) => {
      setStandards(s);
      setMethods(m);
    });
  }, []);

  const actor: Actor = useMemo(() => ({ kind: "human", role: actingRole, userId: actingUserId || "unknown" }), [actingRole, actingUserId]);
  const authorized = isAuthorizedLaboratoryMethodActor(actor);

  const testMethods = methods.filter((m) => m.testDefinitionCode === definition.code);
  const primary = testMethods.find((m) => m.assignmentType === "primary");
  const alternatives = testMethods.filter((m) => m.assignmentType === "alternative");
  const selected = testMethods.find((m) => m.id === selectedMethodId) ?? primary ?? testMethods[0];
  const selectedStandard = selected ? standards.find((s) => s.id === selected.standardId) : undefined;

  const makePrimary = async (methodId: string) => {
    const target = methods.find((m) => m.id === methodId);
    const standard = target ? standards.find((s) => s.id === target.standardId) : undefined;
    if (standard) {
      try {
        assertSupersededAcknowledged(standard, acknowledgedSupersededId === standard.id);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
        return;
      }
    }
    try {
      const updated = assignMethodToTest(methods, methodId, "primary", actor);
      await upsertMethods(updated, methods, setMethods, setError);
      setAcknowledgedSupersededId(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("tests.method.title", { name: definition.name })}
        tabIndex={-1}
        className="flex h-full w-full max-w-[520px] flex-col border-l border-border bg-surface shadow-card outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-faint px-4 py-3">
          <h2 className="text-[13px] font-medium text-text">{t("tests.method.title", { name: definition.name })}</h2>
          <button aria-label={t("tests.method.close")} onClick={onClose} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error && (
            <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
              {error}
            </div>
          )}

          <div className="mb-3 flex items-start gap-2 rounded-input border border-border-faint bg-surface-2 px-2.5 py-2 text-[11px] text-muted">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <p>{t("tests.method.copyrightNotice")}</p>
          </div>

          {definition.methodReference && testMethods.length === 0 && (
            <p className="mb-3 rounded-input border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] text-text">
              {t("tests.method.legacyReference", { ref: definition.methodReference })}
            </p>
          )}

          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("tests.method.actingRole")}</span>
              <select value={actingRole} onChange={(e) => setActingRole(e.target.value as ApprovalRole)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text">
                {APPROVAL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("tests.method.actingUserId")}</span>
              <input value={actingUserId} onChange={(e) => setActingUserId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text" />
            </label>
          </div>
          {/* Per-action disabled reasons (e.g. "Make primary") are shown next
              to their own button via DisabledActionButton below — this note
              only covers the "Create internal method" action, which is
              hidden rather than shown-disabled since it is a create action,
              not a transition on an existing row. */}
          {!authorized && <p className="mb-3 text-[11px] text-muted">{t("tests.method.createInternalHiddenReason")}</p>}

          <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("tests.method.sections.alternativeStandards")}
            <InfoTooltip
              title={t("tests.method.snapshotInfoTitle")}
              body={t("tests.method.snapshotInfoBody")}
              learnMoreTopicId="laboratory"
            />
          </h3>
          {testMethods.length === 0 && <p className="mb-3 text-[12px] text-muted">{t("tests.method.noneAssigned")}</p>}
          <div className="mb-3 space-y-1.5">
            {[...(primary ? [primary] : []), ...alternatives].map((m) => {
              const standard = standards.find((s) => s.id === m.standardId);
              const isSelected = selected?.id === m.id;
              const standardStatus = standard?.status ?? DEFAULT_STANDARD_STATUS;
              return (
                <div
                  key={m.id}
                  className={cn("cursor-pointer rounded-card border px-2.5 py-1.5 text-[11px]", isSelected ? "border-accent" : "border-border")}
                  onClick={() => setSelectedMethodId(m.id)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={m.assignmentType} label={t(`tests.method.${m.assignmentType}`)} />
                    <InfoTooltip
                      title={t("tests.method.primaryVsAlternativeTitle")}
                      body={t("tests.method.primaryVsAlternativeBody")}
                      learnMoreTopicId="laboratory"
                    />
                    <span className="font-medium text-text">{standard?.standardCode ?? m.standardId}</span>
                    {standard?.edition && <span className="text-muted">{t("tests.method.editionLabel")}: {standard.edition}</span>}
                    {standard?.revision && <span className="text-muted">{t("tests.method.revisionLabel")}: {standard.revision}</span>}
                    <StatusBadge status={standardStatus} label={t(`tests.method.status${capitalize(standardStatus)}`)} />
                    <InfoTooltip
                      title={t("tests.method.statusExplainerTitle")}
                      body={t("tests.method.statusExplainerBody")}
                      learnMoreTopicId="laboratory"
                    />
                    {m.assignmentType !== "primary" && (
                      <DisabledActionButton
                        reason={makePrimaryDisabledReason(t, authorized, standard, acknowledgedSupersededId)}
                        onClick={() => void makePrimary(m.id)}
                        wrapperClassName="ml-auto"
                        ns="session"
                        className="rounded-input border border-accent px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
                      >
                        {t("tests.method.makePrimary")}
                      </DisabledActionButton>
                    )}
                  </div>
                  {standard?.status === "superseded" && (
                    <label className="mt-1 flex items-center gap-1 text-[10px] text-warning">
                      <input
                        type="checkbox"
                        checked={acknowledgedSupersededId === standard.id}
                        onChange={(e) => setAcknowledgedSupersededId(e.target.checked ? standard.id : null)}
                      />
                      {t("tests.method.acknowledgeSuperseded")}
                    </label>
                  )}
                  {m.updatedBy && (
                    <p className="mt-1 text-[10px] text-muted">{t("tests.method.lastChangedBy", { who: m.updatedBy, when: m.updatedAt })}</p>
                  )}
                </div>
              );
            })}
          </div>

          {authorized && (
            <div className="mb-3">
              <button onClick={() => setShowCreateInternal((v) => !v)} className="text-[11px] text-accent hover:underline">
                {t("tests.method.createInternal")}
              </button>
              {showCreateInternal && (
                <CreateInternalMethodForm
                  t={t}
                  actor={actor}
                  definition={definition}
                  standards={standards}
                  methods={methods}
                  onCreated={(nextStandards, nextMethods) => {
                    setStandards(nextStandards);
                    setMethods(nextMethods);
                    setShowCreateInternal(false);
                  }}
                  onError={setError}
                />
              )}
            </div>
          )}

          {selected && selectedStandard && <MethodDetailSections t={t} method={selected} standard={selectedStandard} />}
        </div>
      </div>
    </div>
  );
}

async function upsertMethods(
  next: LaboratoryTestMethod[],
  previous: LaboratoryTestMethod[],
  setMethods: (m: LaboratoryTestMethod[]) => void,
  setError: (e: string | null) => void,
) {
  const changed = next.filter((m, i) => m !== previous[i]);
  try {
    if (changed.length > 0) await upsertRecords("laboratory_test_methods", changed);
    setMethods(next);
  } catch (e) {
    setError(String(e instanceof Error ? e.message : e));
  }
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "active" || status === "primary"
      ? "border-accent/50 text-accent"
      : status === "superseded"
        ? "border-error/50 text-error"
        : status === "internal" || status === "alternative"
          ? "border-border text-muted"
          : "border-warning/50 text-warning";
  return <span className={cn("rounded-input border px-1.5 py-0.5 text-[10px] uppercase tracking-wide", tone)}>{label}</span>;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function CreateInternalMethodForm({
  t,
  actor,
  definition,
  standards,
  methods,
  onCreated,
  onError,
}: {
  t: SimpleT;
  actor: Actor;
  definition: TestDefinition;
  standards: LaboratoryStandard[];
  methods: LaboratoryTestMethod[];
  onCreated: (standards: LaboratoryStandard[], methods: LaboratoryTestMethod[]) => void;
  onError: (e: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [org, setOrg] = useState("");

  const submit = async () => {
    try {
      const standard = createInternalStandard(actor, { standardCode: code, title, issuingOrganization: org || "Internal" }, standards);
      assertUniqueStandardCode(standards, standard);
      const now = new Date().toISOString();
      const method: LaboratoryTestMethod = {
        schemaVersion: "1.0",
        id: newId("labmethod"),
        testDefinitionCode: definition.code,
        standardId: standard.id,
        methodName: title,
        assignmentType: methods.some((m) => m.testDefinitionCode === definition.code && m.assignmentType === "primary") ? "alternative" : "primary",
        status: "draft",
        requiredEquipment: [],
        reagentsAndConsumables: [],
        instrumentSettings: [],
        procedureSteps: [],
        safetyWarnings: [],
        relatedTestDefinitionCodes: [],
        createdAt: now,
        updatedAt: now,
      };
      assertNoDuplicateAssignment(methods, method);
      await upsertRecords("laboratory_standards", [standard]);
      await upsertRecords("laboratory_test_methods", [method]);
      onCreated([...standards, standard], [...methods, method]);
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="mt-2 space-y-1.5 rounded-card border border-border-faint px-2.5 py-2">
      <input placeholder={t("tests.method.internalStandardCode")} value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px]" />
      <input placeholder={t("tests.method.internalStandardTitle")} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px]" />
      <input placeholder={t("tests.method.internalIssuingOrg")} value={org} onChange={(e) => setOrg(e.target.value)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px]" />
      <button
        disabled={!code || !title}
        onClick={() => void submit()}
        className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("common:actions.save")}
      </button>
    </div>
  );
}

function MethodDetailSections({ t, method, standard }: { t: SimpleT; method: LaboratoryTestMethod; standard: LaboratoryStandard }) {
  const empty = t("tests.method.emptySection");
  const listOrEmpty = (items: string[]) => (items.length > 0 ? <ul className="list-disc pl-4">{items.map((i, idx) => <li key={idx}>{i}</li>)}</ul> : empty);
  const textOrEmpty = (v: string | undefined) => v || empty;

  const sections: { titleKey: string; content: React.ReactNode }[] = [
    { titleKey: "overview", content: textOrEmpty(standard.summary) },
    { titleKey: "scope", content: textOrEmpty([standard.jurisdiction.join(", "), standard.applicableProductCategories.join(", ")].filter(Boolean).join(" — ") || undefined) },
    { titleKey: "equipment", content: listOrEmpty(method.requiredEquipment) },
    { titleKey: "reagents", content: listOrEmpty(method.reagentsAndConsumables) },
    { titleKey: "samplePrep", content: textOrEmpty(method.samplePreparation) },
    {
      titleKey: "instrumentSetup",
      content:
        method.instrumentSettings.length > 0 || method.calibrationRequirements ? (
          <>
            {method.calibrationRequirements && <p>{method.calibrationRequirements}</p>}
            {method.instrumentSettings.length > 0 && (
              <ul className="list-disc pl-4">
                {method.instrumentSettings.map((s, idx) => (
                  <li key={idx}>
                    {s.parameter}: {s.value}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          empty
        ),
    },
    { titleKey: "conditioning", content: textOrEmpty([method.conditioningRequirements, method.environmentalConditions, method.duration].filter(Boolean).join(" — ") || undefined) },
    { titleKey: "procedure", content: listOrEmpty(method.procedureSteps) },
    { titleKey: "calculations", content: textOrEmpty(method.calculationMethod) },
    { titleKey: "acceptanceCriteria", content: textOrEmpty(method.acceptanceCriteria) },
    { titleKey: "resultInterpretation", content: textOrEmpty(method.resultInterpretation) },
    { titleKey: "troubleshooting", content: textOrEmpty(method.troubleshootingNotes) },
    { titleKey: "repeatTest", content: textOrEmpty(method.repeatTestRules) },
    { titleKey: "safety", content: listOrEmpty(method.safetyWarnings) },
    { titleKey: "wasteDisposal", content: textOrEmpty(method.wasteDisposalNotes) },
    { titleKey: "relatedTests", content: listOrEmpty(method.relatedTestDefinitionCodes) },
    {
      titleKey: "revisionSource",
      content: (
        <>
          <p>
            {standard.standardCode}
            {standard.edition ? ` (${standard.edition})` : ""}
            {standard.revision ? ` rev. ${standard.revision}` : ""} — {standard.issuingOrganization}
          </p>
          {standard.sourceReference && <p className="text-muted">{standard.sourceReference}</p>}
          {standard.copyrightNote && <p className="text-muted">{standard.copyrightNote}</p>}
          {standard.knownLimitations && <p className="text-muted">{standard.knownLimitations}</p>}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.titleKey}>
          <h4 className="mb-1 text-[11px] font-medium text-text">{t(`tests.method.sections.${s.titleKey}`)}</h4>
          <div className="text-[11px] text-muted">{s.content}</div>
        </div>
      ))}
    </div>
  );
}
