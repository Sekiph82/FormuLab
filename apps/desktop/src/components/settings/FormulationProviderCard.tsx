import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PROVIDERS, loadProviderConfig, saveProviderConfig, type ProviderConfig } from "@/lib/formulationV2";
import { Section } from "./Section";

/**
 * Provider/model preference for the formulation pipeline. Generation is
 * zero-LLM, so no API key is collected or stored here.
 */
export function FormulationProviderCard() {
  const { t } = useTranslation("settings");
  const [cfg, setCfg] = useState<ProviderConfig>(() => loadProviderConfig());
  const def = PROVIDERS.find((p) => p.id === cfg.provider) ?? PROVIDERS[0];

  const update = (patch: Partial<ProviderConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveProviderConfig(next);
      return next;
    });
  };

  const onProvider = (id: string) => {
    const d = PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
    update({ provider: id, model: d.models[0] });
  };

  return (
    <Section title={t("model.title")} hint={t("model.hint")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            {t("model.providerLabel")}
          </span>
          <div className="relative">
            <select
              value={cfg.provider}
              onChange={(e) => onProvider(e.target.value)}
              className="w-full appearance-none rounded-input border border-border bg-surface px-3 py-2 pr-8 text-[13px] text-text outline-none focus:border-accent"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.free ? t("model.providerFreeTier", { label: p.label }) : p.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            {t("model.modelLabel")}
          </span>
          <input
            list="formulab-model-options"
            value={cfg.model}
            onChange={(e) => update({ model: e.target.value })}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
          <datalist id="formulab-model-options">
            {def.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>
    </Section>
  );
}
