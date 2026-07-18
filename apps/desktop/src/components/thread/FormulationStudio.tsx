import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Beaker, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FormulationBrief } from "@/lib/formulationV2";

/**
 * FormulationStudio — the app's front door. The user describes a target product
 * (plus optional audience, market, cost, performance, and on-hand materials);
 * "Generate" composes a structured brief and hands it to the agent, which runs
 * the formulation-discovery pipeline (retrieve → extract → synthesize →
 * optimize → report) and streams the full formulation card back into the thread.
 */

const CATEGORIES = [
  "auto", "shampoo", "conditioner", "bodyWash", "barSoap", "handCream",
  "toothpaste", "mouthwash", "laundryDetergent", "fabricSoftener", "dishSoap",
  "surfaceCleaner", "glassCleaner", "limescaleRemover", "airFreshener",
] as const;
const AUDIENCES = ["unspecified", "child", "woman", "man", "unisex"] as const;
const MARKETS = ["any", "eu", "us", "tr", "kenya", "africa"] as const;

type Category = (typeof CATEGORIES)[number];
type Audience = (typeof AUDIENCES)[number];
type Market = (typeof MARKETS)[number];

// Short English terms for the brief, independent of UI locale. The
// formulation-discovery skill knows how to interpret each field (audience,
// market, …), so the brief itself stays compact.
const CATEGORY_EN: Record<Category, string> = {
  auto: "auto-detect", shampoo: "shampoo", conditioner: "hair conditioner",
  bodyWash: "body wash", barSoap: "bar soap", handCream: "hand cream",
  toothpaste: "toothpaste", mouthwash: "mouthwash", laundryDetergent: "laundry detergent",
  fabricSoftener: "fabric softener", dishSoap: "dishwashing liquid",
  surfaceCleaner: "surface cleaner", glassCleaner: "glass cleaner",
  limescaleRemover: "limescale remover", airFreshener: "air freshener",
};
const AUDIENCE_EN: Record<Audience, string> = {
  unspecified: "unspecified", child: "children", woman: "women", man: "men", unisex: "unisex",
};

// Build the structured brief the v2 pipeline consumes. Short English values
// (locale-independent) so region_profiles / rules can key off them directly.
function buildBrief(f: {
  target: string; category: Category; audience: Audience; market: Market;
  maxCost: string; performance: string; materials: string;
}): FormulationBrief {
  return {
    target: f.target.trim(),
    category: CATEGORY_EN[f.category],
    audience: AUDIENCE_EN[f.audience],
    market: f.market, // pass the slug (kenya/eu/…) — region_profiles resolves it
    max_cost: f.maxCost.trim() || undefined,
    performance: f.performance.trim() || undefined,
    materials: f.materials.trim() || undefined,
  };
}

export function FormulationStudio({
  onSubmit,
  busy = false,
  headerSlot,
}: {
  onSubmit: (brief: FormulationBrief) => void;
  busy?: boolean;
  headerSlot?: ReactNode;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [target, setTarget] = useState("");
  const [category, setCategory] = useState<Category>("auto");
  const [audience, setAudience] = useState<Audience>("unspecified");
  const [market, setMarket] = useState<Market>("any");
  const [maxCost, setMaxCost] = useState("");
  const [performance, setPerformance] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [materials, setMaterials] = useState("");

  const canGenerate = target.trim().length > 2 && !busy;
  const generate = () => {
    if (!canGenerate) return;
    onSubmit(buildBrief({ target, category, audience, market, maxCost, performance, materials }));
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-6">
      <div className="mx-auto w-full max-w-[520px]">
        <div>
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-accent ring-1 ring-border">
            <Beaker size={19} strokeWidth={1.75} />
          </div>
          <h2 className="font-serif text-[22px] leading-tight text-text">{t("studio.heading")}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {t("studio.subheading")}
          </p>
        </div>

        {headerSlot}

        <div className="mt-6 space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
          {/* Target product */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
              {t("studio.target.label")}
            </span>
            <textarea
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
              }}
              placeholder={t("studio.target.placeholder")}
              rows={2}
              className="w-full resize-y rounded-input border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-accent"
            />
          </label>

          {/* Category + market */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("studio.category.label")}>
              <Select value={category} onChange={(v) => setCategory(v as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`studio.cat.${c}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("studio.market.label")}>
              <Select value={market} onChange={(v) => setMarket(v as Market)}>
                {MARKETS.map((m) => (
                  <option key={m} value={m}>{t(`studio.market.${m}`)}</option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Audience segmented control */}
          <Field label={t("studio.audience.label")}>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCES.map((a) => (
                <button
                  key={a}
                  onClick={() => setAudience(a)}
                  className={cn(
                    "rounded-input border px-3 py-1.5 text-xs transition-colors",
                    audience === a
                      ? "border-accent bg-accent/10 text-text"
                      : "border-border text-muted hover:bg-surface-2",
                  )}
                >
                  {t(`studio.audience.${a}`)}
                </button>
              ))}
            </div>
          </Field>

          {/* More options */}
          <button
            onClick={() => setShowMore((s) => !s)}
            className="flex items-center gap-1 text-xs text-muted hover:text-text"
          >
            <ChevronDown size={13} className={cn("transition-transform", showMore && "rotate-180")} />
            {t("studio.more")}
          </button>
          {showMore && (
            <div className="space-y-3 border-t border-border-faint pt-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("studio.cost.label")}>
                  <input
                    value={maxCost}
                    onChange={(e) => setMaxCost(e.target.value)}
                    placeholder={t("studio.cost.placeholder")}
                    className="w-full rounded-input border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent"
                  />
                </Field>
                <Field label={t("studio.performance.label")}>
                  <input
                    value={performance}
                    onChange={(e) => setPerformance(e.target.value)}
                    placeholder={t("studio.performance.placeholder")}
                    className="w-full rounded-input border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent"
                  />
                </Field>
              </div>
              <Field label={t("studio.materials.label")}>
                <textarea
                  value={materials}
                  onChange={(e) => setMaterials(e.target.value)}
                  placeholder={t("studio.materials.placeholder")}
                  rows={3}
                  className="w-full resize-y rounded-input border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-muted focus:border-accent"
                />
              </Field>
            </div>
          )}

          <button
            onClick={generate}
            disabled={!canGenerate}
            className="flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? t("studio.result.working") : t("studio.generate")}
          </button>
        </div>

        <p className="mx-auto mt-3 max-w-[500px] text-center text-[11px] leading-relaxed text-muted">
          {t("studio.disclaimer")}
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-input border border-border bg-surface px-3 py-1.5 pr-8 text-sm text-text outline-none focus:border-accent"
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}
