import { useCallback, useEffect, useState } from "react";
import {
  type ExchangeRate,
  type FactoryCostProfile,
  type MaterialPrice,
  type RawMaterial,
} from "@formulab/shared";
import { listRecords } from "@/lib/masterdata";

/**
 * FVL-03.003 — the canonical Material Master / price / rate / factory-cost
 * inputs `costGeneratedFormula()` (and `CostPanel.tsx`, separately) need
 * from the authoritative Cost Engine. One loader, reused by every surface
 * that costs a generated formula — mirrors `CostPanel.tsx`'s own `load()`,
 * minus the packaging/BOM/cost_snapshots reads a generated (not-yet-saved)
 * card has no use for.
 */
export function useMasterCostData() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [prices, setPrices] = useState<MaterialPrice[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [profiles, setProfiles] = useState<FactoryCostProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, p, r, f] = await Promise.all([
      listRecords("materials"),
      listRecords("material_prices"),
      listRecords("exchange_rates"),
      listRecords("factory_profiles"),
    ]);
    setMaterials(m);
    setPrices(p);
    setRates(r);
    setProfiles(f);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { materials, prices, rates, profiles, loading };
}
