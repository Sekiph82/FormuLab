// Artifact provenance (P0-3): turn the agent's successful file-writing tool
// calls into version records in `.FormuLab/provenance.jsonl`, and read them
// back for the artifact History view. Pure derivation is separated from the
// Tauri bridge so it can be unit-tested without a desktop shell.
import type { ProvenanceRecord } from "@ai4s/shared";
import { isTauri, logDebug } from "./tauri";

export interface ProvenanceInput {
  path: string;
  tool: string;
  /** Text the tool wrote, when it carried it (write). */
  content?: string;
  /** Unified diff of an edit, when the full content wasn't in the event — the
   *  lineage of an incremental change (edits carry old/newString, not `content`). */
  diff?: string;
  log: string;
}

/** Jupyter tools that change a notebook; reads/lists are not new versions. */



/** Append a version record (desktop only). Recording must never break the chat flow. */
export async function recordProvenance(
  input: ProvenanceInput,
  sessionId: string | undefined,
  model: string | null,
): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("record_provenance", {
      path: input.path,
      tool: input.tool,
      content: input.content ?? null,
      diff: input.diff ?? null,
      log: input.log,
      sessionId: sessionId ?? null,
      model: model ?? null,
    });
    void logDebug(`provenance ✓ ${input.path}`);
  } catch (e) {
    // Best-effort — the conversation goes on — but a failure must be visible
    // in the diagnostic log, or a silently broken audit trail looks healthy.
    void logDebug(`provenance FAILED for ${input.path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** All recorded versions of one artifact, oldest first ([] in browser dev). */
export async function listProvenance(path: string): Promise<ProvenanceRecord[]> {
  if (!isTauri) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ProvenanceRecord[]>("list_provenance", { path });
  } catch {
    return [];
  }
}

/** The captured `pip freeze` list for a package snapshot hash (null if unreadable). */
export async function readEnvLockfile(hash: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_env_lockfile", { hash });
  } catch {
    return null;
  }
}
