import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const trackerPath = resolve(repositoryRoot, "TASKS.md");
const temporaryTrackerPath = resolve(repositoryRoot, "TASKS.md.claim.tmp");

function field(source, name) {
  return source.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function readTasks(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^- \[([ x~!])\] ([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
    return match ? [{ marker: match[1], id: match[2], title: match[3] }] : [];
  });
}

export function claimCurrentTask(source) {
  const tasks = readTasks(source);
  const current = field(source, "Current Task")?.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
  const status = field(source, "Current Task Status");
  const actor = field(source, "Required Actor");
  const next = field(source, "Next Task");
  const total = Number(field(source, "Total Tasks"));
  const completed = Number(field(source, "Completed Tasks"));
  const remaining = Number(field(source, "Remaining Tasks"));
  const completion = Number(field(source, "Completion")?.replace(/%$/, ""));

  if (!current) throw new Error("Current Task must explicitly identify one task before the queue can start it.");
  if (actor !== "CODEX") throw new Error(`Required Actor must be CODEX; found ${actor ?? "missing"}.`);
  if (tasks.length !== total) throw new Error(`TASKS.md says ${total} tasks, but its ledger has ${tasks.length}.`);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Task IDs must be unique before claiming work.");
  const currentRows = tasks.filter((task) => task.id === current[1] && task.title === current[2]);
  if (currentRows.length !== 1) throw new Error(`Current Task ${current[1]} must match exactly one ledger row.`);
  if (completed !== tasks.filter((task) => task.marker === "x").length || remaining !== tasks.length - completed) {
    throw new Error("Task totals do not match the canonical checkbox ledger.");
  }
  const expectedCompletion = tasks.length ? Math.round((completed / tasks.length) * 1000) / 10 : 0;
  if (completion !== expectedCompletion) throw new Error(`Completion must be ${expectedCompletion}%, not ${completion}%.`);
  if (next && next !== "None") {
    const nextTask = next.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
    if (!nextTask || !tasks.some((task) => task.id === nextTask[1] && task.title === nextTask[2])) {
      throw new Error("Next Task must match one explicit row in the canonical ledger.");
    }
  }

  const row = currentRows[0];
  if (status === "IN_PROGRESS") {
    if (row.marker !== "~") throw new Error(`Current task ${current[1]} is IN_PROGRESS but its ledger row is not [~].`);
    return { source, changed: false, id: current[1], title: current[2] };
  }
  if (status !== "READY") throw new Error(`Queue cannot claim a task in ${status ?? "an unset"} state.`);
  if (row.marker !== " ") throw new Error(`Current task ${current[1]} is READY but its ledger row is not [ ].`);

  const updated = source
    .replace(`- Current Task Status: READY`, "- Current Task Status: IN_PROGRESS")
    .replace(`- [ ] ${current[1]} — ${current[2]}`, `- [~] ${current[1]} — ${current[2]}`);
  if (updated === source) throw new Error(`Could not claim the explicit current task ${current[1]}.`);
  return { source: updated, changed: true, id: current[1], title: current[2] };
}

function git(...args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function normalizeRepository(value) {
  return value.replace(/\.git$/, "").replace(/\/+/g, "/").toLowerCase();
}

async function runQueueClaim() {
  const source = await readFile(trackerPath, "utf8");
  const claim = claimCurrentTask(source);
  const branch = field(source, "Tracking Branch");
  const trackingRepository = field(source, "Tracking Repository");
  if (!branch || !trackingRepository) throw new Error("Tracking Branch and Tracking Repository must be explicit.");
  if (git("branch", "--show-current") !== branch) throw new Error(`Queue claims run only on tracked branch ${branch}.`);
  if (normalizeRepository(git("remote", "get-url", "origin")) !== normalizeRepository(trackingRepository)) {
    throw new Error("origin does not match the canonical Tracking Repository in TASKS.md.");
  }
  const head = git("rev-parse", "HEAD");
  const remoteHead = git("rev-parse", `origin/${branch}`);
  if (head !== remoteHead) throw new Error(`Local ${branch} must exactly match origin/${branch} before a queue claim.`);
  if (git("diff", "--cached", "--name-only")) throw new Error("Uncommitted staged changes exist; queue claim refused.");
  if (git("status", "--porcelain", "--", "TASKS.md")) throw new Error("TASKS.md already has local changes; queue claim refused to preserve them.");

  if (!claim.changed) {
    console.log(`Autonomous Queue: ${claim.id} is already claimed (${field(source, "Current Task Status")}).`);
    return;
  }

  if (existsSync(temporaryTrackerPath)) throw new Error("TASKS.md.claim.tmp already exists; queue claim refused.");
  await writeFile(temporaryTrackerPath, claim.source, "utf8");
  try {
    await rename(temporaryTrackerPath, trackerPath);
    execFileSync(process.execPath, [resolve(repositoryRoot, "scripts/codex/validate-task-state.mjs")], { cwd: repositoryRoot, stdio: "inherit" });
    git("add", "--", "TASKS.md");
    git("commit", "-m", `chore(tasks): claim ${claim.id}`);
    git("push", "origin", branch);
    console.log(`Autonomous Queue claimed and published ${claim.id}: ${claim.title}`);
  } catch (error) {
    try {
      await unlink(temporaryTrackerPath);
    } catch {
      // The temporary file has already been renamed or did not need removal.
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await runQueueClaim();
  } catch (error) {
    console.error(`Autonomous Queue stopped before implementation: ${error.message}`);
    process.exitCode = 1;
  }
}
