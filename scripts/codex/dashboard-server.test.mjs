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

async function startServer({ projectRoot = root, projectList = { rows: [], truncated: false }, threads = [] } = {}) {
  const app = createDashboardServer({
    root: projectRoot,
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
  const { baseUrl } = await startServer({
    projectList: {
      rows: [{ id: "project-1", name: "FormuLab", roots: [{ path: "C:\\work\\FormuLab" }] }],
      truncated: false,
    },
    threads: [{
      id: "thread-1",
      preview: "FVL-11 acceptance",
      cwd: "C:\\work\\FormuLab",
      status: { type: "idle" },
      updatedAt: 1_800_000_000,
    }],
  });

  const response = await fetch(`${baseUrl}/api/overview`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projectCount, 12);
  assert.equal(payload.activeThreadCount, 1);
  const formulab = payload.projects.find((project) => project.id === "project-1");
  assert.equal(formulab.name, "Formulab");
  assert.equal(formulab.threads[0].title, "FVL-11 acceptance");
  assert.equal(payload.projects.some((project) => ["deneme scrubbots piksel art uretimi", "Beach Cocktails - Merge", "H!veAI", "OUTPUTS", "ScrubBots"].includes(project.name)), false);
  assert.deepEqual(payload.projects.filter((project) => project.kind === "GitHub").map((project) => project.name), ["Wonder_Pop", "The_Fractured_Realms", "Dino_Islands", "Garage_Legends", "Coral_Rescue"]);
  assert.match(payload.task.currentTask.id, /^[A-Z][A-Z0-9]*-\d+\.\d+$/);
  assert.equal(payload.jobs.some((job) => job.id === "DEVX-01.003" && job.stage === "MERGED"), true);
  assert.equal(payload.jobs.find((job) => job.id === "DEVX-01.003").reviews.rules, "pass");
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
  assert.equal(payload.projectCount, 12);
  assert.equal(payload.projects.some((project) => project.id === "unassigned"), false);
});

test("recreates the App Server client after a transient listing failure", async () => {
  let clientCount = 0;
  let firstClientClosed = false;
  const app = createDashboardServer({
    root,
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
  assert.equal(overview.questions[0].id, "Q-DEVX-01.004-1");
  assert.equal(overview.questions[0].answer, null);

  const submitted = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "Q-DEVX-01.004-1", answer: "Use the existing acceptance matrix." }),
  });
  assert.equal(submitted.status, 201);
  const after = await (await fetch(`${baseUrl}/api/overview`)).json();
  assert.equal(after.questions[0].answer.answer, "Use the existing acceptance matrix.");
  assert.equal(await readFile(join(projectRoot, "TASKS.md"), "utf8"), tracker);
  assert.match(await readFile(join(projectRoot, "project-control/codex/owner-answers.jsonl"), "utf8"), /Use the existing acceptance matrix/);

  const duplicate = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "Q-DEVX-01.004-1", answer: "A different answer." }),
  });
  assert.equal(duplicate.status, 409);

  const unknown = await fetch(`${baseUrl}/api/owner-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: "Q-UNKNOWN-1", answer: "Not applicable." }),
  });
  assert.equal(unknown.status, 404);
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
