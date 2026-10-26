import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const taskFile = resolve(repositoryRoot, "tasks.v01.md");

function singleField(source, name) {
  const matches = [...source.matchAll(new RegExp(`^- ${name}:\\s*(.+)$`, "gim"))];
  if (matches.length !== 1) throw new Error(`${name} must appear exactly once in tasks.v01.md.`);
  return matches[0][1].trim();
}

export function validateV01TaskState(source) {
  const tasks = source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^- \[([ x~!])\] \*\*V01-(\d{2})\.(\d{3}) - (.+?)\*\*: /);
    return match
      ? [{ marker: match[1], id: `V01-${match[2]}.${match[3]}`, milestone: Number(match[2]), ordinal: Number(match[3]), title: match[4] }]
      : [];
  });

  if (tasks.length === 0) throw new Error("No V01 task rows were found.");
  if (new Set(tasks.map(({ id }) => id)).size !== tasks.length) throw new Error("V01 task IDs must be unique.");
  for (let index = 1; index < tasks.length; index += 1) {
    const previous = tasks[index - 1];
    const current = tasks[index];
    if (current.milestone < previous.milestone || (current.milestone === previous.milestone && current.ordinal <= previous.ordinal)) {
      throw new Error(`V01 task order is not strictly increasing at ${current.id}.`);
    }
  }

  const total = Number(singleField(source, "Total tasks"));
  const completed = Number(singleField(source, "Completed"));
  const remaining = Number(singleField(source, "Remaining"));
  const completion = Number(singleField(source, "Completion").replace(/%$/, ""));
  const currentValue = singleField(source, "Current task");
  const currentStatus = singleField(source, "Current status");
  const nextValue = singleField(source, "Next task");

  if (total !== tasks.length) throw new Error(`Total tasks says ${total}; task ledger has ${tasks.length}.`);
  const actualCompleted = tasks.filter(({ marker }) => marker === "x").length;
  const actualRemaining = tasks.length - actualCompleted;
  const actualCompletion = Math.round((actualCompleted / tasks.length) * 1000) / 10;
  if (completed !== actualCompleted || remaining !== actualRemaining || completion !== actualCompletion) {
    throw new Error(`Progress counters do not match the ledger (${actualCompleted}/${tasks.length}, ${actualCompletion}%).`);
  }
  if (tasks.some(({ marker }) => marker === "!")) throw new Error("V01 task rows must not use blocked [!] states.");

  const inProgress = tasks.filter(({ marker }) => marker === "~");
  if (currentValue === "None") {
    if (currentStatus !== "COMPLETE" || nextValue !== "None" || actualRemaining !== 0 || inProgress.length !== 0) {
      throw new Error("Current task may be None only for a complete queue with no remaining or in-progress tasks.");
    }
  } else {
    const current = currentValue.match(/^(V01-\d{2}\.\d{3}) - (.+)$/);
    if (!current) throw new Error("Current task must contain one explicit V01 task ID and title, or None.");
    const index = tasks.findIndex(({ id }) => id === current[1]);
    if (index < 0 || tasks[index].title !== current[2]) throw new Error(`Current task ${current[1]} does not match a task row.`);
    if (currentStatus !== "IN PROGRESS" || tasks[index].marker !== "~" || inProgress.length !== 1 || inProgress[0].id !== current[1]) {
      throw new Error("Current task must be the only [~] row and status must be IN PROGRESS.");
    }
    if (tasks.slice(0, index).some(({ marker }) => marker !== "x")) {
      throw new Error("Every task preceding the current task must be complete in the exact plan order.");
    }
    if (tasks.slice(index + 1).some(({ marker }) => marker !== " ")) {
      throw new Error("Tasks after the current task must remain pending until their turn.");
    }

    const next = tasks[index + 1];
    if (!next) {
      if (nextValue !== "None") throw new Error("Next task must be None after the final task.");
    } else {
      const parsedNext = nextValue.match(/^(V01-\d{2}\.\d{3}) - (.+)$/);
      if (!parsedNext || parsedNext[1] !== next.id || parsedNext[2] !== next.title || next.marker !== " ") {
        throw new Error("Next task must identify the immediately following, not-yet-started task row.");
      }
    }
  }

  if (singleField(source, "Required actor") !== "CODEX" || singleField(source, "Branch") !== "V01") {
    throw new Error("V01 task authority must remain assigned to CODEX on branch V01.");
  }
  return { total, completed, remaining, completion, current: currentValue };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = validateV01TaskState(await readFile(taskFile, "utf8"));
    console.log(`V01 task plan valid: ${result.completed}/${result.total} complete; current ${result.current}.`);
  } catch (error) {
    console.error(`V01 task plan validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

