import { createReadStream } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./app-server-client.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cacheDurationMs = 1_000;
const workflowStages = ["SPEC", "BUILD", "REVIEW", "APPROVE", "MERGED", "ESCALATED"];
const reviewLenses = ["rules", "code", "tests"];
const ownerAnswerLocks = new Map();

function trackerSummary(source) {
  const get = (name) => source.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  const task = get("Current Task")?.match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\.\d{1,4})?) — (.+)$/);
  return {
    milestone: get("Current Milestone"),
    sprint: get("Current Sprint"),
    currentTask: task ? { id: task[1], title: task[2] } : null,
    currentTaskStatus: get("Current Task Status"),
    nextTask: get("Next Task") ?? get("Next Task/Action"),
    requiredActor: get("Required Actor"),
    completion: get("Completion"),
  };
}

function trackerQuestions(source) {
  const questionSection = source.split(/^## /m).find((candidate) => {
    const heading = candidate.split(/\r?\n/, 1)[0]?.trim() ?? "";
    return /^(?:Questions(?: for .+)?|Owner Questions)$/i.test(heading);
  });
  const section = questionSection?.slice(questionSection.indexOf("\n") + 1) ?? "";
  return section.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*[-*]\s+(Q-[A-Z0-9.-]+)\s*\|\s*(.+?)\s*\|\s*TASK:\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\.\d{1,4})?)\s*$/);
    return match ? [{ id: match[1], question: match[2].slice(0, 1_000), taskId: match[3] }] : [];
  });
}

async function ownerInboxPath(root, { create = false } = {}) {
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const segment of ["project-control", "codex"]) {
    current = resolve(current, segment);
    if (create) {
      try {
        await mkdir(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory() || !isWithinDirectory(canonicalRoot, await realpath(current))) {
      throw new Error("Owner answer inbox directories must be regular directories inside the project root.");
    }
  }
  return resolve(current, "owner-answers.jsonl");
}

async function readOwnerAnswers(root) {
  let path;
  try {
    path = await ownerInboxPath(root);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) return [];
    throw error;
  }
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return [];
    const source = await readFile(path, "utf8");
    return source.split(/\r?\n/).flatMap((line) => {
      if (!line || line.length > 8_500) return [];
      try {
        const answer = JSON.parse(line);
        return typeof answer?.questionId === "string" && typeof answer?.answer === "string" && typeof answer?.submittedAt === "string"
          ? [{ questionId: answer.questionId, answer: answer.answer.slice(0, 4_000), submittedAt: answer.submittedAt, taskId: typeof answer.taskId === "string" ? answer.taskId : null }]
          : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function saveOwnerAnswerUnlocked(root, questionId, answer, source) {
  const question = trackerQuestions(source).find((entry) => entry.id === questionId);
  if (!question) return { status: 404, error: "That question is no longer open." };
  if ((await readOwnerAnswers(root)).some((entry) => entry.questionId === questionId)) {
    return { status: 409, error: "An answer has already been submitted for this question." };
  }
  const entry = { questionId, taskId: question.taskId, answer, submittedAt: new Date().toISOString() };
  const path = await ownerInboxPath(root, { create: true });
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return { status: 400, error: "The answer inbox is not a regular file." };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "a" });
  return { status: 201, entry };
}

async function saveOwnerAnswer(root, questionId, answer, source) {
  const key = resolve(root).toLowerCase();
  const previous = ownerAnswerLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolveLock) => { release = resolveLock; });
  ownerAnswerLocks.set(key, current);
  await previous;
  try {
    return await saveOwnerAnswerUnlocked(root, questionId, answer, source);
  } finally {
    release();
    if (ownerAnswerLocks.get(key) === current) ownerAnswerLocks.delete(key);
  }
}

async function readJsonBody(request, maximumBytes = 8_192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function isWithinDirectory(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent));
}

export async function readWorkflowJobs(root) {
  const jobsDirectory = resolve(root, "project-control/codex/jobs");
  let entries;
  try {
    entries = await readdir(jobsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const canonicalRoot = await realpath(root);
  const canonicalJobsDirectory = await realpath(jobsDirectory);
  if (!isWithinDirectory(canonicalRoot, canonicalJobsDirectory)) return [];
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const jobDirectory = join(canonicalJobsDirectory, entry.name);
      const canonicalJobDirectory = await realpath(jobDirectory);
      if (!isWithinDirectory(canonicalJobsDirectory, canonicalJobDirectory)) continue;
      const jobPath = join(jobDirectory, "job.json");
      const canonicalJobPath = await realpath(jobPath);
      if (!isWithinDirectory(canonicalJobDirectory, canonicalJobPath)) continue;
      const fileInfo = await lstat(jobPath);
      if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) continue;
      const value = JSON.parse(await readFile(canonicalJobPath, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\.\d{1,4})?$/.test(value.id ?? "") ||
          typeof value.task !== "string" || !value.task.trim() ||
          !workflowStages.includes(value.stage) ||
          !Number.isInteger(value.round) || value.round < 1 ||
          !value.reviews || typeof value.reviews !== "object" || Array.isArray(value.reviews)) continue;
      const reviewEvidence = Object.fromEntries(reviewLenses.map((lens) => {
        const reference = value.reviewEvidence?.[lens];
        return [lens, null];
      }));
      await Promise.all(reviewLenses.map(async (lens) => {
        const reference = value.reviewEvidence?.[lens];
        if (typeof reference !== "string" || !reference.trim() || isAbsolute(reference) || /^https?:\/\//i.test(reference)) return;
        const evidencePath = resolve(canonicalRoot, reference);
        if (!isWithinDirectory(canonicalRoot, evidencePath)) return;
        try {
          const evidenceInfo = await lstat(evidencePath);
          const canonicalEvidencePath = await realpath(evidencePath);
          if (!evidenceInfo.isSymbolicLink() && evidenceInfo.isFile() && isWithinDirectory(canonicalRoot, canonicalEvidencePath)) {
            reviewEvidence[lens] = reference.replaceAll("\\", "/").slice(0, 1_000);
          }
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error?.code)) throw error;
        }
      }));
      const reviews = Object.fromEntries(reviewLenses.map((lens) => [
        lens,
        value.reviews[lens] === "pass" && reviewEvidence[lens]
          ? "pass"
          : value.reviews[lens] === "changes" ? "changes" : "pending",
      ]));
      jobs.push({
        id: value.id,
        task: value.task.slice(0, 240),
        stage: value.stage,
        round: value.round,
        reviews,
        reviewEvidence,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
      });
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ELOOP" && !(error instanceof SyntaxError)) throw error;
    }
  }
  return jobs.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase() : "";
}

function pathContains(root, candidate) {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  return Boolean(normalizedRoot && normalizedCandidate &&
    (normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)));
}

function getRoots(project) {
  const roots = Array.isArray(project?.roots) ? project.roots : [];
  const candidates = [
    ...roots.map((root) => typeof root === "string" ? root : root?.path),
    project?.root,
    project?.path,
  ];
  const seen = new Set();
  return candidates.filter((root) => {
    if (typeof root !== "string" || !isAbsolute(root)) return false;
    const normalized = normalizePath(root);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

async function readProjectWorkflow(root) {
  try {
    if (!isAbsolute(root)) return null;
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return null;
    const canonicalRoot = await realpath(root);
    const trackerPath = resolve(canonicalRoot, "TASKS.md");
    const trackerInfo = await lstat(trackerPath);
    if (trackerInfo.isSymbolicLink() || !trackerInfo.isFile()) return null;
    const canonicalTrackerPath = await realpath(trackerPath);
    if (!isWithinDirectory(canonicalRoot, canonicalTrackerPath)) return null;

    const trackerSource = await readFile(canonicalTrackerPath, "utf8");
    const answers = await readOwnerAnswers(canonicalRoot);
    const questions = trackerQuestions(trackerSource).map((question) => ({
      ...question,
      answer: answers.filter((answer) => answer.questionId === question.id && answer.taskId === question.taskId).at(-1) ?? null,
    }));
    return {
      root: canonicalRoot,
      task: trackerSummary(trackerSource),
      questions,
      jobs: await readWorkflowJobs(canonicalRoot),
      workflowState: "available",
      trackerSource,
    };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) return null;
    throw error;
  }
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

function groupThreads(projects, threads) {
  const safeThreads = threads.map(sanitizeThread);
  const entries = [];
  projects.forEach((source, index) => {
    const sourceId = typeof source?.id === "string" ? source.id : `project-${index + 1}`;
    const declaredRoots = getRoots(source);
    const inferredRoots = declaredRoots.length ? [] : [...new Set(safeThreads
      .filter((thread) => thread.projectId === sourceId && isAbsolute(thread.cwd))
      .map((thread) => thread.cwd))];
    const roots = declaredRoots.length ? declaredRoots : inferredRoots;
    if (!roots.length) {
      entries.push({ source, sourceId, id: sourceId, root: null, roots: [], threads: [] });
      return;
    }
    roots.forEach((root, rootIndex) => {
      const multipleRoots = roots.length > 1;
      const rootName = basename(root);
      entries.push({
        source,
        sourceId,
        id: multipleRoots ? `${sourceId}::root-${rootIndex + 1}` : sourceId,
        root,
        roots: [root],
        name: multipleRoots ? `${typeof source?.name === "string" && source.name.trim() ? source.name.trim() : sourceId} — ${rootName}` : null,
        threads: [],
      });
    });
  });
  const matchedThreads = new Set();
  for (const thread of safeThreads) {
    const candidates = entries.filter((candidate) => !thread.projectId || candidate.sourceId === thread.projectId);
    const entry = candidates
      .filter((candidate) => candidate.root && pathContains(candidate.root, thread.cwd))
      .sort((left, right) => normalizePath(right.root).length - normalizePath(left.root).length)[0]
      ?? (candidates.length === 1 && !candidates[0].root ? candidates[0] : null);
    if (entry) {
      entry.threads.push(thread);
      matchedThreads.add(thread);
    }
  }

  const grouped = entries.map(({ source, id, root, roots, name, threads: matchingThreads }) => {
    const fallbackName = root ? basename(root) : "Unnamed project";
    return {
      id,
      name: name ?? (typeof source?.name === "string" && source.name.trim() ? source.name.trim() : fallbackName),
      kind: typeof source?.kind === "string" ? source.kind : "Codex",
      repositoryUrl: typeof source?.repositoryUrl === "string" ? source.repositoryUrl : null,
      roots,
      updatedAt: threadUpdatedAt({ updatedAt: source?.updatedAt ?? source?.updated_at ?? source?.recencyAt }),
      threads: matchingThreads,
    };
  });

  const unmatchedThreads = safeThreads.filter((thread) => !matchedThreads.has(thread));
  const workspaceGroups = new Map();
  for (const thread of unmatchedThreads) {
    const root = isAbsolute(thread.cwd) ? thread.cwd : "";
    const key = thread.projectId ? `project:${thread.projectId}` : root ? `root:${normalizePath(root)}` : `thread:${thread.id}`;
    const group = workspaceGroups.get(key) ?? { root, threads: [] };
    group.threads.push(thread);
    workspaceGroups.set(key, group);
  }
  for (const [key, group] of workspaceGroups) {
    const root = group.root;
    grouped.push({
      id: key,
      name: root ? basename(root) : "Codex workspace",
      kind: "Codex",
      repositoryUrl: null,
      roots: root ? [root] : [],
      updatedAt: null,
      threads: group.threads,
    });
  }

  return grouped;
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
  host = "127.0.0.1",
  port = 9000,
  clientFactory = () => new CodexAppServerClient(),
} = {}) {
  let client;
  let initialized = false;
  let cache;
  let loading;
  let workflowRoots = new Map();

  async function snapshot() {
    if (cache && Date.now() - cache.loadedAt < cacheDurationMs) return cache.value;
    if (loading) return loading;
    loading = (async () => {
      try {
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
        const groupedProjects = groupThreads(projectListing.rows, threadListing.rows);
        const nextWorkflowRoots = new Map();
        const projects = await Promise.all(groupedProjects.map(async (project) => {
          let workflow = null;
          for (const candidate of project.roots) {
            try {
              workflow = await readProjectWorkflow(candidate);
            } catch {
              workflow = null;
            }
            if (workflow) break;
          }
          if (workflow?.root) nextWorkflowRoots.set(project.id, workflow.root);
          const { root: _root, trackerSource: _trackerSource, ...publicWorkflow } = workflow ?? {
            task: null, questions: [], jobs: [], workflowState: "unavailable",
          };
          return { ...project, ...publicWorkflow };
        }));
        workflowRoots = nextWorkflowRoots;
        const value = {
          generatedAt: new Date().toISOString(),
          source: "Codex App Server and each project's local TASKS.md",
          projectListState,
          projects,
          projectCount: projects.length,
          activeThreadCount: projects.reduce((count, project) => count + project.threads.length, 0),
          truncated: Boolean(projectListing.truncated || threadListing.truncated),
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
    const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
    if (request.method === "POST" && pathname === "/api/owner-answers") {
      const allowedOrigin = `http://${hostHeader}`;
      if (request.headers.origin && request.headers.origin !== allowedOrigin) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        response.writeHead(415).end("Content-Type must be application/json.");
        return;
      }
      try {
        const payload = await readJsonBody(request);
        const questionId = typeof payload?.questionId === "string" ? payload.questionId.trim() : "";
        const answer = typeof payload?.answer === "string" ? payload.answer.trim() : "";
        const projectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
        if (!/^Q-[A-Z0-9.-]+$/.test(questionId) || !answer || answer.length > 4_000) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "Provide an open question ID and an answer of 1 to 4000 characters." }));
          return;
        }
        const overview = await snapshot();
        const project = overview.projects.find((entry) => entry.id === projectId);
        const projectRoot = workflowRoots.get(projectId);
        if (!project || !projectRoot) {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "That project has no validated local task root." }));
          return;
        }
        const workflow = await readProjectWorkflow(projectRoot);
        if (!workflow) {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "That project task file is unavailable." }));
          return;
        }
        const result = await saveOwnerAnswer(workflow.root, questionId, answer, workflow.trackerSource);
        if (result.status !== 201) {
          response.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: result.error }));
          return;
        }
        cache = undefined;
        response.writeHead(201, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ submittedAt: result.entry.submittedAt }));
      } catch (error) {
        response.writeHead(error?.status ?? 500, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: error?.status ? error.message : "The answer could not be saved." }));
      }
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET, POST" }).end("Method not allowed");
      return;
    }
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
