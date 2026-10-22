import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDatasetManifest,
  buildFormulaVersionBundleManifest,
  extractFormulaVersionDatasetRows,
  rankAlternatives,
  verifyAlternativeRankingRecord,
  type Formulation,
  type FormulationVersion,
} from "@formulab/shared";
import { SEED_COMPATIBILITY_RULES } from "../../../../packages/shared/src/catalog/compatibilityRules";
import { SEED_REGULATORY_RULES } from "../../../../packages/shared/src/catalog/regulatoryRules";
import { SEED_SAFETY_RULES } from "../../../../packages/shared/src/catalog/safetyRules";

const store = vi.hoisted(() => ({
  formulations: [] as Formulation[],
  versions: [] as FormulationVersion[],
  rankings: [] as unknown[],
}));

vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
    listFormulations: async () => store.formulations,
    readFormulation: async (id: string) => ({
      formulation: store.formulations.find((item) => item.id === id),
      versions: store.versions.filter((item) => item.formulationId === id),
    }),
    saveFormulation: async (item: Formulation) => { store.formulations.push(item); return item; },
    saveFormulationVersion: async (item: FormulationVersion) => { store.versions.push(item); return item; },
  };
});

import { costGeneratedFormula } from "./generatedFormulaCost";
import { evaluateGeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";
import { evaluateGeneratedFormulaRegulatory } from "./generatedFormulaRegulatory";
import { evaluateGeneratedFormulaSafety } from "./generatedFormulaSafety";
import { buildReportHtml } from "./formulationReport";
import type { FormulationCard, SessionDetail } from "./formulationV2";
import { ensureCurrentRankingSnapshot } from "./rankingOptimization";
import { buildAlternativeRankingCandidates } from "./alternativeRanking";
import { ensureRankingPredictionSource } from "./rankingPredictionSource";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const python = process.env.FORMULAB_PYTHON_BIN || "python";
let taskTempRoot: string;
let fixtureServer: Server;
let fixtureFullTextUrl: string;

function researchFixtures(count: number, oaUrl: string) {
  return Array.from({ length: count }, (_, index) => ({
    source_db: "openalex",
    title: `Test fixture ${index + 1} anti-dandruff shampoo surfactant piroctone olamine`,
    year: 2020,
    authors: "Repository acceptance fixture",
    venue: "FormuLab test fixture",
    doi: `10.55555/formulab-fixture-${index + 1}`,
    is_oa: true,
    oa_url: oaUrl,
    cited_by: index,
    concepts: "shampoo",
    abstract: "SYNTHETIC TEST FIXTURE ONLY. Decyl glucoside at 10.0% and Cocamidopropyl betaine at 6.0% are fixture values for deterministic pipeline testing; they are not literature claims or laboratory results.",
  }));
}

function runPython(executable: string, args: string[], options: { cwd: string; input: string; timeout: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, windowsHide: true, env: options.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error(`Python acceptance process timed out after ${options.timeout} ms.`), { code: "ETIMEDOUT" }));
    }, options.timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.end(options.input);
  });
}

async function runActualPipelineFixture(input: { library: string; out: string; brief: Record<string, unknown>; oaUrl: string }) {
  const seedSource = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(join(repositoryRoot, "runtime", "pipeline"))})`,
    "import literature_cache",
    "request = json.loads(sys.stdin.read())",
    "literature_cache.save_index(request['library'], request['papers'])",
  ].join("\n");
  const seedResult = spawnSync(python, ["-c", seedSource], {
    cwd: repositoryRoot,
    input: JSON.stringify({ library: input.library, papers: researchFixtures(120, input.oaUrl) }),
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (seedResult.error) throw seedResult.error;
  if (seedResult.status !== 0) throw new Error(`FormuLab fixture setup exited ${seedResult.status}: ${seedResult.stderr}`);

  const processResult = await runPython(python, [join(repositoryRoot, "runtime", "pipeline", "run_cli.py")], {
    cwd: repositoryRoot,
    input: JSON.stringify({
      brief: input.brief,
      library_dir: input.library,
      formulas_dir: join(dirname(input.out), "formulas"),
      sessions_dir: dirname(input.out),
      materials_dir: join(dirname(input.out), "materials"),
      out_dir: input.out,
      n: 3,
    }),
    timeout: 120_000,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONPATH: undefined,
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      http_proxy: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
  });
  if (processResult.status !== 0) throw new Error(`FormuLab run_cli.py exited ${processResult.status}: ${processResult.stderr}`);
  if (!/cache: 120 relevant candidates from the shared library \(no API needed\)/.test(processResult.stderr)) {
    throw new Error(`The fixture did not satisfy the cached literature pool; refusing live API fallback. stderr=${processResult.stderr}`);
  }
  if (/searching the open APIs/.test(processResult.stderr)) {
    throw new Error(`The fixture unexpectedly attempted external literature discovery. stderr=${processResult.stderr}`);
  }
  try {
    return JSON.parse(processResult.stdout) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`FormuLab pipeline returned invalid JSON: ${String(error)}; stderr=${processResult.stderr}`);
  }
}

describe("FVL-11.002 full-chain acceptance run 1 — synthetic fixture only, no research or physical result claimed", () => {
  beforeEach(async () => {
    store.formulations = [];
    store.versions = [];
    store.rankings = [];
    taskTempRoot = mkdtempSync(join(tmpdir(), "formulab-fvl11-run1-"));
    fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/pdf" });
      response.end("%PDF-1.4\nSYNTHETIC TEST FIXTURE ONLY. No literature, lab, or product result.\n%%EOF\n");
    });
    await new Promise<void>((resolve, reject) => {
      fixtureServer.once("error", reject);
      fixtureServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = fixtureServer.address();
    if (!address || typeof address === "string") throw new Error("Synthetic fixture server did not bind to a TCP port.");
    fixtureFullTextUrl = `http://127.0.0.1:${address.port}/synthetic-fixture.pdf`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => fixtureServer.close((error) => error ? reject(error) : resolve()));
    rmSync(taskTempRoot, { recursive: true, force: true });
  });

  it("carries the deterministic research/generation session through immutable version, canonical engines, dataset snapshot, ranking, lineage and report", async () => {
    const sessionDir = join(taskTempRoot, "session");
    const result = await runActualPipelineFixture({
      library: join(taskTempRoot, "library"),
      out: sessionDir,
      oaUrl: fixtureFullTextUrl,
      brief: {
        target: "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
        category: "HC-SHAMPOO-REG",
        market: "Kenya",
        targetPhMin: "5.0",
        targetPhMax: "5.5",
      },
    });
    expect(result.status).toBe("ok");
    const cards = result.cards as FormulationCard[];
    expect(cards).toHaveLength(3);
    const card = cards[0]!;
    expect(card.formula).toBeTruthy();
    expect(card.manufacturing?.ready).toBe(true);
    // `full` here only exercises the pipeline's file-count gate with local fixture bytes;
    // the fixture DOI, abstract, and PDF payload are all explicitly synthetic.
    expect(card.research_corpus).toMatchObject({ status: "full", full_text_count: 15 });

    const papers = JSON.parse(readFileSync(join(sessionDir, "literature", "papers.json"), "utf8")) as SessionDetail["literature"];
    expect(papers).toHaveLength(15);
    expect(papers.every((paper) => paper.doi?.startsWith("10.55555/formulab-fixture-") && paper.abstract?.includes("SYNTHETIC TEST FIXTURE ONLY"))).toBe(true);
    const session = {
      status: "ok",
      id: "FVL11-RUN1-REPOSITORY-FIXTURE",
      brief: {
        target: "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
        category: "HC-SHAMPOO-REG",
        market: "Kenya",
        targetPhMin: "5.0",
        targetPhMax: "5.5",
      },
      cards,
      literature: papers,
      scientific_formulations: { formulations: [], outcomes: [], summary: null },
      read_only: true,
    } as unknown as SessionDetail;

    const source = await ensureRankingPredictionSource({ session, card, batchKg: "100", materials: [] });
    expect(store.formulations).toHaveLength(1);
    expect(store.versions).toHaveLength(1);
    expect(source.formulation.productFamilyCode).toBe("HC-SHAMPOO-REG");
    expect(source.version).toMatchObject({
      formulationId: source.formulation.id,
      status: "concept",
      approvalRecordIds: [],
      generatedSource: { sessionId: session.id, alternativeId: card.version },
    });

    const cost = costGeneratedFormula(session.id, card.version, card.formula, "100", "KES", { materials: [], prices: [], rates: [] });
    expect(cost.missingDataWarnings.length).toBeGreaterThan(0);
    const compatibility = evaluateGeneratedFormulaCompatibility(card.formula, [], SEED_COMPATIBILITY_RULES);
    const safety = evaluateGeneratedFormulaSafety(card.formula, [], SEED_SAFETY_RULES);
    const regulatory = evaluateGeneratedFormulaRegulatory(card.formula, [], SEED_REGULATORY_RULES, { market: "Kenya" });
    // Seed catalogs can produce real warnings, but unresolved material identity
    // must remain visible and can never be reported as a clean result.
    expect(compatibility.formulaState).not.toBe("compatible");
    expect(compatibility.unresolvedMaterialCount).toBeGreaterThan(0);
    expect(safety.formulaState).not.toBe("safe");
    expect(safety.unresolvedMaterialCount).toBeGreaterThan(0);
    expect(regulatory.formulaState).not.toBe("compliant");
    expect(regulatory.unresolvedMaterialCount).toBeGreaterThan(0);

    const compositionRows = extractFormulaVersionDatasetRows({
      formulationVersionIds: [source.version.id],
      formulationVersions: [source.version],
      formulations: [source.formulation],
      materials: [],
    });
    const bundle = await buildFormulaVersionBundleManifest({ compositionRow: compositionRows[0]! });
    const dataset = await buildDatasetManifest([bundle]);
    expect(dataset.entries).toEqual([expect.objectContaining({ formulaVersionId: source.version.id })]);
    expect(dataset.dataset.digest).toMatch(/^[a-f0-9]{64}$/);

    const [candidate] = await buildAlternativeRankingCandidates({
      sessionId: session.id,
      cards: [card],
      costSnapshots: [cost],
      availability: [undefined],
      compatibility: [compatibility],
      safety: [safety],
      regulatory: [regulatory],
      sourceFormulationVersionIds: new Map([[card.version, source.version.id]]),
    });
    expect(candidate).toMatchObject({
      sourceFormulationVersionId: source.version.id,
      dimensions: {
        performance: { status: "UNAVAILABLE_MODEL" },
        compatibility: { status: "WARNING" },
        safety: { status: "WARNING" },
        regulatory: { status: "WARNING" },
      },
    });
    const rankings = rankAlternatives([candidate!]);
    const ranking = await ensureCurrentRankingSnapshot({
      sessionId: session.id,
      context: { batchKg: "100", currency: "KES" },
      rankings,
      existingRecords: [],
      createCode: () => "FVL11-RUN1-RANK-001",
      now: () => "2026-10-22T00:00:00.000Z",
      append: async (item) => { store.rankings.push(item); },
      readBack: async () => store.rankings,
    });
    expect(await verifyAlternativeRankingRecord(ranking)).toBe(true);
    expect(ranking.rankings[0]?.candidate).toMatchObject({ sourceFormulationVersionId: source.version.id });

    const report = buildReportHtml(session, session.id, { [card.version]: safety }, { [card.version]: regulatory }, { [card.version]: compatibility });
    expect(report).toContain("Evidence &amp; Sources");
    expect(report).toContain("a sulfate-free anti-dandruff shampoo for a sensitive scalp");
    expect(report).toContain("Safety — Overall: warning");
    expect(report).toContain("Regulatory — Market: KE, Overall: warning");
    expect(report).toContain("Research Corpus Status:");
  });
});
