import { useCallback, useEffect, useState } from "react";
import { SEED_REGULATORY_RULES, type RegulatoryRule } from "@formulab/shared";
import { listRecordsSeeded } from "@/lib/masterdata";

/**
 * FVL-03.010 — the live, chemist-editable `regulatory_rules` collection,
 * loaded once. `listRecordsSeeded` seeds it from `SEED_REGULATORY_RULES`
 * on first run and never overwrites an edit afterward — the same rule
 * set `RegulatoryPanel.tsx` already reads, so a generated formula is
 * checked against the SAME authoritative rules a saved project would be,
 * not a frozen copy of the defaults. Mirrors `useSafetyRules.ts` exactly.
 */
export function useRegulatoryRules() {
  const [rules, setRules] = useState<RegulatoryRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRules(await listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { rules, loading };
}
