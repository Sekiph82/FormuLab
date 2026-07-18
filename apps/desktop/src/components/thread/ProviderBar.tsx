import { useEffect, useState } from "react";
import { ChevronDown, Key, ExternalLink, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PROVIDERS,
  loadProviderConfig,
  saveProviderConfig,
  loadKeyFor,
  type ProviderConfig,
} from "@/lib/formulationV2";

/**
 * Compact provider/model/key selector for the v2 direct pipeline. Persists to
 * localStorage (per-provider key) and reports the live config up via onChange so
 * the workspace can enable/disable Generate on whether a key is present.
 */
export function ProviderBar({ onChange }: { onChange: (cfg: ProviderConfig) => void }) {
  const [cfg, setCfg] = useState<ProviderConfig>(() => loadProviderConfig());
  const [showKey, setShowKey] = useState(false);
  const def = PROVIDERS.find((p) => p.id === cfg.provider) ?? PROVIDERS[0];

  useEffect(() => {
    onChange(cfg);
  }, [cfg, onChange]);

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
    <div className="mt-5 rounded-card border border-border bg-surface-2/50 p-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Provider
          </span>
          <div className="relative">
            <select
              value={cfg.provider}
              onChange={(e) => onProvider(e.target.value)}
              className="w-full appearance-none rounded-input border border-border bg-surface px-2.5 py-1.5 pr-7 text-[13px] text-text outline-none focus:border-accent"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.free ? " · free" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Model
          </span>
          <input
            list="v2-model-options"
            value={cfg.model}
            onChange={(e) => update({ model: e.target.value })}
            className="w-full rounded-input border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-accent"
          />
          <datalist id="v2-model-options">
            {def.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>

      {needsKey && (
        <label className="mt-2 block">
          <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1">
              <Key size={11} /> API key
              {hasKey && <Check size={12} className="text-green-500" />}
            </span>
            {def.keyUrl && (
              <a
                href={def.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-0.5 normal-case text-accent hover:underline"
              >
                get one <ExternalLink size={10} />
              </a>
            )}
          </span>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={cfg.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={`${def.label} key…`}
              className={cn(
                "w-full rounded-input border bg-surface px-2.5 py-1.5 pr-12 font-mono text-[12px] text-text outline-none focus:border-accent",
                hasKey ? "border-border" : "border-amber-500/50",
              )}
            />
            <button
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted hover:text-text"
              type="button"
            >
              {showKey ? "hide" : "show"}
            </button>
          </div>
          <span className="mt-1 block text-[10px] text-muted">
            Stored locally on this device only.
          </span>
        </label>
      )}
    </div>
  );
}
