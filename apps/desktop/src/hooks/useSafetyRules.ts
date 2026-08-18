import { useCallback, useEffect, useState } from "react";
import { SEED_SAFETY_RULES, type SafetyRule } from "@formulab/shared";
import { listRecordsSeeded } from "@/lib/masterdata";

/**
 * FVL-03.009 — the live, chemist-editable `safety_rules` collection,
 * loaded once. `listRecordsSeeded` seeds it from `SEED_SAFETY_RULES` on
 * first run and never overwrites an edit afterward — the same rule set
 * `SafetyPanel.tsx` already reads, so a generated formula is checked
 * against the SAME authoritative rules a saved project would be, not a
 * frozen copy of the defaults. Mirrors `useCompatibilityRules.ts` exactly.
 */
export function useSafetyRules() {
  const [rules, setRules] = useState<SafetyRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRules(await listRecordsSeeded("safety_rules", SEED_SAFETY_RULES));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { rules, loading };
}
