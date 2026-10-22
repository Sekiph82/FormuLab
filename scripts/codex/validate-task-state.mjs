import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const trackerPath = resolve(repositoryRoot, "TASKS.md");

function fail(message) {
  console.error(`TASKS.md validation failed: ${message}`);
  process.exitCode = 1;
}

const source = await readFile(trackerPath, "utf8");
const lines = source.split(/\r?\n/);
const field = (name) => {
  const match = source.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
};
const tasks = lines.flatMap((line) => {
  const match = line.match(/^- \[([ x~!])\] ([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
  return match ? [{ status: match[1], id: match[2], title: match[3] }] : [];
});

const currentField = field("Current Task");
const current = currentField === "None" ? null : currentField?.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
const currentStatus = field("Current Task Status");
const requiredActor = field("Required Actor");
const next = field("Next Task");
const total = Number(field("Total Tasks"));
const completed = Number(field("Completed Tasks"));
const remaining = Number(field("Remaining Tasks"));
const completion = Number(field("Completion")?.replace(/%$/, ""));

if (!current && currentField !== "None") fail("Current Task must contain one explicit task ID and title, or None when the queue is complete.");
if (requiredActor !== "CODEX") fail(`Required Actor must be CODEX; found ${requiredActor ?? "missing"}.`);
if (tasks.length !== total) fail(`Total Tasks says ${total}, but the checkbox ledger has ${tasks.length} tasks.`);

const actualCompleted = tasks.filter((task) => task.status === "x").length;
const actualRemaining = tasks.length - actualCompleted;
const actualCompletion = tasks.length ? Math.round((actualCompleted / tasks.length) * 1000) / 10 : 0;
if (completed !== actualCompleted) fail(`Completed Tasks says ${completed}; checkbox ledger has ${actualCompleted}.`);
if (remaining !== actualRemaining) fail(`Remaining Tasks says ${remaining}; checkbox ledger has ${actualRemaining}.`);
if (completion !== actualCompletion) fail(`Completion says ${completion}%; checkbox ledger gives ${actualCompletion}%.`);

if (current) {
  const matches = tasks.filter((task) => task.id === current[1]);
  if (matches.length !== 1) fail(`Current Task ${current[1]} must appear exactly once in the checkbox ledger.`);
  else {
    const expectedMarker = { READY: " ", IN_PROGRESS: "~", BLOCKED: "!" }[currentStatus];
    if (!expectedMarker) fail(`Unsupported Current Task Status: ${currentStatus ?? "missing"}.`);
    else if (matches[0].status !== expectedMarker) {
      fail(`Current Task Status ${currentStatus} does not match [${matches[0].status}] for ${current[1]}.`);
    }
    if (matches[0].title !== current[2]) fail(`Current Task title does not match ledger row ${current[1]}.`);
  }
}
if (currentField === "None" && (currentStatus !== "COMPLETE" || next !== "None" || actualRemaining !== 0)) {
  fail("Current Task may be None only when Current Task Status is COMPLETE, Next Task is None, and every task is complete.");
}

const inProgress = tasks.filter((task) => task.status === "~");
if (inProgress.length > 1) fail(`Only one task may be in progress; found ${inProgress.map((task) => task.id).join(", ")}.`);
if (currentStatus === "IN_PROGRESS" && inProgress[0]?.id !== current?.[1]) {
  fail("The explicitly current task is not the only in-progress task.");
}

if (next && next !== "None") {
  const nextMatch = next.match(/^([A-Z][A-Z0-9]*-\d+\.\d+) — (.+)$/);
  if (!nextMatch) fail("Next Task must contain one explicit task ID and title, or None.");
  else if (!tasks.some((task) => task.id === nextMatch[1] && task.title === nextMatch[2])) {
    fail(`Next Task ${nextMatch[1]} does not match a checkbox row.`);
  }
}

if (process.exitCode !== 1) {
  console.log(`TASKS.md valid: ${completed}/${total} complete; current ${current?.[1] ?? "unset"} (${currentStatus}).`);
}
