<div align="center">

# FormuLab

**Local-first AI research workbench with chemical formulation discovery and cost optimization.**

Built with Tauri, MCP, and agent skills — for macOS, Windows & Linux.

</div>

---

## What it is

FormuLab is a desktop workbench that pairs a general AI research environment
(agents, notebooks, files, figures, runs, provenance) with a purpose-built
**chemical formulation toolkit**:

- **Formulation Optimizer** — a linear program (PuLP + CBC) that finds the
  lowest-cost raw-material mix meeting an active-content target within stock and
  usage limits. Available as a UI tab *and* an agent skill.
- **Advanced Formulation Constraint Optimizer** — a separate, mixed-integer
  solver over composition, functional-group, ratio and conditional
  constraints, genuine soft-constraint penalty relaxation, calculated
  property targets, a cost ceiling, multi-objective (weighted or
  lexicographic) including graded compatibility/safety risk, structured
  infeasibility explanations, and automatic exclusion of any material
  combination the real compatibility/safety engines flag as blocking.
  Named, comparable optimization scenarios (save/clone/rename/retire,
  product-family profile application, run comparison) build on top of it.
  See [docs/ADVANCED_OPTIMIZER.md](docs/ADVANCED_OPTIMIZER.md) and
  [docs/OPTIMIZATION_SCENARIOS.md](docs/OPTIMIZATION_SCENARIOS.md).
- **Material Substitution** — deterministic, scored candidate ranking for
  replacing one raw material with another, using real price/stock/supplier
  data and a live compatibility/safety re-check, never name similarity —
  plus multi-material system substitution (one/many-to-many, routed through
  the real optimizer). See
  [docs/MATERIAL_SUBSTITUTION.md](docs/MATERIAL_SUBSTITUTION.md) and
  [docs/SYSTEM_SUBSTITUTION.md](docs/SYSTEM_SUBSTITUTION.md).
- **Formulation Discovery** — give a target product ("an anti-dandruff, soothing
  shampoo") and the agent retrieves open-access literature (OpenAlex), extracts
  the ingredients/functions/concentrations reported there, synthesizes an
  evidence-based candidate formula with citations, and hands it to the optimizer.
- **Formula Builder** — the daily working surface: a versioned formulation
  workspace with an editable grid, water q.s., deterministic decimal arithmetic,
  validation, immutable versions and version comparison.
- **Compatibility and safety engines** — deterministic, versioned rule
  checking (never the LLM) with human-review-gated approval; see
  [docs/COMPATIBILITY_ENGINE.md](docs/COMPATIBILITY_ENGINE.md) and
  [docs/SAFETY_ENGINE.md](docs/SAFETY_ENGINE.md).
- **Raw materials and costing** — material master, suppliers, append-only price
  history, inventory, landed cost, packaging BOMs and per-SKU cost snapshots.

Everything runs locally by default; your data, runs, and provenance stay on your
machine.

## Features

- **Chat + Agents** — local/API models, tools, MCP, files, shell, skills, memory.
- **Formulation Optimizer** — cost-minimal blending under active-content, stock,
  and max-usage constraints.
- **Formulation Discovery** — literature-driven candidate formulas with citations.
- **Notebooks** — real `.ipynb`, local Python/R kernels, managed Jupyter via `uv`.
- **Runs & Provenance** — append-only run logs and artifact lineage.
- **Deep Research** — multi-step web research with source reading and reports.
- **Formula Builder & versioning** — editable formulation grid, water q.s.,
  exact decimal arithmetic, four-level validation, immutable versions with
  required change reasons, and field-level version comparison.
- **Materials & cost engine** — raw-material master data, suppliers, price
  history, inventory, exchange rates you control, landed cost, packaging BOMs,
  factory cost profiles and immutable cost snapshots.

### Two rules the formulation side is built around

**Missing data is never zero.** A material with no recorded active matter, a
line with no price, a currency pair with no rate — each is reported as what it
is, and any total over it is labelled a lower bound. A silently-zero value looks
complete and is wrong in the cheap direction.

**No automated actor can approve a formula.** Agents, system processes and
imports are all refused `pilot_approved` and `production_approved`, whatever a
model concluded and whatever a spreadsheet claims. Approval is a named person
accepting responsibility, with a signed record and an audit entry.

## Formulation documentation

| Document | Covers |
| --- | --- |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | End-to-end walkthrough: project → grid → version → materials → cost |
| [FORMULA_BUILDER.md](docs/FORMULA_BUILDER.md) | Project workflow, the grid, water q.s., validation, templates, declarations |
| [FORMULA_VERSIONING.md](docs/FORMULA_VERSIONING.md) | Draft vs version, comparison, approval rules |
| [RAW_MATERIALS.md](docs/RAW_MATERIALS.md) | Material master, suppliers, price history, inventory |
| [COST_ENGINE.md](docs/COST_ENGINE.md) | Cost layers, landed cost, SKU costing, snapshots |
| [IMPORT_EXPORT.md](docs/IMPORT_EXPORT.md) | CSV formats, validation, injection handling |
| [PRECISION_POLICY.md](docs/PRECISION_POLICY.md) | Decimal handling and rounding |
| [IMPLEMENTATION_STATUS.md](docs/architecture/IMPLEMENTATION_STATUS.md) | What is actually built, and what is not |

## Formulation quick start

Optimize a blend from a materials CSV or JSON:

```bash
# CSV: name,unit_price,stock,active_matter_pct,max_usage_pct
python runtime/skills/core/formulation-optimizer/optimize.py \
  --materials materials.csv --batch 1000 --min-active 40
```

Discover a formula from the literature (open access only):

```bash
python runtime/skills/core/formulation-discovery/discover.py \
  "antidandruff shampoo formulation" --max 40 --pdfs
```

> Candidates are **evidence-based proposals, not validated recipes**. Bench
> validation and regional regulatory review are required before any use. The
> discovery skill refuses hazardous/illicit targets by design.

## Build from source

Prerequisites: Node.js >= 20, pnpm 9, Rust toolchain, and the Tauri system
dependencies for your OS.

```bash
git clone https://github.com/Sekiph82/FormuLab
cd FormuLab
pnpm install

# Fetch pinned sidecars and bundled skills (git-ignored).
bash scripts/dev/fetch-opencode.sh
bash scripts/dev/fetch-uv.sh
bash scripts/dev/fetch-skills.sh
bash scripts/dev/fetch-goal-plugin.sh

# Run in development or build installers.
pnpm --filter @ai4s/desktop tauri dev
pnpm --filter @ai4s/desktop tauri build
```

Checks: `pnpm test` - `pnpm typecheck` - `pnpm lint`.

## Safety and privacy

- Workspace files, raw data, session history, provenance, and runs stay local by
  default.
- Command execution, file deletion, dependency installation, and remote
  connections are human-approved flows in the app.
- Provider credentials are written to app-private runtime config, never to the
  workspace, provenance, git, or exports.

## License

MIT — see [LICENSE](LICENSE). FormuLab builds on an open-source, MIT-licensed
research-workbench foundation; that copyright notice is retained in `LICENSE`.
