import { useCallback, useEffect, useState } from "react";
import { SEED_COMPATIBILITY_RULES, type CompatibilityRule } from "@formulab/shared";
import { listRecordsSeeded } from "@/lib/masterdata";

/**
 * FVL-03.008 — the live, chemist-editable `compatibility_rules` collection,
 * loaded once. `listRecordsSeeded` seeds it from `SEED_COMPATIBILITY_RULES`
 * on first run and never overwrites an edit afterward — the same rule set
 * `CompatibilityPanel.tsx` already reads, so a generated formula is checked
 * against the SAME authoritative rules a saved project would be, not a
 * frozen copy of the defaults.
 */
export function useCompatibilityRules() {
  const [rules, setRules] = useState<CompatibilityRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRules(await listRecordsSeeded("compatibility_rules", SEED_COMPATIBILITY_RULES));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { rules, loading };
}
