# Current State Audit

Audit of the FormuLab repository as it exists at the start of the Kenya R&D
platform transformation. Written from inspection of the working tree, not from
the README's claims about it.

## Scale

| Area | Files |
|---|---|
| TypeScript / TSX (apps + packages) | 173 |
| Rust (`apps/desktop/src-tauri/src`) | 22 |
| Python (`runtime/`) | 85 |
| Test files | 73 |

Workspace layout is a pnpm monorepo: `apps/desktop` (Tauri 2 + React + TS),
`packages/shared` (types), `packages/ui`, `runtime/` (Python pipeline + skills).

## Application architecture today

**Desktop shell** — Tauri 2. Rust owns the filesystem, process spawning, the
Python bridge, and the local Jupyter/kernel integration. React owns the UI.
There is no server; everything is local-first.

**Routes** — `/live` (formulation workspace), `/live/:sessionId` (a saved run,
read-only), `/example/:sessionId`, `/notebooks`, `/optimizer`, `/files`,
`/runs`, `/settings`. The workspace is the product; the rest are inherited
from the AI4S workbench.

**Formulation pipeline** (`runtime/pipeline/`) — a direct request/response
chain, not an agent loop:

```
brief → safety gate → deterministic rules → literature retrieval →
ONE LLM call → validation → N formulation cards
```

Modules: `pipeline.py` (orchestrator), `rules.py` (deterministic constraint
derivation), `region_profiles.py` (market → water hardness/climate),
`literature_cache.py` (shared paper cache + retrieval), `fulltext.py` (JATS/PDF
reading), `llm.py` (multi-provider client), `materials.py` (raw materials +
costing), `run_cli.py` / `materials_cli.py` (stdin/stdout bridges).

**Retrieval** — OpenAlex, OpenAIRE, Europe PMC, Crossref, all filtered to open
access. A candidate pool is searched until 15 papers whose full text can be
downloaded are found; only those are recorded. Full texts are stored as
Markdown and read into the prompt.

**Agent runtime** — REMOVED. The OpenCode sidecar, its SSE stream, session
store, projects and skills UI were deleted earlier in this project's history.
Generation is now a single Tauri command (`generate_formulation`) that runs
Python and returns JSON. `cargo check` is clean.

## Persistence today

Local files, no database (`.FormuLab/runs.db` is a legacy SQLite file from the
inherited workbench's run index).

```
<project>/data/sessions/<YYYY-MM-DD-HHMM>-<slug>/   cards, brief.json, literature/
<project>/data/literature/{index.json, pdfs/}       shared cache
<project>/data/materials.json                       imported raw materials
<project>/formulas/                                 flat library of every card
```

There is **no schema versioning and no migration mechanism**. `materials.json`
carries a `schema_version` field; nothing else does.

## Schemas and types

`packages/shared/src/index.ts` holds 46 exported types, inherited from the
workbench (thread blocks, artifacts, runs, projects). They describe the old
agent UI, not formulation domain objects.

Python has no formal schema layer — dicts with documented shapes. There are no
Zod validators and no Pydantic models. TypeScript, Python and Rust each
describe the same payloads independently; they are kept in sync by hand.

## What is genuinely working

- Evidence-driven discovery with open-access-only retrieval
- Full-text reading (JATS XML → Markdown, PDF via zlib)
- Citation verification against retrieved metadata (author/year corrected from
  our own records; unsupplied DOIs dropped)
- Deterministic rules engine (sulfate/sensitive-skin exclusions, hard-water
  chelator requirements, builder requirements)
- Region profiles (Kenya, EU, US, Türkiye, Africa)
- Safety gate refusing prohibited classes
- Raw-material import (English + Turkish headers, both decimal conventions)
- Costing from the customer's own prices, with explicit unmatched/unpriced
  reporting and a coverage percentage
- Multi-card output (v1..vN), printing via the OS dialog
- PuLP-based cost optimizer (`runtime/formulation/formulation_core.py`)

## Gaps against the target specification

**Structured state.** Card completion and rendering are driven by Markdown.
`isCard()` matched a `# Formulation Card` heading; the current workspace renders
`card.markdown`. There is no persisted structured formulation object, no
version graph, and no event protocol. This is the single largest gap.

**No product catalog.** No product families, no packaging SKUs, no separation
between formulation and packaging. Nothing scoped to Kenya.

**Optimizer breadth.** The PuLP core handles batch size, minimum active matter,
stock and max usage. It has no functional-group, ratio, conditional,
regulatory or compatibility constraints, no multi-objective support, and
returns a bare `infeasible` with no structured cause.

**No engines** for regulatory rules, chemical compatibility, or structured
safety classification. Safety is a keyword gate in `pipeline.py`.

**No versioning**, comparison, manufacturing methods, lab trials, stability
studies, DOE, substitution, or reverse formulation.

**Evidence model is flat.** Sources are recorded and citations verified, but
there is no origin classification (`reported_exact` vs `model_estimate` etc.)
and no support-dimension distinction. Every percentage the model emits is
presented the same way regardless of whether a source supports it.

**Cost model is single-layer.** Raw-material cost only: no landed cost, no
packaging, no factory overhead, no currency table, no SKU fill cost.

**Precision.** Python uses binary floats throughout. There is no decimal policy
for percentages, quantities or money.

**Identity.** The crate is `ai4s-workbench`, packages are `@ai4s/*`, and the
built binary is `ai4s-workbench.exe`. Installers are already branded FormuLab.

**Testing.** 73 test files, concentrated in the frontend and the Python
pipeline. No property-based tests, no migration tests, no golden evaluation
set, no optimizer invariant tests.

**CI.** One workflow (`build.yml`). No lint/typecheck/test matrix, no Rust
checks, no schema validation, no secret scanning, no SBOM.

**Security.** No threat model document. Retrieved literature is fed to the model
without an explicit trust boundary marker, and CSV export does not sanitise
cells that a spreadsheet would execute as formulas.

## Security boundaries that do exist

- Tauri command allow-list; the webview cannot reach the filesystem directly
- `artifact_file.rs` resolves every path under a scope root and rejects escapes
- API keys live in `localStorage` per provider and are passed per request; they
  are never written to the project folder
- `.env.local`, `/data/`, `/formulas/` are gitignored
- Paywalled content is never downloaded; publisher bot-blocks are not evaded
