/**
 * The one canonical derivation of "how much of a material is actually
 * usable right now" from `InventoryRecord` — FVL-03.004.
 *
 * No `InventoryRecord` field stores an "available"/"usable" quantity; it
 * is always derived (`quantity − reservedQuantity`, restricted to lots
 * that are actually releasable). Before this module, three call sites
 * (`MaterialsPage.tsx`, `AdvancedOptimizerPanel.tsx`, `SubstitutionPanel.tsx`)
 * each re-implemented `quantity − reservedQuantity` inline, and none of
 * them applied `quarantined`/`released`/`expiresAt` filtering. This module
 * is the single, authoritative definition going forward for any NEW
 * caller (FVL-03.004's own client-side inventory-feasibility evaluator);
 * the three pre-existing call sites are untouched, out of scope.
 *
 * A lot counts as usable only when both `quarantined`/`released` — real,
 * separate schema facts, not one inferred flag — say so, and it has not
 * expired as of the date asked about. `coaStatus` is deliberately NOT
 * gated on here: its business meaning ("pending" blocking or not) is not
 * defined anywhere in the schema or by any existing caller, so this
 * module does not invent one — it is surfaced for the caller to display,
 * never used to silently include or exclude a lot.
 *
 * Never sums quantities across incompatible units, and never treats "no
 * inventory record" the same as "zero usable quantity" — those are
 * different facts (`hasRecords` distinguishes them).
 */
import { dec, sum, ZERO, type Decimal } from "./decimal";
import type { InventoryRecord } from "../schemas/materials";

export interface MaterialAvailability {
  materialCode: string;
  /** Whether ANY InventoryRecord exists for this material, regardless of
   *  usability — `false` here is the real "UNKNOWN, no record at all"
   *  signal; `true` with `usableQuantity` still possibly `0` is a real,
   *  computed fact, not unknown. */
  hasRecords: boolean;
  /** Usable quantity summed across usable lots sharing one unit.
   *  `undefined` when usable lots exist in more than one unit (never
   *  silently summed across units) — the caller must treat that as
   *  unknown, not zero. */
  usableQuantity?: Decimal;
  unit?: string;
  consideredRecordCodes: string[];
  blockedRecordCodes: string[];
}

export function evaluateMaterialAvailability(
  records: InventoryRecord[],
  materialCode: string,
  asOf: string,
): MaterialAvailability {
  const matches = records.filter((r) => r.materialCode === materialCode);
  const blockedRecordCodes: string[] = [];
  const usableLots = matches.filter((r) => {
    if (r.quarantined) {
      blockedRecordCodes.push(r.code);
      return false;
    }
    if (!r.released) {
      blockedRecordCodes.push(r.code);
      return false;
    }
    if (r.expiresAt && r.expiresAt <= asOf) {
      blockedRecordCodes.push(r.code);
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    // No InventoryRecord at all for this material — genuinely unknown,
    // never treated as zero.
    return {
      materialCode,
      hasRecords: false,
      consideredRecordCodes: [],
      blockedRecordCodes,
    };
  }

  if (usableLots.length === 0) {
    // Records exist, but every one is quarantined/unreleased/expired —
    // `quarantined`/`released`/`expiresAt` are explicit, known facts, so
    // this is a real, computed zero, not missing data.
    return {
      materialCode,
      hasRecords: true,
      usableQuantity: ZERO,
      consideredRecordCodes: [],
      blockedRecordCodes,
    };
  }

  const units = new Set(usableLots.map((r) => r.unit));
  if (units.size > 1) {
    return {
      materialCode,
      hasRecords: true,
      consideredRecordCodes: usableLots.map((r) => r.code),
      blockedRecordCodes,
    };
  }

  const perLot = usableLots.map((r) => {
    const onHand = dec(r.quantity);
    const reserved = dec(r.reservedQuantity ?? "0");
    const net = onHand.minus(reserved);
    return net.greaterThan(ZERO) ? net : ZERO;
  });

  return {
    materialCode,
    hasRecords: true,
    usableQuantity: sum(perLot),
    unit: usableLots[0].unit,
    consideredRecordCodes: usableLots.map((r) => r.code),
    blockedRecordCodes,
  };
}
