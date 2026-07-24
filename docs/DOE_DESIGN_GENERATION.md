# DOE design generation (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeDesignSchema`,
`DOE_DESIGN_TYPES`, `DOE_IMPLEMENTED_DESIGN_TYPES`),
`packages/shared/src/engine/doeDesign.ts` (every generator,
`calculateDesignDiagnostics`, `randomizeDoeRuns`, `generateDoeDesign`).

## Implemented vs. named-but-refused

`DOE_DESIGN_TYPES` (11) names every design type the domain model can
record, so a study can express intent even for a design not yet buildable.
`DOE_IMPLEMENTED_DESIGN_TYPES` (9) is exactly what `generateDoeDesign`
actually builds:

| Design type | Generator | Notes |
|---|---|---|
| `full_factorial` | `generateFullFactorialDesign` | Every combination of every factor's levels (2 for continuous, N for categorical). |
| `two_level_factorial` | `generateTwoLevelFactorialDesign` | Same construction, explicit 2-level semantics. |
| `fractional_factorial` | `generateFractionalFactorialDesign` | 2^(k-1) half-fraction only (generator = product of all base-factor signs). Quarter-fractions refused with an explicit error. |
| `plackett_burman` | `generatePlackettBurmanDesign` | N=8 (up to 7 factors) and N=12 (up to 11 factors) only, via the classic published generator rows. Larger screens refused. |
| `central_composite` | `generateCentralCompositeDesign` | 2^k factorial + 2k axial points (rotatable alpha by default) + center points. |
| `box_behnken` | `generateBoxBehnkenDesign` | General k-factor pair construction (every factor pair at all 4 sign combinations, others at center), k >= 3. |
| `latin_hypercube` | `generateLatinHypercubeDesign` | Stratified sampling + seeded jitter, reproducible from the seed. |
| `mixture_simplex_lattice` | `generateMixtureSimplexLatticeDesign` | {q,m} lattice — every composition of degree `m` into `q` mixture components, verified to sum to exactly 1. |
| `custom_manual` | `generateManualDesign` | Freezes exactly the rows a human supplies — no generation logic. |

`definitive_screening` and `mixture_simplex_centroid` are real enum values
(a study can record the *intent*) but `generateDoeDesign` refuses them with
an explicit "not implemented" error — never a fake design silently
mislabeled as one of these types.

## Seeded, reproducible randomization

`createSeededRandom(seed)` is a small mulberry32 PRNG. Every randomization
and sampling call in this module — `randomizeDoeRuns`, Latin-hypercube
stratum jitter, the mixture-space candidate search in
[DOE_CANDIDATES.md](DOE_CANDIDATES.md) — is a pure function of `(seed,
inputs)`: the same seed always reproduces the same run order or sample.
`DoeDesign.seed` is stored precisely so a design's randomization can be
reproduced later, e.g. to confirm a printed run sheet matches what the
system would generate again.

## Diagnostics, honestly computed

`calculateDesignDiagnostics` never returns a fabricated "optimality" score.
It returns real, computed facts about the generated runs:

- `runCount`, `degreesOfFreedom` (run count minus estimable-term count)
- `duplicateRunCount` — identical non-center-point runs
- `estimableTerms`/`aliasedTerms`
- `isOrthogonal` — every pair of coded columns has zero pairwise dot
  product (a real, checked property, not a claim of formal D/G-optimality)
- `isBalanced` — every factor level appears an equal number of times
- `conditionNumber` — of `X'X` for the coded design matrix, via
  `doeMath.conditionNumber`; `undefined` (never a fabricated number) when
  the matrix is singular
- `centerPointCount`, `replicateCount`, `constraintViolationCount`
- `warnings` — e.g. "no center points", a poorly-conditioned matrix, or a
  hard-constraint violation

## Refuse-before-persist

`generateDoeDesign` is the single entry point every design type goes
through. It validates factors/constraints/responses, refuses an
unimplemented design type, and refuses (via `validateGeneratedDesign`) a
generated design where any run violates a hard constraint — **nothing is
persisted until every check passes.** Only after that does it randomize
(seeded) and assign standard order, randomized order, block, and replicate
numbers to each run.

## Status

Implemented, tested (`doeDesign.test.ts`, 56 tests covering every
generator's run count and structural properties, randomization
reproducibility, diagnostics, and hard-constraint rejection), live-usable
through the study-creation wizard's Design Type / Generation Settings /
Preview steps.
