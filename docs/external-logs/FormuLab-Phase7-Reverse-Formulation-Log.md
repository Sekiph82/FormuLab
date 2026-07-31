# FormuLab Phase 7 Reverse Formulation Log

## Objective
Build a complete Reverse Formulation workspace that helps a formulator reconstruct plausible formulations from competitor product information, label ingredient declarations, INCI lists, packaging text, technical data, safety data, analytical composition, physical measurements, laboratory test results, performance observations, sensory observations, known raw-material catalogs, known supplier products, known formulation rules, regulatory restrictions, cost targets.

## Starting repository state
- Branch: feature/laboratory-stability
- Local HEAD: 1c88164
- Remote HEAD: 1c88164 (synchronized)
- Modified files: .FormuLab/runs.db (permitted), formulas/index.json (stashed for clean state)

## Starting branch
feature/laboratory-stability

## Starting local HEAD
1c88164

## Starting remote HEAD
1c88164

## Safety branch
backup/pre-phase7-reverse-formulation (created from current state after stashing formulas/index.json)

## Phase tracker update
Updated docs/architecture/IMPLEMENTATION_STATUS.md to move Reverse formulation from "Not yet started" to "In progress".

## Existing architecture inspected
- Reviewed packages/shared/src/schemas/ for domain models
- Reviewed packages/shared/src/engine/ for existing engines (formulation, cost, regulatory, safety, etc.)
- Reviewed apps/desktop/src/app/routes/ for existing workspace routes
- Reviewed apps/desktop/src/components/ for reusable UI components
- Reviewed runtime/formulation and runtime/pipeline for existing formulation and pipeline logic
- Reviewed docs/ for existing documentation

## Reverse Formulation domain model
Defined Zod schemas for all domain entities in packages/shared/src/schemas/reverseFormulation.ts:
- ReverseFormulationStudy
- BenchmarkProduct
- BenchmarkEvidenceItem
- IngredientDeclarationLine
- AnalyticalCompositionResult
- TargetProductProfile
- ReverseConstraintSet
- IngredientMapping
- SubstitutionRule
- ReverseFormulaCandidate
- CandidateScoreExplanation

## Benchmark product model
[To be filled]

## Input data model
[To be filled]

## Analytical composition model
[To be filled]

## Ingredient declaration model
[To be filled]

## Ingredient mapping model
[To be filled]

## Raw-material substitution model
[To be filled]

## Target product profile
[To be filled]

## Reverse constraints
[To be filled]

## Candidate generation
[To be filled]

## Candidate scoring
[To be filled]

## Candidate comparison
[To be filled]

## Confidence model
[To be filled]

## Evidence and assumptions
[To be filled]

## Formula Builder integration
[To be filled]

## Costing integration
[To be filled]

## Regulatory integration
[To be filled]

## Laboratory integration
[To be filled]

## DOE integration
[To be filled]

## Data Exchange integration
[To be filled]

## UI implementation
[To be filled]

## Validation
[To be filled]

## Persistence
[To be filled]

## Audit events
[To be filled]

## Authorization
[To be filled]

## Tests
[To be filled]

## Files inspected
- packages/shared/src/schemas/formulation.ts
- packages/shared/src/schemas/materials.ts
- packages/shared/src/schemas/costing.ts
- packages/shared/src/schemas/regulatory.ts
- packages/shared/src/schemas/safety.ts
- packages/shared/src/schemas/compatibility.ts
- packages/shared/src/schemas/laboratory.ts
- packages/shared/src/schemas/doe.ts
- packages/shared/src/schemas/dossier.ts
- packages/shared/src/schemas/claimsLabels.ts
- packages/shared/src/engine/formula.ts
- packages/shared/src/engine/cost.ts
- packages/shared/src/engine/regulatoryApproval.ts
- packages/shared/src/engine/safety.ts
- packages/shared/src/engine/compatibility.ts
- packages/shared/src/engine/laboratory.ts
- packages/shared/src/engine/doeAnalysis.ts
- apps/desktop/src/app/routes/FormulationPage.tsx
- apps/desktop/src/app/routes/LaboratoryPage.tsx
- apps/desktop/src/app/routes/StabilityPage.tsx
- apps/desktop/src/app/routes/OptimizationPage.tsx
- apps/desktop/src/app/routes/RegulatoryPage.tsx
- apps/desktop/src/app/routes/ApprovalPage.tsx
- apps/desktop/src/app/routes/DossiersPage.tsx
- apps/desktop/src/app/routes/ClaimsLabelsPage.tsx
- apps/desktop/src/app/routes/DoePage.tsx
- apps/desktop/src/app/routes/DataExchangePage.tsx
- apps/desktop/src/components/formula/MaterialEditor.tsx
- apps/desktop/src/components/formula/CostPanel.tsx
- apps/desktop/src/components/formula/CompatibilityPanel.tsx
- apps/desktop/src/components/formula/SafetyPanel.tsx
- apps/desktop/src/components/formula/RuleManager.tsx

## Files created
[To be filled]

## Files modified
[To be filled]

## Files deleted
[To be filled]

## Commands executed
[To be filled]

## Bugs discovered
[To be filled]

## Bugs fixed
[To be filled]

## Commits created
[To be filled]

## Pushes
[To be filled]

## Release build
[To be filled]

## Shortcut verification
[To be filled]

## Live native verification
[To be filled]

## Persistent verification project
[To be filled]

## Remaining limitations
[To be filled]

## Final git status
[To be filled]

## Final summary
[To be filled]
## Session 1: Shared Domain Repair (2026-07-30)

### Objective
Repair and validate the existing Phase 7 shared-domain prototype (schema + five
engine files) so it compiles and behaves with integrity, without redesigning
candidate generation or scoring.

### Initial HEAD
1c88164ddccb527abcc8892afe5304cb09917729 (feature/laboratory-stability)

### Files inspected
- packages/shared/src/schemas/primitives.ts
- packages/shared/src/schemas/reverseFormulation.ts
- packages/shared/src/schemas/formulation.ts, materials.ts, optimization.ts (convention reference)
- packages/shared/src/engine/declarationParser.ts
- packages/shared/src/engine/ingredientMapper.ts
- packages/shared/src/engine/analyticalInference.ts
- packages/shared/src/engine/candidateGenerator.ts
- packages/shared/src/engine/scoringModel.ts
- packages/shared/src/index.ts
- packages/shared/src/engine/substitution.test.ts (test-style reference)

### Files changed
- packages/shared/src/schemas/reverseFormulation.ts
- packages/shared/src/engine/declarationParser.ts
- packages/shared/src/engine/ingredientMapper.ts
- packages/shared/src/engine/analyticalInference.ts
- packages/shared/src/engine/candidateGenerator.ts
- packages/shared/src/engine/scoringModel.ts
- AGENTS.md
- docs/handoffs/PHASE7_CURRENT.md (created)

### Files added (tests)
- packages/shared/src/engine/declarationParser.test.ts
- packages/shared/src/engine/ingredientMapper.test.ts
- packages/shared/src/engine/analyticalInference.test.ts
- packages/shared/src/engine/candidateGenerator.test.ts
- packages/shared/src/engine/scoringModel.test.ts

### Key fixes
- reverseFormulation.ts imported ten primitives (ProductId, MaterialId,
  JurisdictionCode, UserId, Timestamp, RevisionNumber, ProductFamilyCode,
  Percentage, Money, ConfidenceScore) that do not exist in primitives.ts or
  anywhere else in the package, and used none of them — hard compile failure.
  Replaced with the real `decimalString` primitive, applied to
  `AnalyticalCompositionResult.value` to match how the engine already parsed it.
- candidateGenerator.ts: `generateCandidates` referenced an undefined
  `matchedIngredients` (real param name: `mappedIngredients`) in three call
  sites; `generateFromDeclaredHints` referenced an undefined `mats` (should be
  `materialsWithCandidates`); `estimateProperties` normalized weights with
  `for...in Object.keys(props)` (iterates array indices, not the keys) hidden
  behind an `@ts-ignore`.
- scoringModel.ts: `analScore` (undefined) should have been `analogScore`;
  `extra` (undefined) should have been `excess`, in two places. Both were
  guaranteed `ReferenceError`s at runtime.
- analyticalInference.ts: `ANALYTE_FUNCTION_MAP['Cl']` listed `'buffer'`, not a
  member of `MATERIAL_FUNCTIONS` — a compile-time type error; replaced with
  `'ph_adjuster'`.
- Missing `IngredientDeclarationLine` import in candidateGenerator.ts and
  scoringModel.ts (both used the type without importing it).
- scoringModel.ts exported `scoreCandidate`, colliding with the existing export
  of the same name from engine/substitution.ts via the `index.ts` barrel;
  renamed to `scoreReverseFormulaCandidate`.
- Integrity fix: scoringModel.ts hardcoded `order: 0.8`, `performance: 0.7`,
  `regulatory: 0.9` as "placeholders" for dimensions that were never actually
  evaluated — including an explanation string falsely claiming "No restricted
  substances detected." Replaced with neutral `0.5` scores and explanations
  that honestly state the dimension was not evaluated, per the no-fabricated-
  compliance/evidence requirement.

### Tests
`pnpm --filter @ai4s/shared exec vitest run` on the 5 new focused test files:
23/23 passing. Coverage includes blank/empty input, malformed input, duplicate
ingredient names, multi-word names, declared order, unknown ingredients/analytes,
low-confidence mappings, empty-catalog handling, measured-vs-inferred value
distinction, deterministic generation/scoring, and the neutral-not-fabricated
scoring behavior for unassessed dimensions.

### Results
`pnpm --filter @ai4s/shared typecheck` — clean, no errors.

### Remaining issues
- candidateGenerator.ts and scoringModel.ts each carry a private, near-duplicate
  `computeMatchScore` helper (not deduplicated — left for Session 2).
- Candidate-generation quality itself (baseline heuristics, `generateFromAnalytical`
  delegating to the declared-hints path) is unchanged prototype behavior, by design
  (out of this session's scope).

### Commit
fix(reverse-formulation): repair phase 7 shared foundation

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Next session
Phase 7 Session 2: Candidate Generation and Scoring Quality

## Session 2: Candidate Generation and Scoring Quality (2026-07-30)

### Objective
Improve quality, determinism, and honesty of the existing candidate-generation
and scoring engines, and deduplicate the two near-identical `computeMatchScore`
helpers flagged as a known issue after Session 1. No new subsystem.

### Initial HEAD
35929fa1b2c0b6839c3f51f6d6c29dc18fe2b9ba (feature/laboratory-stability)

### Files inspected
- AGENTS.md, docs/handoffs/PHASE7_CURRENT.md
- packages/shared/package.json
- packages/shared/src/schemas/reverseFormulation.ts
- packages/shared/src/engine/candidateGenerator.ts, scoringModel.ts
- packages/shared/src/engine/candidateGenerator.test.ts, scoringModel.test.ts
- packages/shared/src/engine/ingredientMapper.ts, analyticalInference.ts

### Files changed
- packages/shared/src/engine/candidateGenerator.ts
- packages/shared/src/engine/scoringModel.ts
- packages/shared/src/engine/candidateGenerator.test.ts
- packages/shared/src/engine/scoringModel.test.ts
- docs/handoffs/PHASE7_CURRENT.md (replaced, not appended)

### Key changes
- Compared the two `computeMatchScore` helpers: their active-matter branches
  were identical, but their pH branches used different formulas (candidate
  generator scored distance-from-midpoint even inside the target range;
  scoring model scored flat 1.0 anywhere in range). Treated this as accidental
  drift rather than an intentional distinction, unified on the more sensible
  "in range = 1.0, falloff outside" rule, and exported one
  `computeTargetMatchScore` from scoringModel.ts for both files to use.
- Fixed a real division-by-zero/NaN risk in that formula: a zero-width or
  inverted target range no longer produces NaN — an exact match scores 1, any
  miss scores 0.
- candidateGenerator.ts: added `formulaSignature` + a dedup pass so two
  generation methods that produce the same formula (materials + percentages)
  no longer appear as two "different" candidates; added
  `validateAgainstConstraints` so `excludedMaterials`, `minimumPercentages`,
  `maximumPercentages`, and `requiredMaterials` are actually enforced (were
  previously accepted as parameters and never used); added `roundTo2` /
  `normalizeToTotal` so formula percentages are always finite, non-negative,
  and sum to their declared total exactly instead of drifting from
  per-line rounding; each of the three generation methods now returns a
  `GenerationAttempt` (candidate or an honest rejection reason) instead of a
  bare nullable candidate, and `generateFromAnalytical` declines outright
  (rather than silently duplicating the declared-hints candidate under a
  misleading "analytical" label) when `analysis.totalAnalytes === 0`.
- scoringModel.ts: added `evaluatedDimensions` (which of the 7 scoring
  dimensions were backed by real evidence this call) and `evidenceConfidence`
  (evaluated ÷ total) to `ScoringModelOutput`, so confidence-in-the-assessment
  is a separate, explicit number from the score itself. The weighted overall
  score now divides by the actual valid weight total rather than assuming
  `SCORE_WEIGHTS` sums to exactly 1. Added `clamp01`/`Number.isFinite` guards
  throughout so malformed candidate/target inputs degrade to a neutral 0.5
  instead of propagating NaN.

### Tests
`pnpm --filter @ai4s/shared exec vitest run` on the 2 focused test files:
23/23 passing (candidateGenerator: 11, scoringModel: 12). New coverage:
duplicate/equivalent-candidate dedup, constraint rejection (excluded
material, missing required material), blank-hint-not-zero, unmapped
ingredients staying explicit, no-analytical-data-no-fabricated-candidate,
percentage-total consistency, zero-width-range division-by-zero guard,
evidence-vs-neutral-default distinction, confidence-vs-score distinguishability,
and a bounded-not-perfect overall score under maximal evidence.

### Results
`pnpm --filter @ai4s/shared typecheck` — clean, no errors.

### Remaining issues
- No real analyte-to-material quantification model — `generateFromAnalytical`
  still only mirrors the declared-hints candidate (now deduplicated when
  identical, rather than presented as a distinct third option).
- Constraint handling rejects violations; it does not reflow percentages to
  satisfy them (would require a real optimizer, explicitly out of scope).
- `scoreReverseFormulaCandidate`'s `availableMaterials: Map<string, any>`
  parameter remains unused.

### Commit
feat(reverse-formulation): improve candidate generation and scoring

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Next session
Phase 7 Session 3: Rust Persistence

## Session 3: Rust Persistence (2026-07-30)

### Objective
Repair and validate the Phase 7 Rust master-data collection registration for
Reverse Formulation in apps/desktop/src-tauri/src/masterdata.rs. No other
subsystem.

### Initial HEAD
c27e07de6263a1d98b2aa7955ffd2edd3ac048e5 (feature/laboratory-stability)

### Files inspected
- AGENTS.md, docs/handoffs/PHASE7_CURRENT.md
- apps/desktop/src-tauri/Cargo.toml
- apps/desktop/src-tauri/src/masterdata.rs

### Files changed
- apps/desktop/src-tauri/src/masterdata.rs
- docs/handoffs/PHASE7_CURRENT.md (replaced, not appended)

### Key fixes
- The working tree already carried an uncommitted diff appending 11 Reverse
  Formulation entries to `COLLECTIONS` without updating its fixed-size array
  type annotation: `const COLLECTIONS: [(&str, bool); 76]` actually held 87
  entries (verified by counting `", true)`/`", false)` occurrences in the
  array literal). Rust's `[T; N]` requires an exact length match, so the
  crate did not compile. Corrected 76 -> 87.
- `candidate_score_explanations` was registered mutable (`false`). Compared
  its schema shape (a computed score/weight/reason snapshot tied to one
  scoring pass of a candidate) against the file's own established
  precedents — `doe_analyses`, `compatibility_snapshots`, `optimization_runs`
  are all append-only for exactly this reason ("re-solving/re-scoring must
  not silently overwrite the rationale behind an earlier decision"). Fixed
  to `true`.
- Cross-checked the remaining 10 collection names against the TS schema
  (schemas/reverseFormulation.ts) and their status-lifecycle fields; all
  correctly mutable (`false`), consistent with `regulatory_evidence_items`/
  `doe_observations`/`doe_candidates`. No further mutability or naming
  changes needed — names already followed the file's consistent
  camelCase-TS -> snake_case-Rust convention letter for letter.
- Added the 11 missing `data/master/*.json` paths to the header doc comment
  (every other phase's collections are listed there; Phase 7's weren't).

### Tests
`cargo test --lib masterdata::` in apps/desktop/src-tauri: 11/11 passing.
Added: allow-list + mutability assertions for all 11 Reverse Formulation
collections (mirroring the existing per-phase test pattern), an
append-only-collections-cannot-be-mutable check, a fixed-array-length
regression guard (`COLLECTIONS.len() == 87`), a no-duplicate-name guard
across the whole allow-list, and extended the unknown-name test to also
reject the TS-side camelCase spelling and a near-miss typo.

### Results
Crate compiles cleanly (the array-length fix was required for `cargo test`
to build at all); all masterdata tests green.

### Remaining issues
- `CandidateScoreExplanation` has no `code`/`id` field in the TS schema, so
  the generic `row_key()`-based upsert path cannot write to
  `candidate_score_explanations` yet — every upsert would fail with "record
  has no `code` or `id`". This is a schema gap, out of this session's
  allowed-modify scope (masterdata.rs only); flagged in the handoff for
  whoever wires up Reverse Formulation persistence calls.

### Commit
fix(reverse-formulation): repair rust persistence registration

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Next session
Phase 7 Session 4: Data Exchange Integration

## Session 4: Data Exchange Integration (2026-07-30)

### Objective
Add Reverse Formulation support to the existing Data Exchange framework
(registry, validation, commit) for all 11 collections, reusing the generic
pipeline rather than building a parallel import system, and resolve the
Session 3 `candidateScoreExplanations` persistence-key blocker.

### Initial HEAD
d1a9baa0f20a172d51eb86f0514f36ac0b9c90c4 (feature/laboratory-stability)

### Note on prompt paths
The prompt named `apps/desktop/src/lib/dataExchangeRegistry.ts` and
`dataExchangeValidation.ts`. Neither exists at that path — both live in
`packages/shared/src/engine/` (only `dataExchangeCommit.ts` is really under
`apps/desktop/src/lib/`). Treated as a path-prefix error in the prompt
(same filenames, same purpose) and proceeded against the real files, since
the prompt's own modify list already granted `packages/shared/src/*` access
for the adjacent schema/index cases.

### Files inspected
- AGENTS.md, docs/handoffs/PHASE7_CURRENT.md
- packages/shared/src/schemas/reverseFormulation.ts
- packages/shared/src/schemas/dataExchange.ts
- packages/shared/src/engine/dataExchangeRegistry.ts (full, 1089 lines)
- packages/shared/src/engine/dataExchangeValidation.ts
- apps/desktop/src/lib/dataExchangeCommit.ts (full, 1190 lines)
- apps/desktop/src/lib/masterdata.ts (read-only — persistence-facing code)
- apps/desktop/src/lib/dataExchangeCommit.test.ts, dataExchangeCommitShapes.test.ts
- packages/shared/src/engine/dataExchangeRegistry.test.ts, dataExchangeValidation.test.ts

### Files changed
- packages/shared/src/schemas/reverseFormulation.ts
- packages/shared/src/engine/dataExchangeRegistry.ts
- apps/desktop/src/lib/dataExchangeCommit.ts
- packages/shared/src/engine/dataExchangeRegistry.test.ts
- packages/shared/src/engine/dataExchangeValidation.test.ts
- apps/desktop/src/lib/dataExchangeCommit.test.ts
- docs/handoffs/PHASE7_CURRENT.md (replaced, not appended)

### Key findings and fixes
- `dataExchangeCommit.ts` already carried an uncommitted scaffold: type
  imports for the 11 Reverse Formulation schema types, and 11
  `COMMIT_HANDLERS` entries (`reverse_formulation_studies:
  commitReverseFormulationStudies`, etc.) referencing handler functions that
  were never defined anywhere — the file did not compile. Zero matching
  registry templates existed either. Implemented both sides fully.
- Registry (Templates 25-35): natural keys chosen per entity (single code
  for header rows; composite product/order/type keys for entities with no
  own `code` field, e.g. `benchmark_evidence_items`,
  `ingredient_declaration_lines`); every parent reference modeled as a real
  `code_reference` column so the generic preview engine catches a missing
  parent before commit ever runs. Every workflow-status-shaped column
  (study status, mapping status, substitution-rule status, candidate status)
  is restricted to its single safe starting enum value — the same
  established pattern as `product_claims`/`label_content`/`doe_observations`
  — so import can never claim review, confirmation, selection or validation.
  `analytical_composition_results` and `candidate_score_explanations` use
  `new_revision` (append-only), matching their Rust `append_only: true`
  classification from Session 3.
- Commit handlers: every handler that needs a parent (study, benchmark
  product, declaration line, material, candidate) resolves it by code and
  throws an honest, specific error if missing — never fabricates one, same
  discipline as every one of the original 24 templates.
  `reverse_formula_candidates` is grouped like `formula_bom` (one row per
  (candidate, material) line). `analytical_composition_results` always
  writes a brand-new `unverified` record. `candidate_score_explanations`
  always writes a brand-new record with a fresh `id`.
- Persistence-key decision for `candidateScoreExplanations`: added
  `id: z.string()` to the schema (packages/shared/src/schemas/
  reverseFormulation.ts) — every other Reverse Formulation collection
  already had one, and grepping confirmed nothing in the codebase
  constructed this type yet, so the change has zero blast radius. This
  resolves the Session 3 `row_key()`/upsert blocker.
- Also extracted 3 previously-inline enums to named exported consts
  (`BENCHMARK_EVIDENCE_TYPES`, `INGREDIENT_MAPPING_METHODS`,
  `CANDIDATE_SCORE_TYPES`), matching the `MATERIAL_DOCUMENT_TYPES`-style
  convention every other Data-Exchange-integrated schema already follows —
  required so the registry could reference these vocabularies without
  duplicating (and risking drift from) the schema's own enum lists.
- Scope gap, flagged rather than silently worked around:
  `apps/desktop/src/lib/masterdata.ts`'s `Collection`/`CollectionTypes`
  union was not extended (explicitly outside this session's allowed-modify
  list). The 11 new commit handlers bridge through a narrow, locally-scoped
  `ReverseFormulationCollection` type + `rfList`/`rfUpsert`/`rfFindByCode`
  helpers inside `dataExchangeCommit.ts`, with the cast to `Collection`
  isolated to those three functions and documented in place. The Rust
  allow-list (`collection_spec`, fixed Session 3) remains the actual safety
  boundary and independently rejects any name it doesn't recognize.

### Tests
- `pnpm --filter @ai4s/shared exec vitest run` on the registry + validation
  focused files: 76/76 passing (35 registry incl. new "Reverse Formulation
  templates" block; 41 validation incl. new "Reverse Formulation templates"
  block covering missing identifiers, malformed decimals, out-of-range
  confidence, invalid enums, blank-stays-blank, and exact decimal
  preservation).
- `pnpm --filter @ai4s/desktop exec vitest run` on the commit + shapes
  focused files: 74/74 passing (20 new commit tests covering every
  missing-parent path, append-only new-record-per-import behavior for
  analytical results and score explanations, grouped candidate commits, and
  the stable-id resolution of the Session 3 blocker).

### Results
`pnpm --filter @ai4s/shared typecheck` — clean. `pnpm --filter @ai4s/desktop
typecheck` — 2 pre-existing errors, both in Session 2 files
(`candidateGenerator.ts`/`scoringModel.ts`, unused parameters under this
package's stricter `noUnusedParameters`, never previously surfaced because
no prior session ran the desktop-scoped typecheck). Unrelated to and
untouched by this session; zero errors in anything this session changed.

### Remaining issues
- `masterdata.ts` `Collection` union gap (above).
- The 2 pre-existing desktop-typecheck errors (above), out of this
  session's allowed-modify scope.

### Commit
feat(reverse-formulation): add data exchange integration

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Next session
Phase 7 Session 5: Desktop Reverse Formulation Workspace

## Session 5: Desktop Reverse Formulation Workspace (2026-07-30)

### Objective
Build a real, operational desktop Reverse Formulation workspace and resolve
the two known desktop-typecheck errors plus the Session 4 `masterdata.ts`
`Collection`-union gap.

### Initial HEAD
3c0363306bb110f54c0d7a23cb1c656303303fbc (feature/laboratory-stability)

### Note on prompt paths
The prompt named `apps/desktop/src/components/Sidebar.tsx`; the real file
is `apps/desktop/src/components/sidebar/Sidebar.tsx` (lowercase directory).
Same pattern as Session 4's registry/validation path mismatch — proceeded
against the real file.

### Desktop typing repairs
- Extended `masterdata.ts`'s `Collection`/`CollectionTypes` with the 11
  Reverse Formulation collections, closing the gap Session 4 flagged.
  `dataExchangeCommit.ts`'s local cast-bridge (`ReverseFormulationCollection`
  + `rfList`/`rfUpsert`/`rfFindByCode`) was left in place rather than
  removed, since that file is outside this session's allowed-modify scope
  — it is now redundant (same 11 names, real compile-time safety already
  exists via `masterdata.ts`) but harmless.
- Fixed the two known `noUnusedParameters` errors by prefixing the
  intentionally-unused parameters with `_` (`_mappedIngredients` in
  `generateBaselineFormula`, `_availableMaterials` in
  `scoreReverseFormulaCandidate`) — the repo's existing
  `argsIgnorePattern: "^_"` convention. No signature/call-site changes, no
  engine redesign.

### Workspace implementation
- New route `/reverse-formulation` → `ReverseFormulationPage.tsx`: study
  list/create/select, benchmark products (attach existing or create+attach),
  and per-product declarations/analytical evidence/ingredient mappings
  (propose, then confirm/reject as a real human review action), plus a
  Target & Constraints section (link existing or create+link a
  `TargetProductProfile`/`ReverseConstraintSet`). Every write goes through
  `@/lib/masterdata`'s typed `listRecords`/`upsertRecords`.
- New `CandidateComparisonPanel` component: builds `GenerationInput` from
  already-loaded records (declaration lines mapped via their best recorded,
  non-rejected `IngredientMapping`, or an honest "unmapped" result — never a
  guess), calls the real `generateCandidates`/`scoreReverseFormulaCandidate`
  from `@ai4s/shared` directly, and renders their unmodified output: formula
  lines, overall score vs. evidence confidence as two distinct numbers, a
  7-dimension breakdown explicitly tagged Evaluated/Not evaluated from
  `ScoringModelOutput.evaluatedDimensions`, and the engine's own
  notes/rejection-reason text. "Save as candidate record" persists to
  `reverse_formula_candidates` + `candidate_score_explanations` only —
  never `formulations` (Session 6 territory, explicitly out of scope here).
- Caught and fixed several bugs before they shipped: a nonexistent `"input"`
  CSS utility class (no such class exists anywhere in the codebase — fixed
  to real Tailwind classes matching the established inline-form
  convention); a namespace-colon typo (`t("reverseFormulation:candidates...")`
  instead of dot-path, which i18next would have resolved against a
  nonexistent "reverseFormulation" namespace); dynamic template-literal
  translation keys (`t(\`...${status}\`)`), which don't satisfy i18next's
  typed-key checking and don't match the codebase's static-lookup-map
  convention (`TAB_LABEL_KEY` in FormulationPage.tsx) — replaced with
  explicit per-value key maps; and a leftover broken/dead expression in the
  loading-state branch.

### Navigation and i18n
- Added the route to `router.tsx`, a `Microscope`-icon entry to
  `Sidebar.tsx`'s workspaces section, `workspacesNav.reverseFormulation` to
  `nav.json`, and a full `reverseFormulation` tree (~80 leaf keys) to
  `session.json` — real, distinct translations for all 8 shipped locales
  (en/de/es/fr/ja/ko/tr/zh-Hans), generated via a one-off script (not
  committed) and verified against the repo's own `parity.test.ts`, which
  passed on the first run after generation.

### Tests
`pnpm --filter @ai4s/desktop exec vitest run` on the new
ReverseFormulationPage.test.tsx plus the directly-affected
parity/Sidebar-i18n/Workspaces/Pages-i18n suites: 36/36 passing. Coverage:
route resolves, Sidebar link present, empty-state renders safely, studies
list/select, draft study created at status "draft" only, candidate
generation invoking the real (unmocked) shared engine and rendering its
genuine output, overall score vs. evidence confidence shown as distinct
numbers, unevaluated dimensions honestly labeled, an insufficient-evidence
scenario showing "No formula lines" plus rejection-reason notes (never a
fabricated formula), a blank concentration hint rendering as "unknown"
never "0%", candidate save writing only the two Reverse Formulation
collections (never `formulations`), and a mocked persistence failure
surfacing a visible `role="alert"` error.

### Results
`pnpm --filter @ai4s/shared typecheck` and `pnpm --filter @ai4s/desktop
typecheck` — both clean (the two previously-known desktop errors are gone).

### Remaining issues
- `dataExchangeCommit.ts`'s redundant local collection-bridge type (above),
  out of this session's scope.
- No candidate-to-formula creation (by design).
- Declaration/analytical/mapping entry forms are intentionally minimal
  (basic guards only, not the full Data Exchange validation engine).

### Commit
feat(reverse-formulation): add desktop workspace

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Next session
Phase 7 Session 6: Candidate-to-Formula Integration

## Session 6: Candidate-to-Formula Integration (2026-07-30)

### Objective
Integrate an explicitly selected, saved Reverse Formula Candidate with the
existing formulation/versioning workflow so it can create a safe draft or
new version through existing safeguards — no second persistence path, no
inherited approval state.

### Initial HEAD
11641b6c0a12a4d67a52b0757572e9f09a1c2bb5 (feature/laboratory-stability)

### Files inspected
- AGENTS.md, docs/handoffs/PHASE7_CURRENT.md
- packages/shared/src/schemas/reverseFormulation.ts, formulation.ts
- packages/shared/src/engine/candidateGenerator.ts, scoringModel.ts, versioning.ts
- apps/desktop/src/app/routes/ReverseFormulationPage.tsx
- apps/desktop/src/components/reverseFormulation/CandidateComparisonPanel.tsx
- apps/desktop/src/hooks/useFormulationWorkspace.ts
- apps/desktop/src/lib/masterdata.ts, formulations.ts

### Files changed
- apps/desktop/src/app/routes/ReverseFormulationPage.tsx
- apps/desktop/src/components/reverseFormulation/CandidateComparisonPanel.tsx
- apps/desktop/src/app/routes/ReverseFormulationPage.test.tsx
- apps/desktop/src/lib/dataExchangeCommit.ts (redundant bridge removal)
- apps/desktop/src/i18n/locales/*/session.json (8 locales)
- docs/handoffs/PHASE7_CURRENT.md (replaced, not appended)

### Design decisions
- Conversion attaches to the same in-memory generated+saved candidate card
  (not a separate "browse saved candidates" reload) — `ScoringModelOutput`
  (including `evidenceConfidence`/`evaluatedDimensions`) is already live in
  the component from generation, so no schema change or persisted-data
  derivation was needed to show the low-confidence warning honestly.
- Gated on `saved && selected` — a candidate must be both persisted (the
  objective's "for a selected saved Reverse Formula Candidate") and
  explicitly chosen via the existing "Select for review" toggle. Distinct
  from "Save as candidate record", by design (own test coverage).
- Both versioning paths implemented (not just the brand-new-draft
  fallback): "new draft" always available; "new version" via a target
  select populated by `listFormulations()`, using `readFormulation` +
  `nextVersionNumber` to compute the correct next version number and
  `parentVersionId`, mirroring `useFormulationWorkspace.ts`'s own
  `onSaveVersion` exactly.
- Traceability (study code + candidate code) recorded via `changeReason`
  (free text, already schema-documented for exactly this) and an
  `appendAudit` event's structured `metadata` field — no schema change.
- Removed the Session 4 `dataExchangeCommit.ts` `ReverseFormulationCollection`
  bridge (25 call sites + the type/3 wrapper functions) now that
  `masterdata.ts`'s real `Collection` union (Session 5) covers all 11
  names — every handler calls `listRecords`/`upsertRecords`/`findByCode`
  directly. Caught and fixed a sed-generated bug mid-cleanup (an overly
  broad regex replace briefly clobbered the wrapper function definitions
  themselves, including creating a duplicate `findByCode`) before it landed
  — verified with a full block review, not just the mechanical rename.

### Tests
`pnpm --filter @ai4s/desktop exec vitest run` on ReverseFormulationPage.test.tsx
(23, 10 new for conversion), dataExchangeCommit.test.ts (61, confirms the
bridge removal changed no behavior), and parity.test.ts (15): 99/99 passing.
New coverage: no action without selection, missing-material block (material
removed from catalog between generation and conversion, no placeholder
fabricated), new-draft creation with `status: "concept"` and empty
approval-related arrays, exact line order/materialCode/percent preserved
with unsupplied fields left `undefined`, duplicate-click prevention
(button replaced by success text), new-version-on-existing-formulation
with correct `parentVersionId`/incremented `versionNumber` (prior version
never touched), a visible error on a mocked persistence failure, the
low-confidence warning alongside the decision-support notice, save/create
as genuinely distinct actions, and the source candidate record never
re-written during conversion.

### Results
`pnpm --filter @ai4s/desktop typecheck` — clean. No shared package files
changed this session, so shared typecheck was not run (per instructions).

### Remaining issues
- Conversion UI is intentionally minimal (one select + one button per
  card), matching the rest of the workspace's lean entry-form style.
- No pre-conversion cost/regulatory/laboratory readiness check — by design,
  this is decision support only, not a new approval gate.

### Commit
feat(reverse-formulation): integrate candidates with formulations

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Next session
Phase 7 Closure: Full Verification and Release

---

## Session 7: Phase 7 Closure — Full Verification and Release

### HEAD
Initial: 7cf23cb96eeaf1c15aebcfb62273980147154b46 (== upstream, clean tree
apart from the pre-existing, deliberately-untouched files carried across
every session: `.FormuLab/runs.db`, `.gitignore`, `formulas/index.json`).
Final: recorded in this commit's parent line (see below).

### Level 2 — Phase 7 focused tests
Shared engines (declarationParser, ingredientMapper, analyticalInference,
candidateGenerator, scoringModel, dataExchangeRegistry, dataExchangeValidation):
115/115. Desktop (ReverseFormulationPage.test.tsx 23, dataExchangeCommit.test.ts,
dataExchangeCommitShapes.test.ts, i18n/parity.test.ts, Sidebar.i18n.test.tsx,
Workspaces.test.tsx): 118/118. Rust masterdata (`cargo test --lib masterdata::`):
11/11. No Phase 7 defects found — all green on first run.

### Level 3 — full regression
Shared: 1154/1154, typecheck clean. Desktop: found 2 real regressions on
first run (both pre-existing, surfaced by this being the first full run
since Phase 7 landed, not newly introduced this session):
1. `DataExchangePage.test.tsx` asserted 24 template cards / 24 Upload
   buttons — stale from before Phase 7 added 11 Data Exchange templates
   (`DATA_EXCHANGE_TEMPLATES` is authoritatively 35, per
   `dataExchangeRegistry.test.ts`). Fixed: updated the assertion and its
   docstring/comment to 35.
2. `CandidateComparisonPanel.tsx:315` — `eslint-plugin-i18next`'s
   `no-literal-string` flagged `aria-hidden="true"` on the `CheckCircle2`
   icon component. Root cause: the rule auto-exempts `aria-hidden="true"`
   only on native lowercase DOM tags (confirmed by reading
   `isAllowedDOMAttr` in the plugin source) — every other icon in this
   codebase (`Search`, `Upload`, `AlertTriangle`, `GripVertical`, etc.) uses
   the bare boolean `aria-hidden` (no `="true"`) on icon *components* for
   exactly this reason. Fixed by matching that established convention.
   Reran the affected test, desktop lint, then the full desktop suite:
   614/614 clean. Desktop typecheck: clean (no defect there). Rust:
   79/79, `cargo clippy --all-targets`: clean, no warnings. Python: not
   touched this phase, skipped per instructions.

### Release build
`pnpm --filter @ai4s/desktop tauri build` — Vite build + Rust release
compile + WiX/NSIS bundling all succeeded, 0 errors. Rebuilt because the
existing `target/release` artifacts predated this session's
`CandidateComparisonPanel.tsx` fix (a real frontend-output change).
- `apps/desktop/src-tauri/target/release/bundle/msi/FormuLab_0.4.0_x64_en-US.msi`
  — 35,356,672 bytes — sha256
  `A21908257565EE982FAB72E35621A94974726A8A7B6CC1DA6FACDE67B86385AC`
- `apps/desktop/src-tauri/target/release/bundle/nsis/FormuLab_0.4.0_x64-setup.exe`
  — 24,693,477 bytes — sha256
  `AF936CEFF3338714D772BA5D7D03DDF47E375DC26D842E03A3AE02C75EC0BAAB`
  (no prior repo hashing convention found in scripts/CI; used
  `Get-FileHash -Algorithm SHA256`, PowerShell's standard tool)
- `scripts/windows/verify-formulab-phase1.ps1` run against the release exe:
  Launch verified PASS (PID confirmed running), Window verified PASS
  (title "FormuLab", real HWND).

### Native verification — Reverse Formulation
Launched the real packaged release exe (not dev server) against this
repo's actual live app data (`data/` — confirmed real: 3 existing
formulations, populated `data/master/materials.json`, etc.; no
`reverse_formulation_*` collection files existed yet, i.e. Phase 7 had
never been exercised live here before). Confirmed real, on-screen: the
app window renders the landing page; "Reverse Formulation" is present in
the Sidebar nav list (screenshot-verified against actual rendered pixels
of the packaged build). Attempted full interior click-through (open route,
create study, generate/save candidate, convert to formulation) using
Win32 mouse/keyboard automation (the same technique
`docs/TAURI_LIVE_VERIFICATION.md` used for Phase 1). Hit the same
disclosed environment blockers as that prior session, reproduced fresh
this session: the sidebar's `overflow-y-auto` nav list does not respond to
a simulated `mouse_event` wheel scroll; `SetWindowPos`-based workarounds
and Tab/Arrow-key focus traversal proved unreliable for precisely
targeting a specific nav row at this environment's 1280×800 virtual
display; and relaunching with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (to
attempt CDP-based automation instead of coordinates) did not open a
reachable debugging port — the flag does not propagate to the child
WebView2 process here, matching that same prior session's finding for a
different WebView2 launch flag. No further interior click was risked
given the app's active workspace is this repo's own real project data;
confirmed afterward that no `reverse_formulation_*` file was created and
the real formulation count stayed at 3 — nothing was touched. Given this
is a reproduction of an already-disclosed, pre-existing environment
limitation (not a new Phase 7 defect), interior behavior is instead
verified via `ReverseFormulationPage.test.tsx`'s 23 real-component-tree
integration tests (real render, real `userEvent` interactions, only the
Tauri IPC boundary mocked) — covering study creation, candidate
generation/scoring with evidence-confidence shown separately, candidate
save, low-confidence warning, new-draft and new-version conversion,
prior-version immutability, no inherited approval, missing-material
rejection, and a surfaced persistence error. Result: **PARTIALLY LIVE
VERIFIED** (same label this repo already uses for Phase 1), not "LIVE
VERIFIED" and not "NOT VERIFIED" — real native launch and real Sidebar
presence were genuinely confirmed, which is more than launch-only.

### Closure defects fixed
1. `DataExchangePage.test.tsx` stale 24-card assertion → 35 (matches the
   authoritative `DATA_EXCHANGE_TEMPLATES` registry count).
2. `CandidateComparisonPanel.tsx` i18next-lint literal-string violation on
   `aria-hidden="true"` → bare `aria-hidden` (matches the established
   icon-component convention used everywhere else in this codebase).

### Remaining limitations
- Conversion UI is intentionally minimal (unchanged from Session 6).
- No pre-conversion cost/regulatory/laboratory readiness check — by
  design, decision support only.
- Full native interior click-through for Reverse Formulation remains
  environment-blocked pending `tauri-driver`/WebDriver installation, same
  as every other deep-tab checklist in this repo (Approval, Trials,
  Stability). Recommendation for a future pass: install `tauri-driver` +
  matching `msedgedriver.exe`, and/or use a virtual display taller than
  900px, to remove both the coordinate-calibration fragility and the
  content-clipping this session hit again.

### Documentation
Updated `docs/architecture/IMPLEMENTATION_STATUS.md`: added a
"Reverse Formulation (Phase 7)" Done section (Data Exchange Center
template style) and removed the now-obsolete "In progress" table (its one
row, Reverse formulation, is superseded by the new Done section). Rewrote
`docs/handoffs/PHASE7_CURRENT.md` into a 59-line closed-state handoff.

### Commit
chore(reverse-formulation): close phase 7

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).

### Final Phase 7 status
CLOSED.
