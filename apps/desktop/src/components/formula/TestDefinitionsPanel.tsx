import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import {
  newId,
  PASS_FAIL_RULES,
  SEED_TEST_DEFINITIONS,
  TEST_RESULT_TYPES,
  TEST_VERIFICATION_STATUSES,
  type TestDefinition,
} from "@ai4s/shared";
import { listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

export function TestDefinitionsPanel() {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const [definitions, setDefinitions] = useState<TestDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listRecordsSeeded("test_definitions", SEED_TEST_DEFINITIONS).then(setDefinitions);
  }, []);

  const save = async (def: TestDefinition) => {
    try {
      await upsertRecords("test_definitions", [def]);
      setDefinitions((prev) => prev.map((d) => (d.code === def.code ? def : d)));
    } catch (e) {
      setError(String(e));
    }
  };

  const addNew = async () => {
    const now = new Date().toISOString();
    const def: TestDefinition = {
      schemaVersion: "1.0",
      code: newId("TEST"),
      name: t("tests.newDefinitionName"),
      category: "custom",
      resultType: "numeric",
      replicatesRequired: 1,
      requiredEquipment: [],
      requiredAttachment: false,
      applicableProductFamilies: [],
      applicableProductSkus: [],
      criticalTestFlag: false,
      verificationStatus: "not_verified",
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await save(def);
  };

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-text">{t("tests.heading")}</h3>
        <button onClick={() => void addNew()} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
          <Plus size={12} /> {t("tests.addDefinition")}
        </button>
      </div>
      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {definitions.map((def) => (
          <DefinitionRow key={def.code} definition={def} onSave={save} t={t} />
        ))}
      </div>
    </div>
  );
}

function DefinitionRow({ definition, onSave, t }: { definition: TestDefinition; onSave: (d: TestDefinition) => void; t: SimpleT }) {
  const [local, setLocal] = useState(definition);
  const dirty = JSON.stringify(local) !== JSON.stringify(definition);

  return (
    <div className={cn("rounded-card border px-3 py-2", local.verificationStatus === "not_verified" ? "border-border" : "border-accent/40")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[12px] font-medium" />
        <span className="text-[10px] text-muted">{local.code}</span>
        <select value={local.resultType} onChange={(e) => setLocal({ ...local, resultType: e.target.value as TestDefinition["resultType"] })} className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]">
          {TEST_RESULT_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {rt}
            </option>
          ))}
        </select>
        <input value={local.unit ?? ""} onChange={(e) => setLocal({ ...local, unit: e.target.value || undefined })} placeholder={t("tests.unit")} className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
        <input value={local.minimum ?? ""} onChange={(e) => setLocal({ ...local, minimum: e.target.value || undefined })} placeholder={t("tests.targetMin")} inputMode="decimal" className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
        <input value={local.maximum ?? ""} onChange={(e) => setLocal({ ...local, maximum: e.target.value || undefined })} placeholder={t("tests.targetMax")} inputMode="decimal" className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
        <select
          value={local.passFailLogic?.rule ?? ""}
          onChange={(e) => setLocal({ ...local, passFailLogic: e.target.value ? { rule: e.target.value as (typeof PASS_FAIL_RULES)[number] } : undefined })}
          className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]"
        >
          <option value="">{t("tests.noPassFailRule")}</option>
          {PASS_FAIL_RULES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <input type="checkbox" checked={local.criticalTestFlag} onChange={(e) => setLocal({ ...local, criticalTestFlag: e.target.checked })} />
          {t("tests.critical")}
        </label>
        <select value={local.verificationStatus} onChange={(e) => setLocal({ ...local, verificationStatus: e.target.value as TestDefinition["verificationStatus"] })} className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]">
          {TEST_VERIFICATION_STATUSES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <input type="checkbox" checked={local.active} onChange={(e) => setLocal({ ...local, active: e.target.checked })} />
          {t("tests.active")}
        </label>
        {dirty && (
          <button onClick={() => onSave({ ...local, updatedAt: new Date().toISOString() })} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
            {t("common:actions.save")}
          </button>
        )}
      </div>
    </div>
  );
}
