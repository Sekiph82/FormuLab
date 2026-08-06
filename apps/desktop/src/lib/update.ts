/**
 * Phase 11 Session 9 — update checker (check-only).
 *
 * Owns everything the Rust side (`updates.rs`) deliberately does NOT:
 * version comparison (newer/same/older — a same-or-older reported
 * version is never treated as "available", rejecting a downgrade or a
 * stale/misconfigured endpoint's claim by construction), semver-shape
 * validation, scheduling (configurable check frequency, not a fixed
 * interval), ignored-version handling, and duplicate-notification
 * prevention. Rust's job stops at "is this response safe and
 * well-formed" (HTTPS-only, size-capped, timed out, structurally valid).
 *
 * Does not download or execute an installer, and never will from this
 * module — automatic update installation and rollback are Phase 12
 * scope. Release notes are always rendered as plain text by the caller
 * (`UpdateCheckerCard.tsx` puts this string directly into JSX text
 * content, never `dangerouslySetInnerHTML`) — this module does not trust
 * or interpret them as HTML.
 */
import { create } from "zustand";
import { checkForUpdate, type ReleaseMetadata } from "./tauri";
import { notifyUpdateAvailable } from "./systemNotification";

export const DEFAULT_RELEASE_METADATA_URL = "https://api.github.com/repos/Sekiph82/FormuLab/releases/latest";

export const DEFAULT_FREQUENCY_HOURS = 24;
/** Offered in the frequency select: 6h, 12h, daily, every 3 days, weekly. */
export const FREQUENCY_OPTIONS_HOURS = [6, 12, 24, 72, 168] as const;

const ENDPOINT_KEY = "FormuLab.update.endpoint";
const ENABLED_KEY = "FormuLab.update.enabled";
const BADGE_KEY = "FormuLab.update.badge";
const FREQUENCY_KEY = "FormuLab.update.frequencyHours";
const IGNORED_VERSION_KEY = "FormuLab.update.ignoredVersion";
const NOTIFIED_VERSION_KEY = "FormuLab.update.notifiedVersion";
const LAST_CHECKED_KEY = "FormuLab.update.lastCheckedAt";
const LATEST_KEY = "FormuLab.update.latest";

export type UpdateCheckStatus = "idle" | "checking" | "upToDate" | "updateAvailable" | "error" | "offline";

interface UpdateState {
  endpointUrl: string;
  enabled: boolean;
  badgeEnabled: boolean;
  frequencyHours: number;
  ignoredVersion: string | null;
  notifiedVersion: string | null;
  lastCheckedAt: number | null;
  latest: ReleaseMetadata | null;
  status: UpdateCheckStatus;
  error: string | null;
  currentVersion: string;
  /** True only when `latest` is genuinely newer than `currentVersion` AND
   *  not the ignored version — never true for a same/older reported
   *  version (see module doc: downgrade/same-version rejection). */
  hasUpdate: boolean;
  showBadge: boolean;
  setEndpointUrl: (url: string) => { ok: boolean; error?: string };
  setEnabled: (enabled: boolean) => void;
  setBadgeEnabled: (enabled: boolean) => void;
  setFrequencyHours: (hours: number) => void;
  ignoreVersion: (version?: string) => void;
  clearIgnoredVersion: () => void;
  check: (opts?: { manual?: boolean; now?: number }) => Promise<void>;
  maybeAutoCheck: () => Promise<void>;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v === "1") return true;
  if (v === "0") return false;
  return fallback;
}

function readNumber(key: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readLatest(): ReleaseMetadata | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LATEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReleaseMetadata;
    return parsed?.version && parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

function persistLatest(latest: ReleaseMetadata | null): void {
  if (typeof window === "undefined") return;
  if (latest) window.localStorage.setItem(LATEST_KEY, JSON.stringify(latest));
  else window.localStorage.removeItem(LATEST_KEY);
}

function setLocal(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "").split(/[+-]/)[0] ?? "";
}

/** A loose but real semver-shape check ("X.Y.Z" after stripping a
 *  leading "v" and any -prerelease/+build suffix) — malformed versions
 *  ("abc", "1.2", "") are rejected outright rather than silently
 *  coerced to 0 the way a lenient numeric parse would. */
export function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(normalizeVersion(version));
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(".").map((x) => Number.parseInt(x, 10));
  const pb = normalizeVersion(b).split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0;
    const db = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function isSameVersion(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b);
}

export function isIgnoredVersion(version: string, ignoredVersion: string | null): boolean {
  return Boolean(ignoredVersion) && isSameVersion(version, ignoredVersion ?? "");
}

export function shouldAutoCheck(lastCheckedAt: number | null, now: number, frequencyHours: number): boolean {
  const intervalMs = Math.max(1, frequencyHours) * 60 * 60 * 1000;
  return !lastCheckedAt || now - lastCheckedAt >= intervalMs;
}

/** `URL`-based (not a bare prefix check) so whitespace/case/malformed
 *  input all resolve the same way a real navigation would treat them. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function shouldShowUpdateBadge(args: {
  enabled: boolean;
  badgeEnabled: boolean;
  latest: ReleaseMetadata | null;
  currentVersion: string;
  ignoredVersion: string | null;
}): boolean {
  if (!args.enabled || !args.badgeEnabled || !args.latest) return false;
  if (!isNewerVersion(args.latest.version, args.currentVersion)) return false;
  return !isIgnoredVersion(args.latest.version, args.ignoredVersion);
}

function derive(
  base: Pick<UpdateState, "enabled" | "badgeEnabled" | "latest" | "currentVersion" | "ignoredVersion">,
): Pick<UpdateState, "hasUpdate" | "showBadge"> {
  const newer = Boolean(base.latest && isNewerVersion(base.latest.version, base.currentVersion));
  const ignored = Boolean(base.latest && isIgnoredVersion(base.latest.version, base.ignoredVersion));
  const hasUpdate = newer && !ignored;
  const showBadge = shouldShowUpdateBadge(base);
  return { hasUpdate, showBadge };
}

/** Maps an error message to "offline" vs. a generic "error" — Rust's own
 *  connect/timeout messages (see `updates.rs::fetch_release_metadata_bytes`)
 *  say so explicitly; this is a best-effort classification, not a
 *  guarantee, since a browser `fetch` fallback could phrase it differently. */
function isOfflineLooking(message: string): boolean {
  return /offline|timed out|could not connect/i.test(message);
}

const initial = {
  endpointUrl: (typeof window === "undefined" ? null : window.localStorage.getItem(ENDPOINT_KEY)) || DEFAULT_RELEASE_METADATA_URL,
  enabled: readBool(ENABLED_KEY, true),
  badgeEnabled: readBool(BADGE_KEY, true),
  frequencyHours: readNumber(FREQUENCY_KEY) ?? DEFAULT_FREQUENCY_HOURS,
  ignoredVersion: typeof window === "undefined" ? null : window.localStorage.getItem(IGNORED_VERSION_KEY),
  notifiedVersion: typeof window === "undefined" ? null : window.localStorage.getItem(NOTIFIED_VERSION_KEY),
  lastCheckedAt: readNumber(LAST_CHECKED_KEY),
  latest: readLatest(),
  currentVersion: __APP_VERSION__,
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  ...initial,
  status: "idle",
  error: null,
  ...derive(initial),

  setEndpointUrl: (url) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setLocal(ENDPOINT_KEY, null);
      set({ endpointUrl: DEFAULT_RELEASE_METADATA_URL });
      return { ok: true };
    }
    if (!isHttpsUrl(trimmed)) {
      return { ok: false, error: "the update endpoint must be an HTTPS URL" };
    }
    setLocal(ENDPOINT_KEY, trimmed);
    set({ endpointUrl: trimmed });
    return { ok: true };
  },

  setEnabled: (enabled) => {
    setLocal(ENABLED_KEY, enabled ? "1" : "0");
    set((s) => ({ enabled, ...derive({ ...s, enabled }) }));
  },

  setBadgeEnabled: (badgeEnabled) => {
    setLocal(BADGE_KEY, badgeEnabled ? "1" : "0");
    set((s) => ({ badgeEnabled, ...derive({ ...s, badgeEnabled }) }));
  },

  setFrequencyHours: (hours) => {
    const frequencyHours = Math.max(1, Math.round(hours));
    setLocal(FREQUENCY_KEY, String(frequencyHours));
    set({ frequencyHours });
  },

  ignoreVersion: (version) => {
    const v = version ?? get().latest?.version ?? null;
    if (!v) return;
    setLocal(IGNORED_VERSION_KEY, v);
    set((s) => ({ ignoredVersion: v, ...derive({ ...s, ignoredVersion: v }) }));
  },

  clearIgnoredVersion: () => {
    setLocal(IGNORED_VERSION_KEY, null);
    set((s) => ({ ignoredVersion: null, ...derive({ ...s, ignoredVersion: null }) }));
  },

  check: async (opts) => {
    const manual = opts?.manual ?? false;
    const now = opts?.now ?? Date.now();
    const s = get();
    if (!manual) {
      if (!s.enabled) return;
      if (!shouldAutoCheck(s.lastCheckedAt, now, s.frequencyHours)) return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLocal(LAST_CHECKED_KEY, String(now));
      set({ status: "offline", error: null, lastCheckedAt: now });
      return;
    }
    if (!isHttpsUrl(s.endpointUrl)) {
      set({ status: "error", error: "the update endpoint must be an HTTPS URL" });
      return;
    }

    set({ status: "checking", error: null });
    try {
      const latest = await checkForUpdate(s.endpointUrl);
      if (!isValidSemver(latest.version)) {
        throw new Error(`release metadata reported an invalid version: "${latest.version}"`);
      }
      setLocal(LAST_CHECKED_KEY, String(now));
      persistLatest(latest);
      // A same-or-older reported version is "up to date," never an
      // error and never "available" — rejects a downgrade or a stale/
      // misconfigured endpoint's claim rather than trusting it blindly.
      const status: UpdateCheckStatus = isNewerVersion(latest.version, s.currentVersion) ? "updateAvailable" : "upToDate";
      set((cur) => ({
        latest,
        lastCheckedAt: now,
        status,
        error: null,
        ...derive({ ...cur, latest }),
      }));

      const cur = get();
      if (cur.hasUpdate && !isSameVersion(latest.version, cur.notifiedVersion ?? "")) {
        setLocal(NOTIFIED_VERSION_KEY, latest.version);
        set({ notifiedVersion: latest.version });
        void notifyUpdateAvailable(latest.version, latest.url);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLocal(LAST_CHECKED_KEY, String(now));
      set({ lastCheckedAt: now, status: isOfflineLooking(message) ? "offline" : "error", error: message });
    }
  },

  maybeAutoCheck: () => get().check({ manual: false }),
}));
