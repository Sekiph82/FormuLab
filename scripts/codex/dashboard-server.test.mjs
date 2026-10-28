import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { afterEach, test } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardServer, readWorkflowJobs } from "./dashboard-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const openServers = new Set();
const fixtureRoots = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map((server) => server.close()));
  openServers.clear();
  await Promise.all([...fixtureRoots].map((path) => rm(path, { recursive: true, force: true })));
  fixtureRoots.clear();
});

async function makeJobFixtureRoot() {
  const root = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-jobs-test-"));
  fixtureRoots.add(root);
  await mkdir(join(root, "project-control/codex/jobs"), { recursive: true });
  return root;
}

function rootPath() {
  return root;
}

async function startServer({ projectRoot = root, projectList, threads = [] } = {}) {
  projectList ??= { rows: [{ id: "formulab-project", name: "FormuLab", roots: [{ path: projectRoot }] }], truncated: false };
  const app = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    clientFactory: () => ({
      async initialize() {},
      async listProjects() {
        if (projectList instanceof Error) throw projectList;
        return projectList;
      },
      async listThreads() {
        return { rows: threads, truncated: false };
      },
      async close() {},
    }),
  });
  await app.listen();
  openServers.add(app);
  return { app, baseUrl: `http://127.0.0.1:${app.server.address().port}` };
}

test("serves a read-only overview grouped by saved Codex project", async () => {
  const match3Root = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-match3-test-"));
  fixtureRoots.add(match3Root);
  await mkdir(join(match3Root, "project-control/codex/jobs/active"), { recursive: true });
  await writeFile(join(match3Root, "TASKS.md"), "# Match3\n\n## Project Status\n- Current Milestone: M14\n- Current Sprint: M14-S01\n- Current Task: LFX-M14-004 — Synthetic test task\n- Current Task Status: IN_PROGRESS\n- Next Task: LFX-M14-005 — Next test task\n", "utf8");
  await writeFile(join(match3Root, "project-control/codex/jobs/active/job.json"), JSON.stringify({
    id: "LFX-M14-004", task: "Synthetic test task", stage: "BUILD", round: 1, reviews: { rules: "pending", code: "pending", tests: "pending" },
  }), "utf8");
  const { baseUrl } = await startServer({
    projectRoot: root,
    projectList: {
      rows: [
        { id: "project-1", name: "Project Alpha", roots: [{ path: root }] },
        { id: "project-2", name: "Project Beta", roots: [{ path: match3Root }] },
      ],
      truncated: false,
    },
    threads: [{
      id: "thread-1",
      preview: "FVL-11 acceptance",
      cwd: root,
      status: { type: "idle" },
      updatedAt: 1_800_000_000,
      projectId: "project-1",
    }],
  });

  const response = await fetch(`${baseUrl}/api/overview`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projectCount, 2);
  assert.equal(payload.activeThreadCount, 1);
  const formulab = payload.projects.find((project) => project.id === "project-1");
  assert.equal(formulab.name, "Project Alpha");
  assert.equal(formulab.threads[0].title, "FVL-11 acceptance");
  const trackerSource = await readFile(join(root, "TASKS.md"), "utf8");
  const currentTask = trackerSource.match(/^- Current Task: ([A-Z0-9-]+(?:\.\d+)?) — (.+)$/m);
  assert.deepEqual(formulab.task.currentTask, currentTask ? { id: currentTask[1], title: currentTask[2] } : null);
  assert.equal(formulab.task.currentTaskStatus, trackerSource.match(/^- Current Task Status: (.+)$/m)?.[1] ?? null);
  assert.equal(formulab.task.completion, trackerSource.match(/^- Completion: (.+)$/m)?.[1] ?? null);
  assert.equal(formulab.jobs.some((job) => job.id === "DEVX-01.003" && job.stage === "MERGED"), true);
  assert.equal(formulab.jobs.find((job) => job.id === "DEVX-01.003").reviews.rules, "pending");
  const match3 = payload.projects.find((project) => project.id === "project-2");
  assert.equal(match3.workflowState, "available");
  assert.equal(match3.task.currentTask.id, "LFX-M14-004");
  assert.equal(match3.jobs.some((job) => job.id === "LFX-M14-004"), true);
});

test("returns a safe unsupported notice without reading Codex storage directly", async () => {
  const unsupported = new Error("Method not found: project/list");
  unsupported.code = -32601;
  const { baseUrl } = await startServer({
    projectList: unsupported,
    threads: [{ id: "thread-2", title: "No saved project", cwd: "C:\\other", status: "idle" }],
  });

  const response = await fetch(`${baseUrl}/api/overview`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projectListState, "unsupported");
  assert.equal(payload.projectCount, 1);
  assert.equal(payload.projects[0].name, "other");
  assert.equal(payload.projects[0].workflowState, "unavailable");
  assert.equal(payload.projects[0].threads[0].id, "thread-2");
});

test("recreates the App Server client after a transient listing failure", async () => {
  let clientCount = 0;
  let firstClientClosed = false;
  const app = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    clientFactory: () => {
      clientCount += 1;
      const isFirstClient = clientCount === 1;
      return {
        async initialize() {},
        async listProjects() {
          return { rows: [{ id: "project-1", name: "PackLab", roots: [{ path: "C:\\work\\PackLab" }] }], truncated: false };
        },
        async listThreads() {
          if (isFirstClient) throw new Error("Codex App Server exited.");
          return { rows: [{ id: "recovered-thread", title: "Recovered", cwd: "C:\\work\\PackLab", status: "idle", projectId: "project-1" }], truncated: false };
        },
        async close() {
          if (isFirstClient) firstClientClosed = true;
        },
      };
    },
  });
  await app.listen();
  openServers.add(app);
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  const failedResponse = await fetch(`${baseUrl}/api/overview`);
  assert.equal(failedResponse.status, 503);
  assert.equal(firstClientClosed, true);

  const recoveredResponse = await fetch(`${baseUrl}/api/overview`);
  assert.equal(recoveredResponse.status, 200);
  const payload = await recoveredResponse.json();
  assert.equal(clientCount, 2);
  assert.equal(payload.activeThreadCount, 1);
  assert.equal(payload.projects[0].threads[0].id, "recovered-thread");
});

test("serves local assets and rejects writes and foreign Host headers", async () => {
  const { baseUrl } = await startServer();
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Selected projects/);

  const write = await fetch(`${baseUrl}/api/overview`, { method: "POST" });
  assert.equal(write.status, 405);

  const address = new URL(baseUrl);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const foreignHost = request({
      hostname: address.hostname,
      port: address.port,
      path: "/health",
      headers: { Host: "example.com" },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    foreignHost.on("error", reject);
    foreignHost.end();
  });
  assert.equal(foreignHostStatus, 403);
});

test("dashboard collects owner answers without changing TASKS.md", async () => {
  const projectRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-answers-test-"));
  fixtureRoots.add(projectRoot);
  await mkdir(join(projectRoot, "project-control/codex"), { recursive: true });
  const tracker = `# Tasks\n\n## Questions for Şekip\n\n- Q-DEVX-01.004-1 | Which acceptance path should be used? | TASK: DEVX-01.004\n\n## Owner Decisions\n`;
  await writeFile(join(projectRoot, "TASKS.md"), tracker, "utf8");
  const { baseUrl } = await startServer({ projectRoot });

  const before = await fetch(`${baseUrl}/api/overview`);
  const overview = await before.json();
  const formulab = overview.projects.find((project) => project.name.toLowerCase() === "formulab");
  assert.equal(formulab.questions[0].id, "Q-DEVX-01.004-1");
  assert.equal(formulab.questions[0].answer, null);

  const submitted = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: formulab.id, questionId: "Q-DEVX-01.004-1", answer: "Use the existing acceptance matrix." }),
  });
  assert.equal(submitted.status, 201);
  const after = await (await fetch(`${baseUrl}/api/overview`)).json();
  assert.equal(after.projects.find((project) => project.name.toLowerCase() === "formulab").questions[0].answer.answer, "Use the existing acceptance matrix.");
  assert.equal(await readFile(join(projectRoot, "TASKS.md"), "utf8"), tracker);
  assert.match(await readFile(join(projectRoot, "project-control/codex/owner-answers.jsonl"), "utf8"), /Use the existing acceptance matrix/);

  const duplicate = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: formulab.id, questionId: "Q-DEVX-01.004-1", answer: "A different answer." }),
  });
  assert.equal(duplicate.status, 409);

  const unknown = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: formulab.id, questionId: "Q-UNKNOWN-1", answer: "Not applicable." }),
  });
  assert.equal(unknown.status, 404);
});

test("creates an owner answer inbox only for the selected project's open question", async () => {
  const projectRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-new-inbox-test-"));
  fixtureRoots.add(projectRoot);
  const tracker = "## Questions for Owner\n- Q-TEST-01-1 | Which option? | TASK: TEST-01\n";
  await writeFile(join(projectRoot, "TASKS.md"), tracker, "utf8");
  const { baseUrl } = await startServer({
    projectList: { rows: [{ id: "new-project", name: "New Project", roots: [{ path: projectRoot }] }], truncated: false },
  });

  const submitted = await fetch(baseUrl + "/api/owner-answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: "new-project", questionId: "Q-TEST-01-1", answer: "Use option A." }),
  });
  assert.equal(submitted.status, 201);
  const answer = JSON.parse((await readFile(join(projectRoot, "project-control/codex/owner-answers.jsonl"), "utf8")).trim());
  assert.equal(answer.questionId, "Q-TEST-01-1");
  assert.equal(answer.taskId, "TEST-01");
  assert.equal(answer.answer, "Use option A.");
  assert.equal(await readFile(join(projectRoot, "TASKS.md"), "utf8"), tracker);
});

test("isolates task state, jobs, questions, and owner answers by saved project root", async () => {
  const alphaRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-alpha-test-"));
  const betaRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-beta-test-"));
  const gammaRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-gamma-test-"));
  fixtureRoots.add(alphaRoot);
  fixtureRoots.add(betaRoot);
  fixtureRoots.add(gammaRoot);
  for (const projectRoot of [alphaRoot, betaRoot, gammaRoot]) {
    await mkdir(join(projectRoot, "project-control/codex/jobs/active"), { recursive: true });
    await mkdir(join(projectRoot, "evidence"), { recursive: true });
  }
  await writeFile(join(alphaRoot, "evidence/PL-0438-rules.md"), "rules review", "utf8");
  await writeFile(join(betaRoot, "evidence/FVL-11.008-rules.md"), "rules review", "utf8");
  await writeFile(join(betaRoot, "evidence/FVL-11.008-code.md"), "code review", "utf8");
  const alphaTracker = `# Project Alpha\n\n## Project Status\n- Current Milestone: M16\n- Current Sprint: M16-C002\n- Current Task: PL-0438 — Alpha queue work\n- Current Task Status: IN_PROGRESS\n- Next Task/Action: Keep working on PL-0438 only.\n- Required Actor: CODEX\n- Tracking Repository: local/alpha\n- Tracking Branch: main\n\n## Tasks\n- [~] **PL-0438** Alpha queue work\n\n## Questions for Şekip\n- Q-PL-0438-1 | Which alpha option? | TASK: PL-0438\n`;
  const betaTracker = `# Project Beta\n\n## Project Status\n- Current Milestone: FVL-11\n- Current Sprint: FVL-11-S01\n- Current Task: FVL-11.008 — Beta task\n- Current Task Status: IN_PROGRESS\n- Next Task: FVL-11.009 — Beta next task\n- Required Actor: CODEX\n- Tracking Repository: local/beta\n- Tracking Branch: main\n\n## Tasks\n- [~] FVL-11.008 — Beta task\n\n## Questions for Şekip\n- Q-FVL-11.008-1 | Which beta option? | TASK: FVL-11.008\n`;
  const gammaTracker = `# Project Gamma\n\n## Project Status\n- Current Milestone: M43\n- Current Sprint: M43-C005\n- Current Task: M43-C005-C003 — Gamma task\n- Current Task Status: IN_PROGRESS\n- Next Task: M43-C005-C004 — Next gamma task\n- Required Actor: CODEX\n\n## Owner Questions\n- Q-M43-C005-C003-1 | Which gamma option? | TASK: M43-C005-C003\n`;
  await writeFile(join(alphaRoot, "TASKS.md"), alphaTracker, "utf8");
  await writeFile(join(betaRoot, "TASKS.md"), betaTracker, "utf8");
  await writeFile(join(gammaRoot, "TASKS.md"), gammaTracker, "utf8");
  await writeFile(join(alphaRoot, "project-control/codex/jobs/active/job.json"), JSON.stringify({
    id: "PL-0438", task: "PackLab task", stage: "BUILD", round: 1, reviews: { rules: "pass", code: "pending", tests: "pending" }, reviewEvidence: { rules: "evidence/PL-0438-rules.md" },
  }), "utf8");
  await writeFile(join(betaRoot, "project-control/codex/jobs/active/job.json"), JSON.stringify({
    id: "FVL-11.008", task: "FormuLab task", stage: "REVIEW", round: 1, reviews: { rules: "pass", code: "pass", tests: "pending" }, reviewEvidence: { rules: "evidence/FVL-11.008-rules.md", code: "evidence/FVL-11.008-code.md" },
  }), "utf8");
  await writeFile(join(gammaRoot, "project-control/codex/jobs/active/job.json"), JSON.stringify({
    id: "M43-C005-C003", task: "Gamma task", stage: "BUILD", round: 1, reviews: { rules: "pass", code: "pending", tests: "pending" },
  }), "utf8");

  const { baseUrl } = await startServer({
    projectRoot: betaRoot,
    projectList: { rows: [
      { id: "alpha-project", name: "Project Alpha", roots: [{ path: alphaRoot }] },
      { id: "beta-project", name: "Project Beta", roots: [{ path: betaRoot }] },
      { id: "gamma-project", name: "Project Gamma", roots: [{ path: gammaRoot }] },
    ], truncated: false },
  });
  const overview = await (await fetch(`${baseUrl}/api/overview`)).json();
  const alpha = overview.projects.find((project) => project.id === "alpha-project");
  const beta = overview.projects.find((project) => project.id === "beta-project");
  const gamma = overview.projects.find((project) => project.id === "gamma-project");
  assert.equal(alpha.task.currentTask.id, "PL-0438");
  assert.deepEqual(alpha.jobs.map((job) => job.id), ["PL-0438"]);
  assert.equal(alpha.questions[0].id, "Q-PL-0438-1");
  assert.equal(alpha.jobs[0].reviews.rules, "pass");
  assert.equal(beta.jobs[0].reviews.code, "pass");
  assert.equal(beta.jobs[0].reviews.tests, "pending");
  assert.equal(beta.task.currentTask.id, "FVL-11.008");
  assert.deepEqual(beta.jobs.map((job) => job.id), ["FVL-11.008"]);
  assert.equal(beta.questions[0].id, "Q-FVL-11.008-1");
  assert.equal(gamma.workflowState, "available");
  assert.equal(gamma.task.currentTask.id, "M43-C005-C003");
  assert.deepEqual(gamma.jobs.map((job) => job.id), ["M43-C005-C003"]);
  assert.equal(gamma.questions[0].id, "Q-M43-C005-C003-1");

  const submitted = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: alpha.id, questionId: "Q-PL-0438-1", answer: "Alpha answer." }),
  });
  assert.equal(submitted.status, 201);
  assert.match(await readFile(join(alphaRoot, "project-control/codex/owner-answers.jsonl"), "utf8"), /Alpha answer/);
  await assert.rejects(readFile(join(betaRoot, "project-control/codex/owner-answers.jsonl"), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(join(alphaRoot, "TASKS.md"), "utf8"), alphaTracker);

  const unknownProject = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: "C:\\arbitrary", questionId: "Q-PL-0438-1", answer: "No path injection." }),
  });
  assert.equal(unknownProject.status, 404);
});

test("splits a saved project's multiple roots into independently routed project views", async () => {
  const firstRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-multi-root-a-"));
  const secondRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-multi-root-b-"));
  fixtureRoots.add(firstRoot);
  fixtureRoots.add(secondRoot);
  for (const [projectRoot, taskId, questionId] of [
    [firstRoot, "ROOT-A-01", "Q-ROOT-A-01-1"],
    [secondRoot, "ROOT-B-01", "Q-ROOT-B-01-1"],
  ]) {
    await mkdir(join(projectRoot, "project-control/codex/jobs/active"), { recursive: true });
    await writeFile(join(projectRoot, "TASKS.md"), `## Project Status\n- Current Task: ${taskId} — Root task\n- Current Task Status: IN_PROGRESS\n\n## Questions for Owner\n- ${questionId} | Choose a root-specific option? | TASK: ${taskId}\n`, "utf8");
    await writeFile(join(projectRoot, "project-control/codex/jobs/active/job.json"), JSON.stringify({
      id: taskId, task: `Task from ${taskId}`, stage: "BUILD", round: 1, reviews: { rules: "pending", code: "pending", tests: "pending" },
    }), "utf8");
  }
  const { baseUrl } = await startServer({
    projectList: { rows: [{
      id: "multi-project", name: "One saved project", roots: [{ path: firstRoot }, { path: secondRoot }],
    }], truncated: false },
    threads: [
      { id: "root-a-thread", title: "Root A work", cwd: firstRoot, status: "idle", projectId: "multi-project" },
      { id: "root-b-thread", title: "Root B work", cwd: secondRoot, status: "idle", projectId: "multi-project" },
    ],
  });

  const overview = await (await fetch(`${baseUrl}/api/overview`)).json();
  assert.equal(overview.projectCount, 2);
  const rootA = overview.projects.find((project) => project.roots[0] === firstRoot);
  const rootB = overview.projects.find((project) => project.roots[0] === secondRoot);
  assert.ok(rootA);
  assert.ok(rootB);
  assert.notEqual(rootA.id, rootB.id);
  assert.match(rootA.name, /Root A|dashboard-multi-root-a/i);
  assert.equal(rootA.task.currentTask.id, "ROOT-A-01");
  assert.deepEqual(rootA.jobs.map((job) => job.id), ["ROOT-A-01"]);
  assert.deepEqual(rootA.questions.map((question) => question.id), ["Q-ROOT-A-01-1"]);
  assert.deepEqual(rootA.threads.map((thread) => thread.id), ["root-a-thread"]);
  assert.equal(rootB.task.currentTask.id, "ROOT-B-01");
  assert.deepEqual(rootB.jobs.map((job) => job.id), ["ROOT-B-01"]);
  assert.deepEqual(rootB.questions.map((question) => question.id), ["Q-ROOT-B-01-1"]);
  assert.deepEqual(rootB.threads.map((thread) => thread.id), ["root-b-thread"]);

  const submitted = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: rootB.id, questionId: "Q-ROOT-B-01-1", answer: "Answer for root B." }),
  });
  assert.equal(submitted.status, 201);
  assert.match(await readFile(join(secondRoot, "project-control/codex/owner-answers.jsonl"), "utf8"), /Answer for root B/);
  await assert.rejects(readFile(join(firstRoot, "project-control/codex/owner-answers.jsonl"), "utf8"), { code: "ENOENT" });
});

test("answer submission rejects cross-origin requests", async () => {
  const projectRoot = await mkdtemp(join(rootPath(), "scripts/codex/.dashboard-origin-test-"));
  fixtureRoots.add(projectRoot);
  await mkdir(join(projectRoot, "project-control/codex"), { recursive: true });
  await writeFile(join(projectRoot, "TASKS.md"), "## Questions for Şekip\n\n- Q-TEST-01.001-1 | Test question? | TASK: TEST-01.001\n", "utf8");
  const { baseUrl } = await startServer({ projectRoot });
  const response = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { Origin: "http://example.com", "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "Q-TEST-01.001-1", answer: "No." }),
  });
  assert.equal(response.status, 403);
});

test("ignores malformed job JSON without failing the dashboard overview", async () => {
  const fixtureRoot = await makeJobFixtureRoot();
  const jobs = join(fixtureRoot, "project-control/codex/jobs");
  for (const [name, value] of [["null-job", "null"], ["array-job", "[]"], ["invalid-json", "{"]]) {
    const directory = join(jobs, name);
    await mkdir(directory);
    await writeFile(join(directory, "job.json"), value, "utf8");
  }
  const listed = await readWorkflowJobs(fixtureRoot);
  assert.deepEqual(listed, []);
});

test("does not follow a job.json symlink outside the project root", async (context) => {
  const fixtureRoot = await makeJobFixtureRoot();
  const outsidePath = join(fixtureRoot, "outside.json");
  const jobDirectory = join(fixtureRoot, "project-control/codex/jobs/escape");
  await mkdir(jobDirectory);
  await writeFile(outsidePath, JSON.stringify({
    id: "TEST-01.001", task: "Outside file", stage: "BUILD", round: 1,
    reviews: { rules: "pending", code: "pending", tests: "pending" },
  }), "utf8");
  try {
    await symlink(outsidePath, join(jobDirectory, "job.json"), "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      context.skip("File symlinks are not available in this Windows environment.");
      return;
    }
    throw error;
  }
  assert.deepEqual(await readWorkflowJobs(fixtureRoot), []);
  assert.equal((await readFile(outsidePath, "utf8")).includes("Outside file"), true);
});
