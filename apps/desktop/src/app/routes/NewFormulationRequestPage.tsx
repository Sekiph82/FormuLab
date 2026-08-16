import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  BookOpen,
  Factory,
  Info,
  Lightbulb,
  Save,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  generateFormulation,
  loadProviderConfig,
  notifySessionsChanged,
  type FormulationBrief,
} from "@/lib/formulationV2";
import { cn } from "@/lib/cn";

/**
 * Phase 14 — "New Formulation Request" screen, built directly from the
 * approved visual reference (`docs/assets/phase14/formulation-request-
 * screen.png`) and its full specification
 * (`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`). The natural-language
 * request is the authoritative primary requirement; every structured field
 * below complements it, never replaces it (§C of the spec).
 *
 * Generation itself is unchanged — the real `generate_formulation`
 * command/pipeline this screen calls is exactly what `FormulationWorkspaceV2`
 * already used; this screen is a new front door onto the same backend, not
 * a new generation mechanism.
 */

const MAX_REQUEST_CHARS = 4000;

const PRODUCT_CATEGORIES = ["hairCare", "skinCare", "homeCare", "laundry", "oralCare", "industrial", "other"] as const;

export function NewFormulationRequestPage() {
  const { t } = useTranslation(["session", "common"]);
  const navigate = useNavigate();

  const [request, setRequest] = useState("");
  const [category, setCategory] = useState("");
  const [productType, setProductType] = useState("");
  const [market, setMarket] = useState("");
  const [excluded, setExcluded] = useState("");
  const [preferred, setPreferred] = useState("");
  const [phMin, setPhMin] = useState("");
  const [phMax, setPhMax] = useState("");
  const [viscosity, setViscosity] = useState("");
  const [activeMatter, setActiveMatter] = useState("");
  const [costLevel, setCostLevel] = useState("");
  const [claims, setClaims] = useState("");
  const [packaging, setPackaging] = useState("");
  const [batchSize, setBatchSize] = useState("");
  const [equipment, setEquipment] = useState("");
  const [rawMaterials, setRawMaterials] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearAll = () => {
    setRequest("");
    setCategory("");
    setProductType("");
    setMarket("");
    setExcluded("");
    setPreferred("");
    setPhMin("");
    setPhMax("");
    setViscosity("");
    setActiveMatter("");
    setCostLevel("");
    setClaims("");
    setPackaging("");
    setBatchSize("");
    setEquipment("");
    setRawMaterials("");
  };

  const applyExample = () => {
    setRequest(t("formulationRequest.exampleFullRequest"));
    setCategory("hairCare");
    setProductType(t("formulationRequest.exampleProductType", { defaultValue: "Shampoo" }));
    setExcluded(t("formulationRequest.exampleExcluded", { defaultValue: "sulfates, silicones" }));
    setPhMin("5.0");
    setPhMax("5.5");
    setCostLevel("medium");
    setClaims(t("formulationRequest.exampleClaims", { defaultValue: "anti-dandruff, sulfate-free" }));
  };

  const submit = async () => {
    if (!request.trim() || busy) return;
    const cfg = loadProviderConfig();
    if (cfg.provider !== "ollama" && !cfg.apiKey.trim()) {
      setError(t("studio.result.needKey"));
      return;
    }
    setBusy(true);
    setError(null);
    const brief: FormulationBrief = {
      target: request.trim(),
      category: category || undefined,
      market: market || undefined,
      targetProductType: productType || undefined,
      excludedIngredients: excluded || undefined,
      preferredIngredients: preferred || undefined,
      targetPhMin: phMin || undefined,
      targetPhMax: phMax || undefined,
      targetViscosity: viscosity || undefined,
      targetActiveMatter: activeMatter || undefined,
      targetCostLevel: costLevel || undefined,
      claims: claims || undefined,
      packagingType: packaging || undefined,
      estimatedBatchSize: batchSize || undefined,
      availableEquipment: equipment || undefined,
      availableRawMaterials: rawMaterials || undefined,
      max_cost: costLevel || undefined,
      materials: preferred || undefined,
    };
    try {
      const res = await generateFormulation(brief, cfg, 3);
      if (res.status === "ok" && res.session_id) {
        notifySessionsChanged();
        navigate(`/formulation-result/${res.session_id}`);
      } else if (res.status === "refused" || res.status === "human_review_required") {
        // These two statuses need the reviewer-acknowledgement flow the
        // existing workspace already implements — route there rather than
        // half-reimplementing it a second time on this screen.
        navigate("/live", { state: { pendingBrief: brief } });
      } else {
        setError(res.message ?? t("studio.result.errorTitle", "Something went wrong"));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-[1400px]">
        <h1 className="text-xl font-semibold text-text">{t("formulationRequest.title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("formulationRequest.subtitle")}</p>

        {error && (
          <div role="alert" className="mt-4 rounded-input border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <RequestCard
            icon={<Info size={15} className="text-accent" />}
            title={t("formulationRequest.describe.title")}
          >
            <p className="mb-2 text-[12px] text-muted">{t("formulationRequest.describe.helper")}</p>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value.slice(0, MAX_REQUEST_CHARS))}
              placeholder={t("formulationRequest.exampleFullRequest")}
              rows={9}
              className="w-full resize-y rounded-input border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-text outline-none focus:border-accent"
            />
            <div className="mt-1 text-right text-[10px] text-muted">
              {request.length} / {MAX_REQUEST_CHARS}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={applyExample}
                className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1.5 text-[11px] text-text hover:bg-surface-2"
              >
                <Lightbulb size={13} className="text-muted" />
                {t("formulationRequest.exampleRequestsButton")}
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1.5 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
              >
                <Trash2 size={13} />
                {t("common:actions.clear", { defaultValue: "Clear" })}
              </button>
            </div>
          </RequestCard>

          <RequestCard icon={<BadgeCheck size={15} className="text-accent" />} title={t("formulationRequest.product.title")}>
            <Field label={t("formulationRequest.product.category")}>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
                aria-label={t("formulationRequest.product.category")}
              >
                <option value="">{t("formulationRequest.select", { defaultValue: "Select…" })}</option>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`formulationRequest.product.categories.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("formulationRequest.product.type")}>
              <input value={productType} onChange={(e) => setProductType(e.target.value)} className={inputClass} placeholder={t("formulationRequest.product.typePlaceholder", { defaultValue: "e.g. Shampoo, Serum, Cream…" })} />
            </Field>
            <Field label={t("formulationRequest.product.market")}>
              <input value={market} onChange={(e) => setMarket(e.target.value)} className={inputClass} placeholder={t("formulationRequest.product.marketPlaceholder", { defaultValue: "e.g. Kenya, EU, USA…" })} />
            </Field>
          </RequestCard>
        </div>

        <RequestCard
          icon={<SlidersHorizontal size={15} className="text-accent" />}
          title={t("formulationRequest.constraints.title")}
          className="mt-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("formulationRequest.constraints.excluded")}>
              <input value={excluded} onChange={(e) => setExcluded(e.target.value)} className={inputClass} placeholder={t("formulationRequest.constraints.excludedPlaceholder", { defaultValue: "e.g. sulfates, parabens…" })} />
            </Field>
            <Field label={t("formulationRequest.constraints.preferred")}>
              <input value={preferred} onChange={(e) => setPreferred(e.target.value)} className={inputClass} placeholder={t("formulationRequest.constraints.preferredPlaceholder", { defaultValue: "e.g. natural ingredients…" })} />
            </Field>
            <Field label={t("formulationRequest.constraints.ph")}>
              <div className="flex items-center gap-1.5">
                <input value={phMin} onChange={(e) => setPhMin(e.target.value)} inputMode="decimal" className={inputClass} aria-label={t("formulationRequest.constraints.phMin")} placeholder={t("formulationRequest.constraints.phMin")} />
                <span className="text-[11px] text-muted">–</span>
                <input value={phMax} onChange={(e) => setPhMax(e.target.value)} inputMode="decimal" className={inputClass} aria-label={t("formulationRequest.constraints.phMax")} placeholder={t("formulationRequest.constraints.phMax")} />
              </div>
            </Field>
            <Field label={t("formulationRequest.constraints.viscosity")}>
              <input value={viscosity} onChange={(e) => setViscosity(e.target.value)} className={inputClass} placeholder={t("formulationRequest.constraints.viscosityPlaceholder")} />
            </Field>
            <Field label={t("formulationRequest.constraints.activeMatter")}>
              <input value={activeMatter} onChange={(e) => setActiveMatter(e.target.value)} className={inputClass} placeholder={t("formulationRequest.constraints.activeMatterPlaceholder")} />
            </Field>
            <Field label={t("formulationRequest.constraints.costLevel")}>
              <select value={costLevel} onChange={(e) => setCostLevel(e.target.value)} className={inputClass} aria-label={t("formulationRequest.constraints.costLevel")}>
                <option value="">{t("formulationRequest.select")}</option>
                <option value="economy">{t("formulationRequest.constraints.costLevels.economy")}</option>
                <option value="medium">{t("formulationRequest.constraints.costLevels.medium")}</option>
                <option value="premium">{t("formulationRequest.constraints.costLevels.premium")}</option>
              </select>
            </Field>
            <Field label={t("formulationRequest.constraints.claims")}>
              <input value={claims} onChange={(e) => setClaims(e.target.value)} className={inputClass} placeholder={t("formulationRequest.constraints.claimsPlaceholder")} />
            </Field>
            <Field label={t("formulationRequest.constraints.packaging")}>
              <input value={packaging} onChange={(e) => setPackaging(e.target.value)} className={inputClass} placeholder={t("formulationRequest.constraints.packagingPlaceholder")} />
            </Field>
          </div>
        </RequestCard>

        <RequestCard icon={<Factory size={15} className="text-accent" />} title={t("formulationRequest.production.title")} className="mt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t("formulationRequest.production.batchSize")}>
              <input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className={inputClass} placeholder={t("formulationRequest.production.batchSizePlaceholder")} />
            </Field>
            <Field label={t("formulationRequest.production.equipment")}>
              <input value={equipment} onChange={(e) => setEquipment(e.target.value)} className={inputClass} placeholder={t("formulationRequest.production.equipmentPlaceholder")} />
            </Field>
            <Field label={t("formulationRequest.production.rawMaterials")}>
              <input value={rawMaterials} onChange={(e) => setRawMaterials(e.target.value)} className={inputClass} placeholder={t("formulationRequest.production.rawMaterialsPlaceholder")} />
            </Field>
          </div>
        </RequestCard>

        <div className="mt-4 rounded-card border border-border bg-surface-2/40 p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <span className="text-[13px] font-medium text-text">{t("formulationRequest.evidenceBanner.heading")}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted">{t("formulationRequest.evidenceBanner.body")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge icon={<BookOpen size={12} />} label={t("formulationRequest.evidenceBanner.badges.literature")} />
            <Badge icon={<ScrollText size={12} />} label={t("formulationRequest.evidenceBanner.badges.evidenceBase")} />
            <Badge icon={<ShieldCheck size={12} />} label={t("formulationRequest.evidenceBanner.badges.safety")} />
            <Badge icon={<BadgeCheck size={12} />} label={t("formulationRequest.evidenceBanner.badges.regulatory")} />
            <Badge icon={<Factory size={12} />} label={t("formulationRequest.evidenceBanner.badges.production")} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2 pb-4">
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1.5 rounded-input border border-border px-3.5 py-2 text-[12px] font-medium text-text hover:bg-surface-2 disabled:opacity-40"
          >
            <Save size={14} />
            {t("formulationRequest.actions.saveDraft")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!request.trim() || busy}
            className="flex items-center gap-1.5 rounded-input bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            <Send size={14} />
            {busy ? t("studio.result.working") : t("formulationRequest.actions.start")}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-input border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-accent";

function RequestCard({
  icon,
  title,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-card border border-border bg-surface p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-[13px] font-medium text-text">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text">
      {icon}
      {label}
    </span>
  );
}
