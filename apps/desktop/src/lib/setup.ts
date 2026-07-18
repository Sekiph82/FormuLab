// App-lifetime owner of the long-running uv provisioning flow (the isolated
// Jupyter env). This state lived inside a page before, so navigating away
// unmounted it, discarded the "setting up…" flag, and (worse) severed the
// setup-progress listener, making a still-running download look frozen and
// inviting a second click that collided on the same env dir. Owning it here
// means the download is unaffected by which page is open.
import { create } from "zustand";
import { setupJupyter, startJupyter, watchSetupProgress } from "./tauri";
import { toast } from "./toast";

interface SetupState {
  /** True while the isolated Jupyter env is being provisioned. */
  jupyterBusy: boolean;
  /** Latest live uv output line — reassurance during a hundreds-of-MB download. */
  line: string | null;
  /** Bumped when a provisioning run finishes, so open pages re-read status. */
  generation: number;
  enableJupyter: () => Promise<void>;
}

export const useSetupStore = create<SetupState>((set, get) => ({
  jupyterBusy: false,
  line: null,
  generation: 0,

  enableJupyter: async () => {
    // One provisioning run at a time: a second `uv venv` / `pip install` into
    // the same env dir races the first and fails.
    if (get().jupyterBusy) return;
    set({ jupyterBusy: true, line: null });
    try {
      toast.success("Setting up Jupyter — first run downloads a few hundred MB, please wait…");
      await setupJupyter();
      const s = await startJupyter();
      if (!s.url || !s.token) throw new Error("setup finished incomplete");
      toast.success("Jupyter is ready — notebooks can now run.");
    } catch (e) {
      toast.error(`Jupyter setup failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      set((st) => ({ jupyterBusy: false, line: null, generation: st.generation + 1 }));
    }
  },
}));

// A SINGLE app-lifetime uv-progress listener. Registered once from AppShell so
// a page unmount can never sever it — a per-page listener died with the page
// and made a running download look frozen.
let progressUnlisten: (() => void) | null = null;

/** Start the shared uv-progress listener (idempotent). Call once from AppShell. */
export function ensureSetupProgressListener(): void {
  if (progressUnlisten) return;
  progressUnlisten = () => {}; // claim the slot synchronously against a double call
  void watchSetupProgress((p) => useSetupStore.setState({ line: p.line })).then((u) => {
    progressUnlisten = u;
  });
}
