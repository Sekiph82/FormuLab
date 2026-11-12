import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const trackerPath = resolve(repositoryRoot, "TASKS.md");
const temporaryTrackerPath = resolve(repositoryRoot, "TASKS.md.claim.tmp");

function field(source, name) {
  const matches = [...source.matchAll(new RegExp(`^- ${name}:\\s*(.+)$`, "gm"))];
  if (matches.length !== 1) throw new Error(`${name} must appear exactly once in TASKS.md.`);
  return matches[0][1].trim();
}

function readTasks(source) {
  const lines = source.split(/\r?\n/);
  const taskHeadings = lines.flatMap((line, index) => line === "## Tasks" ? [index] : []);
  if (taskHeadings.length !== 1) throw new Error("TASKS.md must contain exactly one canonical ## Tasks ledger.");
  const historicalHeading = lines.findIndex((line, index) => index > taskHeadings[0] && line === "## Historical Detail & Evidence");
  const end = historicalHeading < 0 ? lines.length : historicalHeading;
  const tasks = [];
  for (const line of lines.slice(taskHeadings[0] + 1, end)) {
    const match = line.match(/^- \[([ x~!])\] ([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
    if (match) {
      tasks.push({ marker: match[1], id: match[2], title: match[3] });
      continue;
    }
    if (/^- /.test(line) || /\b[A-Z][A-Z0-9]*-\d+\.\d+\b/.test(line)) {
      throw new Error(`Malformed task row in canonical ledger: ${line}`);
    }
  }
  return tasks;
}

export function claimCurrentTask(source) {
  const tasks = readTasks(source);
  const currentField = field(source, "Current Task");
  const current = currentField === "None" ? null : currentField?.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
  const status = field(source, "Current Task Status");
  const actor = field(source, "Required Actor");
  const next = field(source, "Next Task");
  const total = Number(field(source, "Total Tasks"));
  const completed = Number(field(source, "Completed Tasks"));
  const remaining = Number(field(source, "Remaining Tasks"));
  const completion = Number(field(source, "Completion")?.replace(/%$/, ""));

  if (actor !== "CODEX") throw new Error(`Required Actor must be CODEX; found ${actor ?? "missing"}.`);
  if (!next) throw new Error("Next Task must be explicit, or set to None, before the queue can start.");
  if (tasks.length !== total) throw new Error(`TASKS.md says ${total} tasks, but its ledger has ${tasks.length}.`);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Task IDs must be unique before claiming work.");
  if (completed !== tasks.filter((task) => task.marker === "x").length || remaining !== tasks.length - completed) {
    throw new Error("Task totals do not match the canonical checkbox ledger.");
  }
  const expectedCompletion = tasks.length ? Math.round((completed / tasks.length) * 1000) / 10 : 0;
  if (completion !== expectedCompletion) throw new Error(`Completion must be ${expectedCompletion}%, not ${completion}%.`);
  if (currentField === "None") {
    if (status !== "COMPLETE" || next !== "None" || completed !== total) {
      throw new Error("Current Task may be None only when the explicit queue is complete.");
    }
    return { source, changed: false, complete: true, id: null, title: null };
  }
  if (!current) throw new Error("Current Task must explicitly identify one task before the queue can start it.");
  const currentRows = tasks.filter((task) => task.id === current[1] && task.title === current[2]);
  if (currentRows.length !== 1) throw new Error(`Current Task ${current[1]} must match exactly one ledger row.`);
  if (next && next !== "None") {
    const nextTask = next.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
    if (!nextTask || !tasks.some((task) => task.id === nextTask[1] && task.title === nextTask[2])) {
      throw new Error("Next Task must match one explicit row in the canonical ledger.");
    }
  }

  const row = currentRows[0];
  const expectedMarker = { READY: " ", IN_PROGRESS: "~", BLOCKED: "!" }[status];
  if (!expectedMarker) throw new Error(`Unsupported Current Task Status: ${status}.`);
  if (row.marker !== expectedMarker) throw new Error(`Current Task Status ${status} does not match its canonical checkbox row.`);
  if (status === "IN_PROGRESS") {
    return { source, changed: false, id: current[1], title: current[2] };
  }
  if (status !== "READY") throw new Error(`Queue cannot claim a task in ${status ?? "an unset"} state.`);

  const updated = source
    .replace(`- Current Task Status: READY`, "- Current Task Status: IN_PROGRESS")
    .replace(`- [ ] ${current[1]} — ${current[2]}`, `- [~] ${current[1]} — ${current[2]}`);
  if (updated === source) throw new Error(`Could not claim the explicit current task ${current[1]}.`);
  return { source: updated, changed: true, id: current[1], title: current[2] };
}

export function matchesExpectedQueueClaim(parentTracker, actualTracker, currentTaskId) {
  const expected = claimCurrentTask(parentTracker);
  return expected.changed && expected.id === currentTaskId && expected.source === actualTracker;
}

export function isRecoverableQueueClaim({ aheadCount, subject, changedFiles, clean, mergeBaseIsRemote, contentMatchesClaim, branch, expectedBranch, currentTaskId }) {
  return aheadCount === 1 &&
    subject === `chore(tasks): claim ${currentTaskId}` &&
    changedFiles.length === 1 && changedFiles[0] === "TASKS.md" &&
    clean && mergeBaseIsRemote && contentMatchesClaim && branch === expectedBranch;
}

function git(...args) {
  return gitRaw(...args).trim();
}

function gitRaw(...args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function runQueueClaim() {
  const source = await readFile(trackerPath, "utf8");
  const claim = claimCurrentTask(source);
  const branch = field(source, "Tracking Branch");
  if (!branch) throw new Error("Tracking Branch must be explicit.");
  if (git("branch", "--show-current") !== branch) throw new Error(`Queue claims run only on tracked branch ${branch}.`);
  const head = git("rev-parse", "HEAD");
  if (claim.complete) {
    if (git("status", "--porcelain", "--", "TASKS.md") || gitRaw("show", "HEAD:TASKS.md") !== source) {
      throw new Error("Queue completion must be committed locally and identical to HEAD before it is accepted.");
    }
    console.log("Autonomous Queue complete: no tasks remain.");
    return;
  }
  if (git("diff", "--cached", "--name-only")) throw new Error("Uncommitted staged changes exist; queue claim refused.");
  if (git("status", "--porcelain", "--", "TASKS.md")) throw new Error("TASKS.md already has local changes; queue claim refused to preserve them.");

  if (!claim.changed) {
    console.log(`Autonomous Queue: ${claim.id} is already claimed (${field(source, "Current Task Status")}).`);
    return;
  }

  if (existsSync(temporaryTrackerPath)) throw new Error("TASKS.md.claim.tmp already exists; queue claim refused.");
  await writeFile(temporaryTrackerPath, claim.source, "utf8");
  let stagedByQueue = false;
  try {
    await rename(temporaryTrackerPath, trackerPath);
    execFileSync(process.execPath, [resolve(repositoryRoot, "scripts/codex/validate-task-state.mjs")], { cwd: repositoryRoot, stdio: "inherit" });
    git("add", "--", "TASKS.md");
    stagedByQueue = true;
    git("commit", "-m", `chore(tasks): claim ${claim.id}`);
    stagedByQueue = false;
    console.log(`Autonomous Queue claimed locally ${claim.id}: ${claim.title}`);
  } catch (error) {
    if (git("rev-parse", "HEAD") === head) {
      if (stagedByQueue) git("restore", "--staged", "--", "TASKS.md");
      await writeFile(trackerPath, source, "utf8");
    }
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
