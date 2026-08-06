import { useState } from "react";
import { ChevronDown, Key, ExternalLink, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  PROVIDERS,
  loadProviderConfig,
  saveProviderConfig,
  loadKeyFor,
  type ProviderConfig,
} from "@/lib/formulationV2";
import { Section } from "./Section";

/**
 * Model + API key for the v2 direct formulation pipeline. This is the single
 * place the model is chosen — the studio reads the stored config at generate
 * time, so the workspace itself shows no provider UI.
 *
 * Keys are stored per-provider in localStorage on this device; switching
 * providers keeps each key so the user doesn't re-paste when comparing models.
 */
export function FormulationProviderCard() {
  const { t } = useTranslation("settings");
  const [cfg, setCfg] = useState<ProviderConfig>(() => loadProviderConfig());
  const [showKey, setShowKey] = useState(false);
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
    update({ provider: id, model: d.models[0], apiKey: loadKeyFor(id) });
  };

  const needsKey = cfg.provider !== "ollama";
  const hasKey = !needsKey || cfg.apiKey.trim().length > 0;

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

      {needsKey && (
        <label className="mt-3 block">
          <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1">
              <Key size={11} /> {t("model.apiKeyLabel")}
              {hasKey && <Check size={12} className="text-ok" />}
            </span>
            {def.keyUrl && (
              <a
                href={def.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-0.5 normal-case text-accent hover:underline"
              >
                {t("model.getKey")} <ExternalLink size={10} />
              </a>
            )}
          </span>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={cfg.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={`${def.label} API key…`}
              className={cn(
                "w-full rounded-input border bg-surface px-3 py-2 pr-14 font-mono text-[12px] text-text outline-none focus:border-accent",
                hasKey ? "border-border" : "border-warn/50",
              )}
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted hover:text-text"
            >
              {showKey ? t("model.hideKey") : t("model.showKey")}
            </button>
          </div>
          <span className="mt-1.5 block text-[11px] text-muted">{t("model.keyStoredLocally")}</span>
        </label>
      )}
    </Section>
  );
}
