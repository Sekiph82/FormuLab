import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardServer } from "./dashboard-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map((server) => server.close()));
  openServers.clear();
});

async function startServer({ projectList = { rows: [], truncated: false }, threads = [] } = {}) {
  const app = createDashboardServer({
    root,
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
      title: "FVL-11 acceptance",
      cwd: "C:\\work\\FormuLab",
      status: { type: "idle" },
      updatedAt: 1_800_000_000,
    }],
  });

  const response = await fetch(`${baseUrl}/api/overview`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projectCount, 1);
  assert.equal(payload.activeThreadCount, 1);
  assert.equal(payload.projects[0].name, "FormuLab");
  assert.equal(payload.projects[0].threads[0].title, "FVL-11 acceptance");
  assert.match(payload.task.currentTask.id, /^[A-Z][A-Z0-9]*-\d+\.\d+$/);
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
  assert.equal(payload.projects[0].id, "unassigned");
  assert.equal(payload.projects[0].threads[0].id, "thread-2");
});

test("serves local assets and rejects writes and foreign Host headers", async () => {
  const { baseUrl } = await startServer();
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /All your Codex projects/);

  const write = await fetch(`${baseUrl}/api/overview`, { method: "POST" });
  assert.equal(write.status, 405);

  const foreignHost = await fetch(`${baseUrl}/health`, { headers: { Host: "example.com" } });
  assert.equal(foreignHost.status, 403);
});
