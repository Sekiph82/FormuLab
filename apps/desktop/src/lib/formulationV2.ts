// FormuLab v2 — direct pipeline bridge (no OpenCode).
//
// Thin wrappers over the Rust `generate_formulation` / `*_session` commands plus
// a tiny localStorage-backed store for the chosen provider, model, and API key.
// Self-contained so it runs independently of the (to-be-removed) OpenCode stack.

import { isTauri } from "./tauri";

export interface FormulationBrief {
  target: string;
  category?: string;
  audience?: string;
  market?: string;
  max_cost?: string;
  performance?: string;
  materials?: string;
}

export interface FormulationCard {
  version: string; // "v1", "v2", …
  markdown: string;
  formula?: unknown;
  violations?: string[];
}

export interface GenerateResult {
  status: "ok" | "refused" | "error";
  message?: string;
  cards?: FormulationCard[];
  slug?: string;
  papers?: number;
  session_id?: string;
  session_dir?: string;
}

export interface SessionSummary {
  id: string;
  created: number;
  brief: FormulationBrief | null;
  card_count: number;
}

export interface SessionDetail {
  status: "ok";
  id: string;
  brief: FormulationBrief | null;
  cards: FormulationCard[];
  read_only: true;
}

// ---------------------------------------------------------------- providers ---

// The providers the pipeline's llm.py speaks. `free` flags a usable free tier.
// `models` are sensible defaults; the model field stays editable so any model id
// works without maintaining an exhaustive catalog.
export interface ProviderDef {
  id: string;
  label: string;
  free: boolean;
  keyUrl?: string;
  models: string[];
}

export const PROVIDERS: ProviderDef[] = [
  { id: "gemini", label: "Google Gemini", free: true,
    keyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-3.1-flash-lite", "gemini-3.1-flash", "gemini-3.1-pro"] },
  { id: "groq", label: "Groq", free: true,
    keyUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
  { id: "openrouter", label: "OpenRouter", free: true,
    keyUrl: "https://openrouter.ai/keys",
    models: ["deepseek/deepseek-chat", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"] },
  { id: "deepseek", label: "DeepSeek", free: false,
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "openai", label: "OpenAI", free: false,
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5-mini", "gpt-5", "gpt-4o-mini"] },
  { id: "mistral", label: "Mistral", free: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-small-latest", "mistral-large-latest"] },
  { id: "cerebras", label: "Cerebras", free: true,
    keyUrl: "https://cloud.cerebras.ai",
    models: ["llama-3.3-70b"] },
  { id: "together", label: "Together", free: false,
    keyUrl: "https://api.together.xyz/settings/api-keys",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  { id: "ollama", label: "Ollama (local)", free: true,
    models: ["llama3.1", "qwen2.5"] },
];

// -------------------------------------------------------------- key storage ---

const LS = {
  provider: "formulab.v2.provider",
  model: "formulab.v2.model",
  key: (provider: string) => `formulab.v2.key.${provider}`,
};

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
}

export function loadProviderConfig(): ProviderConfig {
  if (typeof window === "undefined") {
    return { provider: "gemini", model: "gemini-3.1-flash-lite", apiKey: "" };
  }
  const provider = window.localStorage.getItem(LS.provider) || "gemini";
  const def = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const model = window.localStorage.getItem(LS.model) || def.models[0];
  const apiKey = window.localStorage.getItem(LS.key(provider)) || "";
  return { provider, model, apiKey };
}

export function saveProviderConfig(cfg: ProviderConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS.provider, cfg.provider);
  window.localStorage.setItem(LS.model, cfg.model);
  // Key is stored per-provider so switching providers keeps each key.
  window.localStorage.setItem(LS.key(cfg.provider), cfg.apiKey);
}

export function loadKeyFor(provider: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LS.key(provider)) || "";
}

// ------------------------------------------------------------------ invoke ----

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function generateFormulation(
  brief: FormulationBrief,
  cfg: ProviderConfig,
  n = 3,
): Promise<GenerateResult> {
  return call<GenerateResult>("generate_formulation", {
    request: {
      brief,
      provider: cfg.provider,
      model: cfg.model,
      api_key: cfg.apiKey,
      n,
    },
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  if (!isTauri) return [];
  return call<SessionSummary[]>("list_sessions", {});
}

export async function readSession(id: string): Promise<SessionDetail> {
  return call<SessionDetail>("read_session", { id });
}

export async function deleteSession(id: string): Promise<void> {
  return call<void>("delete_session", { id });
}
