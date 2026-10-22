import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./app-server-client.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, "../..");
const cacheDurationMs = 20_000;
const projectCatalog = [
  { id: "packlab", name: "PackLab", kind: "Codex", names: ["PackLab"], pathSegments: ["PackLab"] },
  { id: "formulab", name: "Formulab", kind: "Codex", names: ["Formulab", "FormuLab"], pathSegments: ["FormuLab"] },
  { id: "fmcg-erp-system-main", name: "fmcg-erp-system-main", kind: "Codex", names: ["fmcg-erp-system-main"], pathSegments: ["fmcg-erp-system-main"] },
  { id: "match3-visual-ui-factory", name: "MATCH3-Visual-UI-Factory", kind: "Codex", names: ["MATCH3-Visual-UI-Factory"], pathSegments: ["MATCH3-Visual-UI-Factory"] },
  { id: "match3-level-factory", name: "Match3-Level-Factory", kind: "Codex", names: ["Match3-Level-Factory"], pathSegments: ["Match3-Level-Factory"] },
  { id: "scrubbots-level-factory", name: "ScrubBots Level Factory", kind: "Codex", names: ["ScrubBots Level Factory"], pathSegments: ["Scrubbots - Pixel Art Generator"] },
  { id: "match3-engine", name: "MATCH3_ENGINE", kind: "Codex", names: ["MATCH3_ENGINE"], pathSegments: ["MATCH3_ENGINE"] },
  { id: "wonder-pop", name: "Wonder_Pop", kind: "GitHub", repositoryUrl: "https://github.com/Sekiph82/Wonder_Pop", names: ["Wonder_Pop"], pathSegments: ["Wonder_Pop"] },
  { id: "the-fractured-realms", name: "The_Fractured_Realms", kind: "GitHub", repositoryUrl: "https://github.com/Sekiph82/The_Fractured_Realms", names: ["The_Fractured_Realms"], pathSegments: ["The_Fractured_Realms"] },
  { id: "dino-islands", name: "Dino_Islands", kind: "GitHub", repositoryUrl: "https://github.com/Sekiph82/Dino_Islands", names: ["Dino_Islands"], pathSegments: ["Dino_Islands"] },
  { id: "garage-legends", name: "Garage_Legends", kind: "GitHub", repositoryUrl: "https://github.com/Sekiph82/Garage_Legends", names: ["Garage_Legends"], pathSegments: ["Garage_Legends"] },
  { id: "coral-rescue", name: "Coral_Rescue", kind: "GitHub", repositoryUrl: "https://github.com/Sekiph82/Coral_Rescue", names: ["Coral_Rescue"], pathSegments: ["Coral_Rescue"] },
];

function trackerSummary(source) {
  const get = (name) => source.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  const task = get("Current Task")?.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
  return {
    milestone: get("Current Milestone"),
    sprint: get("Current Sprint"),
    currentTask: task ? { id: task[1], title: task[2] } : null,
    currentTaskStatus: get("Current Task Status"),
    nextTask: get("Next Task"),
    requiredActor: get("Required Actor"),
    completion: get("Completion"),
  };
}

function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase() : "";
}

function pathHasSegment(path, segments) {
  const pathSegments = normalizePath(path).split("/");
  return segments.some((segment) => pathSegments.includes(segment.toLowerCase()));
}

function getRoots(project) {
  const roots = Array.isArray(project?.roots) ? project.roots : [];
  return roots.map((root) => typeof root === "string" ? root : root?.path).filter((root) => typeof root === "string");
}

function threadStatus(thread) {
  const status = thread?.status;
  if (typeof status === "string") return status;
  if (status && typeof status.type === "string") return status.type;
  return thread?.archived ? "archived" : "idle";
}

function threadUpdatedAt(thread) {
  const value = thread?.updatedAt ?? thread?.updated_at ?? thread?.recencyAt ?? thread?.recency_at ?? null;
  if (typeof value === "number") return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  return typeof value === "string" ? value : null;
}

function sanitizeThread(thread) {
  const title = typeof thread?.title === "string" && thread.title.trim()
    ? thread.title
    : typeof thread?.preview === "string" && thread.preview.trim()
      ? thread.preview
      : "Untitled Codex task";
  return {
    id: typeof thread?.id === "string" ? thread.id : "",
    title: title.slice(0, 180),
    cwd: typeof thread?.cwd === "string" ? thread.cwd : "",
    status: threadStatus(thread),
    updatedAt: threadUpdatedAt(thread),
    source: typeof thread?.sourceKind === "string" ? thread.sourceKind : "Codex",
    projectId: typeof thread?.projectId === "string" ? thread.projectId : null,
  };
}

function projectMatches(project, definition) {
  return definition.names.some((name) => String(project?.name ?? "").toLowerCase() === name.toLowerCase()) ||
    getRoots(project).some((root) => pathHasSegment(root, definition.pathSegments));
}

function groupThreads(projects, threads) {
  const safeThreads = threads.map(sanitizeThread);
  return projectCatalog.map((definition) => {
    const source = projects.find((project) => projectMatches(project, definition));
    const sourceId = typeof source?.id === "string" ? source.id : null;
    const roots = getRoots(source);
    const matchingThreads = safeThreads.filter((thread) =>
      (sourceId && thread.projectId === sourceId) ||
      roots.some((root) => normalizePath(root) === normalizePath(thread.cwd)) ||
      pathHasSegment(thread.cwd, definition.pathSegments)
    );
    const threadRoots = matchingThreads.map((thread) => thread.cwd).filter(Boolean);
    return {
      id: sourceId ?? definition.id,
      name: definition.name,
      kind: definition.kind,
      repositoryUrl: definition.repositoryUrl ?? null,
      roots: roots.length ? roots : [...new Set(threadRoots)],
      updatedAt: threadUpdatedAt({ updatedAt: source?.updatedAt ?? source?.updated_at ?? source?.recencyAt }),
      threads: matchingThreads,
    };
  });
}

function statusCodeFor(error) {
  if (error?.code === -32601 || /method not found|unknown method/i.test(error?.message ?? "")) return 501;
  return 503;
}

function safeMessage(error) {
  if (error?.code === -32601 || /method not found|unknown method/i.test(error?.message ?? "")) {
    return "This Codex App Server does not support the required read-only listing method.";
  }
  if (/timed out/i.test(error?.message ?? "")) return "Codex App Server did not respond in time.";
  return "Codex App Server data is temporarily unavailable.";
}

export function createDashboardServer({
  root = defaultRoot,
  host = "127.0.0.1",
  port = 9000,
  clientFactory = () => new CodexAppServerClient(),
} = {}) {
  let client;
  let initialized = false;
  let cache;
  let loading;

  async function snapshot() {
    if (cache && Date.now() - cache.loadedAt < cacheDurationMs) return cache.value;
    if (loading) return loading;
    loading = (async () => {
      try {
        const trackerSource = await readFile(resolve(root, "TASKS.md"), "utf8");
        const tracker = trackerSummary(trackerSource);
        client ??= clientFactory();
        if (!initialized) {
          await client.initialize();
          initialized = true;
        }

        let projectListing;
        let projectListState = "available";
        try {
          projectListing = await client.listProjects();
        } catch (error) {
          if (statusCodeFor(error) !== 501) throw error;
          projectListState = "unsupported";
          projectListing = { rows: [], truncated: false };
        }

        const threadListing = await client.listThreads();
        const projects = groupThreads(projectListing.rows, threadListing.rows);
        const value = {
          generatedAt: new Date().toISOString(),
          source: "Codex App Server and selected GitHub repositories",
          projectListState,
          projects,
          projectCount: projects.length,
          activeThreadCount: projects.reduce((count, project) => count + project.threads.length, 0),
          truncated: Boolean(projectListing.truncated || threadListing.truncated),
          task: tracker,
        };
        cache = { loadedAt: Date.now(), value };
        return value;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");

    const hostHeader = request.headers.host;
    const boundPort = server.address()?.port ?? port;
    if (hostHeader && hostHeader !== `${host}:${boundPort}` && hostHeader !== `localhost:${boundPort}`) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end("Method not allowed");
      return;
    }

    const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname === "/api/overview") {
      try {
        const value = await snapshot();
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(value));
      } catch (error) {
        response.writeHead(statusCodeFor(error), { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({
          error: safeMessage(error),
          detail: error?.code === -32601 ? "unsupported" : "unavailable",
          generatedAt: new Date().toISOString(),
        }));
        const failedClient = client;
        client = undefined;
        initialized = false;
        try {
          await failedClient?.close();
        } catch {
          // A failed connection must not prevent the next refresh from reconnecting.
        }
      }
      return;
    }
    const assets = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/dashboard.js": ["dashboard.js", "text/javascript; charset=utf-8"],
      "/dashboard.css": ["dashboard.css", "text/css; charset=utf-8"],
    };
    const asset = assets[pathname];
    if (!asset) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": asset[1] });
    createReadStream(resolve(scriptDirectory, "dashboard", asset[0])).pipe(response);
  });

  return {
    server,
    async listen() {
      await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolveListen);
      });
    },
    async close() {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
      await client?.close();
    },
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const app = createDashboardServer();
  app.server.on("error", (error) => {
    console.error(`Dashboard could not start: ${error.message}`);
    process.exitCode = 1;
  });
  await app.listen();
  console.log("Codex project dashboard: http://127.0.0.1:9000");
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
