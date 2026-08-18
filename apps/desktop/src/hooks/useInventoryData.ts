import { useCallback, useEffect, useState } from "react";
import { type InventoryRecord } from "@formulab/shared";
import { listRecords } from "@/lib/masterdata";

/**
 * FVL-03.004 — the canonical `InventoryRecord` collection, loaded once.
 * A separate hook from `useMasterCostData` (not an extension of it) — the
 * cost hook is already tested and live in FVL-03.003; keeping inventory
 * loading independent avoids any regression risk to it.
 */
export function useInventoryData() {
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRecords(await listRecords("inventory"));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { records, loading };
}
