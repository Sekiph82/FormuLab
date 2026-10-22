import assert from "node:assert/strict";
import { request } from "node:http";
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
