# FVL-11.001 — Product-family acceptance matrix

Status: acceptance plan; not a claim that a physical batch or a full-chain run has passed.

The selected families are grounded in the current product catalog and structural templates. FVL-11.002 and FVL-11.003 must produce executable chain evidence; this matrix does not substitute for those runs. Repository-owned unit fixtures prove individual contracts only, not a cross-product end-to-end workflow.

## Selected families

| Family | Shape and composition | Process distinction | Safety / regulatory distinction | Family-specific measurement focus |
|---|---|---|---|---|
| `HC-SHAMPOO-REG` — Regular shampoo | Aqueous personal-care surfactant system with preservative, pH adjustment, and INCI requirements. | Liquid phase, surfactant addition, then pH/rheology adjustment. | Personal-care exposure and applicable claims; canonical safety and regulatory engines remain authoritative. | pH, viscosity, active matter, density, odour, microbiological limits. |
| `SK-MOISTURIZER` — Moisturizing cream | Emulsion structure with emollient, water, preservative, and rheology modifier. | Separate heated water and oil phases, emulsification, then cooldown. | Personal-care exposure; emulsion preservation and stability are explicit evidence requirements. | Emulsion stability and centrifuge test, in addition to care specification fields. |
| `BL-REGULAR` — Hypochlorite bleach | Aqueous oxidizing system with bleaching agent and alkaline pH control. | Water phase, hypochlorite addition, then stabilization; pH must remain alkaline. | Catalog hazard class is `industrial`; acid/amine hard compatibility and safety exclusions apply. Seed regulatory rules remain unverified draft placeholders and cannot be treated as a verified family-specific regulatory classification. | Available chlorine, free alkali, density, appearance, and stability at 40 °C. |

These are not cosmetic variants: they cover a surfactant liquid, a heated emulsion with centrifuge/stability tests, and a hazardous oxidizing cleaner with a hard alkaline-process and compatibility gate. Templates provide structural roles and process phases, not percentages or approved formulae. No physical laboratory outcome is asserted.

## Cross-domain acceptance map

`Exercise` means a downstream run must exercise a shared production contract with exact family identity. `Family-specific` means the run must preserve and check the named difference. `Fixture only` means deterministic repository fixtures may be used, but must be labelled as fixtures and not described as physical validation. These entries define coverage intent; none claims completed FVL-11.002/.003 acceptance.

| Acceptance area | `HC-SHAMPOO-REG` | `SK-MOISTURIZER` | `BL-REGULAR` |
|---|---|---|---|
| Requirement parsing | Test exact family brief; only count supported fields as parsed. | Test emulsion/process language; unsupported terms must remain unresolved rather than being silently accepted. | Explicitly supplied oxidizer/alkalinity/hazard constraints must be preserved, or unsupported terms must remain in `unresolved_requirements` and block/flag the run. Do not infer successful parsing from the family template. |
| Formulation generation | Exercise deterministic generation with family identity; do not claim template values are a formula. | Exercise emollient/emulsion roles; do not infer percentages from template. | Exercise hypochlorite roles and hard exclusions; do not invent a safe formula. |
| Cost | Exercise canonical Cost Engine and preserve its material/cost provenance. | Exercise canonical Cost Engine for the emulsion role mix. | Exercise canonical Cost Engine only where actual input cost data exists. |
| Compatibility | Exercise canonical Compatibility Engine for relevant ingredient pairs. | Exercise canonical engine for emulsion ingredients and packaging when evidence exists. | Family-specific: acid + hypochlorite incompatibility and packaging findings must fail closed. |
| Safety | Exercise authoritative Safety Engine for personal-care exposure and declared claims. | Exercise authoritative Safety Engine for product and claim inputs. | Family-specific: hazardous classification and acid/amine incompatibilities must not be outweighed. |
| Regulatory | Exercise canonical Regulatory Engine for market, family, and claims; preserve unverified status. | Exercise canonical Regulatory Engine for market and cosmetic claims; preserve unverified status. | Evaluate only configured rule records and preserve their unverified/draft state; do not claim an established family classification or regulatory approval. |
| Laboratory | Check family-specific test applicability and trial lineage; fixture-only measurements if needed. | Check emulsion stability/centrifuge applicability and trial lineage; measurements remain unknown absent evidence. | Check available-chlorine/free-alkali applicability and trial lineage; no fixture may imply a real result. |
| DOE / recommendation | Exercise shared recommendation lifecycle and human-selection gate; no automatic trial. | Exercise shared lifecycle with emulsion-relevant DOE dimensions where supported. | Exercise only safe, eligible DOE dimensions; hard safety failure excludes a candidate. |
| Dataset / model | Exact family and target scope; use only eligible measured records. | Exact family and target scope; no cross-family transfer. | Exact family and target scope; no cross-family transfer or unsafe trial data. |
| Prediction / ranking | Exact model/formula-version lineage; prediction remains advisory. | Exact family-scoped model and dimension-level ranking; unavailable evidence stays unknown. | Exact family-scoped model; hard Safety/Regulatory failures cannot be outweighed. |
| Lineage / audit | Preserve exact formula-version → trial/result → dataset/model → prediction/recommendation IDs. | Preserve the same exact-ID chain; downstream records never rewrite earlier records. | Preserve exact IDs and exclusion/review evidence without implying approval. |
| Export / report | Exercise export with family identity, evidence status, and provenance. | Exercise export with emulsion/process context and evidence status. | Exercise export with hazard, process, exclusions, and evidence status. |

## Repository evidence and limits

- Family roles, process phases, and test focus: `packages/shared/src/catalog/templates.ts` (`HC-SHAMPOO-REG`, `SK-MOISTURIZER`, `BL-REGULAR`).
- Family code and hazard classifications: `packages/shared/src/catalog/kenya.ts` and `packages/shared/src/catalog/kenya.test.ts`.
- Seeded regulatory-rule status: `packages/shared/src/catalog/regulatoryRules.ts` marks these records as unverified draft placeholders requiring qualified review.
- Deterministic requirement parsing: `runtime/pipeline/engine.py::parse_requirements` and `resolve_role_requirements`, covered by `runtime/pipeline/test_engine.py` and `runtime/pipeline/test_pipeline.py`. Desktop formulation generation is the direct Tauri command `apps/desktop/src-tauri/src/formulation_v2.rs::generate_formulation`; these are distinct paths and must not be conflated.
- Family-specific hard-gate tests: `packages/shared/src/engine/compatibility.test.ts`, `safety.test.ts`, and `builder.test.ts` cover acid/hypochlorite incompatibility and bleach review/warnings.
- Other modular coverage relevant to the planned chain: `packages/shared/src/engine/testApplicability.test.ts`, `predictivePerformance.test.ts`, `doeCandidates.test.ts`, `laboratoryLineage.test.ts`, `labExports.test.ts`, and `doeExports.test.ts`; `apps/desktop/src/lib/rankingOptimization.test.ts` and `formulationReport.test.ts`.
- Existing shampoo and surface-cleaner optimizer examples (`examples/shampoo-formulation/README.md`, `examples/surface-cleaner/README.md`) explicitly describe cost-only models requiring bench validation. They are not complete formulation fixtures and are not physical or full-chain acceptance evidence.
- Existing modular tests do not prove a single full-chain run across these families. FVL-11.002/.003 must use real production-facing workflows and capture exact record identifiers; report any unsupported link rather than substituting disconnected helpers.

## Acceptance limits

- Synthetic or repository-owned records must be labelled as fixtures; missing measurements remain unknown.
- Do not create or present actual measured lab results, stability/challenge/ocular/efficacy data, regulatory approval, claim substantiation, or accepted model evidence as if supplied by a human or bench.
- Templates are structural only, not formula recommendations, regulatory approvals, or physical test results.
- The FVL-11 master prompt still cites 171 tasks; current canonical `TASKS.md` has 178 unique tasks after DEVX tasks were added. Continue using counts derived from canonical `TASKS.md`; do not overwrite them with the stale prompt total.
