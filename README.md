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
- **Formulation Discovery** — give a target product ("an anti-dandruff, soothing
  shampoo") and the agent retrieves open-access literature (OpenAlex), extracts
  the ingredients/functions/concentrations reported there, synthesizes an
  evidence-based candidate formula with citations, and hands it to the optimizer.

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
