# Material substitution

`packages/shared/src/schemas/substitution.ts`,
`packages/shared/src/engine/substitution.ts`,
`apps/desktop/src/components/formula/SubstitutionPanel.tsx`. Click the
replace-material icon on any formula line.

## What this is

A deterministic scoring engine over real data — never a name-similarity or
fuzzy-match ranking. Every scored dimension below traces to a field on the
candidate's `RawMaterial` record, its price/inventory/supplier records, or a
finding the real compatibility/safety engines produced for that specific
candidate substituted into the formula. A dimension with no backing data is
reported `missingData: true` and contributes `missingDataPenalty` (0 by
default) to the total — never scored as a perfect match by defaulting to 1.

## Scored dimensions

`engine/substitution.ts`'s `DEFAULT_SUBSTITUTION_WEIGHTS`:

| Dimension | Weight | Source |
|---|---|---|
| `function_match` | 0.16 | Jaccard overlap of `RawMaterial.functions` |
| `active_matter_equivalence` | 0.14 | closeness of as-supplied active % |
| `compatibility_impact` | 0.12 | `evaluateCompatibility` re-run with the candidate substituted in |
| `safety_impact` | 0.12 | `evaluateSafety` re-run with the candidate substituted in |
| `ionic_character_match` | 0.08 | exact `IonicCharacter` match |
| `regulatory_status` | 0.08 | `RawMaterial.regulatoryStatuses` for the target market(s); missing when no `verified` position exists |
| `available_stock` | 0.06 | aggregated `InventoryRecord.quantity - reservedQuantity` |
| `hlb_similarity` | 0.05 | `RawMaterial.hlb` closeness |
| `ph_compatibility` | 0.05 | `RawMaterial.phMin`/`phMax` range overlap |
| `recommended_use_overlap` | 0.05 | does the replaced line's percentage fall inside the candidate's `recommendedMinPercent`/`MaxPercent` |
| `landed_cost` | 0.05 | current `MaterialPrice` vs. the target's own cost |
| `supplier_approved` | 0.02 | `Supplier.approved` for the candidate's priced supplier |
| `lead_time` | 0.01 | `Supplier` lead time (not currently modelled per-material — see "Not modelled" below) |
| `kenya_local` | 0.005 | `Supplier.country === "Kenya"` |
| `evidence_confidence` | 0.005 | caller-supplied `evidenceConfidenceScore`, when present |

### Named in the specification but not modelled

The platform specification's 22-dimension list includes several this
platform has no source field for yet — inventing a score for them would be
exactly the "ranked by name similarity" anti-pattern this module exists to
avoid, so they are simply not scored:

- **Solubility compatibility**, **foam-profile similarity**, **mildness
  similarity**, **electrolyte response**, **rheology impact**,
  **preservative interaction** — no numeric field on `RawMaterial` backs any
  of these. `ph_compatibility` and `ionic_character_match` are the closest
  proxies this platform can honestly compute today.
- **MOQ** — `MaterialPrice.moq` exists but is not yet read into a scored
  dimension.
- **Country of origin** (general) — only the Kenya-local special case is
  scored; a full country-match/preference dimension is not implemented.

## Active-equivalent replacement

`activeEquivalentPercent(targetLinePercent, targetActivePercent,
candidateActivePercent)`: 10% of a 70%-active material contributes 7%
active matter; a 35%-active candidate needs 20% raw material to contribute
the same 7% — not the same 10%. Returns `undefined` (never a guessed 1:1
swap) when either active-matter percentage is unknown. The suggested
percentage is additionally capped at the candidate's `technicalMaxPercent`
when one is recorded.

## One-to-one vs. system substitution

`SubstitutionCandidate.isSystem` distinguishes a straight one-material swap
from a system substitution (a preservative system, a builder system, a
primary/secondary surfactant rebalance — several materials replacing one, or
one relationship replacing several). `requiresOptimization: true` marks a
candidate that needs the [Advanced Optimizer](ADVANCED_OPTIMIZER.md) to
actually place, rather than a direct line-percentage edit — a system
substitution is not attempted through simple percentage scaling.

**Current state: one-to-one substitution is fully implemented and wired to
the UI. System substitution (multi-material replacement routed through the
optimizer) is modelled in the schema (`isSystem`, `systemMaterialIds`,
`requiresOptimization`) but the UI does not yet generate a system candidate
or the seeded sub-problem that would hand it to the solver** — a real,
disclosed gap, not a silently missing feature.

## Filters

`in_stock only`, `no blocking compatibility findings`, `no blocking
compatibility or safety findings` are implemented in
`SubstitutionDialog`. `Approved suppliers only`, `Kenya-local suppliers`,
`lower landed cost`, `same ionic character`, and `verified data only` are
named in the specification's filter list but not yet exposed as UI toggles
— the underlying data (`supplierApproved`, `kenyaLocal`, `costImpact`,
`ionicCharacter` match, `regulatoryUncertain`) is already scored and shown
per candidate, just not yet filterable.

## Workflow (spec §5.6)

1. Select a formula line → **Replace material**.
2. Choose a reason (`SUBSTITUTION_REASONS`).
3. Review ranked candidates (`rankCandidates`: a blocking finding sorts a
   candidate after every clean one regardless of score; ties break
   deterministically by material code).
4. Inspect the score breakdown per candidate.
5. **Apply** — writes an immutable `SubstitutionRun` record
   (`substitution_runs` collection: the request, every scored candidate, and
   which one was selected) before touching the draft, so a run is auditable
   whether or not it is ultimately applied.
6. The line updates in the **working draft** — never the saved version the
   draft was derived from. The run's code is remembered
   (`appliedSubstitutionRunCode`) so the next saved version records it, and
   [approval readiness](APPROVAL_READINESS.md) re-validates that the
   referenced run's stored result was genuinely usable before approval can
   proceed.
7. Re-running formula validation, compatibility, safety and cost happens
   naturally on the next tab visit / autosave — the same re-evaluation any
   line edit triggers, not a substitution-specific code path.

Steps 8–9 of the specification (re-optimize the formula when required,
compare before/after as a dedicated view) are not yet built: applying a
`requiresOptimization` system candidate does not currently hand off to the
optimizer, and there is no dedicated before/after comparison screen for a
substitution (the general [version comparison](FORMULA_VERSIONING.md) view
covers the same need once both states are saved as versions).

## What this is not

- Not a name- or trade-name-similarity search.
- Does not itself decide a candidate is safe — `compatibility_impact`/
  `safety_impact` read findings from the real engines; a candidate with a
  blocking finding is still shown (sorted last), never silently hidden, so
  a chemist can see exactly why it ranked where it did.
- Does not establish regulatory compliance — `regulatory_status` reflects
  only a `verified` position already on record.
