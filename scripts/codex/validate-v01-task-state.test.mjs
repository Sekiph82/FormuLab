import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateV01TaskState } from "./validate-v01-task-state.mjs";

const plan = await readFile(new URL("../../tasks.v01.md", import.meta.url), "utf8");
const activePlan = plan;

test("accepts the current ordered V01 task plan", () => {
  const result = validateV01TaskState(plan);
  const field = (name) => plan.match(new RegExp(`^- ${name}: (.+)$`, "mi"))?.[1].trim();
  assert.equal(result.total, 164);
  assert.equal(result.completed, Number(field("Completed")));
  assert.equal(result.remaining, Number(field("Remaining")));
  assert.equal(result.current, field("Current task"));
  assert.equal(result.completion, Number(field("Completion").replace(/%$/, "")));
});

test("rejects duplicate task IDs", () => {
  const duplicate = activePlan.replace(
    "V01-00.002 - Freeze no-duplication architecture boundaries",
    "V01-00.001 - Freeze no-duplication architecture boundaries",
  );
  assert.throws(() => validateV01TaskState(duplicate), /task IDs must be unique/);
});

test("rejects task rows placed out of order", () => {
  const outOfOrder = activePlan.replace(
    /(- \[x\] \*\*V01-00\.001[\s\S]*?\n)(- \[x\] \*\*V01-00\.002[^\n]*\n)/,
    "$2$1",
  );
  assert.throws(() => validateV01TaskState(outOfOrder), /not strictly increasing/);
});

test("rejects completion markers that skip ahead of the current task", () => {
  const nextId = activePlan.match(/^- Next task: (V01-\d{2}\.\d{3})/m)[1];
  const completed = Number(activePlan.match(/^- Completed: (\d+)$/m)[1]) + 1;
  const total = Number(activePlan.match(/^- Total tasks: (\d+)$/m)[1]);
  const remaining = total - completed;
  const completion = Math.round((completed / total) * 1000) / 10;
  const skipped = activePlan
    .replace(new RegExp(`^- \\[ \\] \\*\\*${nextId}`, "m"), (row) => row.replace("[ ]", "[x]"))
    .replace(/^- Completed: \d+$/m, `- Completed: ${completed}`)
    .replace(/^- Remaining: \d+$/m, `- Remaining: ${remaining}`)
    .replace(/^- Completion: [\d.]+%$/m, `- Completion: ${completion}%`);
  assert.throws(() => validateV01TaskState(skipped), /after the current task must remain pending/);
});

test("rejects inconsistent counts and blocked task markers", () => {
  const completed = Number(activePlan.match(/^- Completed: (\d+)$/m)[1]);
  const nextId = activePlan.match(/^- Next task: (V01-\d{2}\.\d{3})/m)[1];
  assert.throws(() => validateV01TaskState(activePlan.replace(/^- Completed: \d+$/m, `- Completed: ${completed + 1}`)), /Progress counters/);
  assert.throws(() => validateV01TaskState(activePlan.replace(new RegExp(`^- \\[ \\] \\*\\*${nextId}` , "m"), (row) => row.replace("[ ]", "[!]"))), /must not use blocked/);
});

test("requires the explicit current and immediate next tasks to match the ledger", () => {
  const nextId = activePlan.match(/^- Next task: (V01-\d{2}\.\d{3})/m)[1];
  const currentId = activePlan.match(/^- Current task: (V01-\d{2}\.\d{3})/m)[1];
  const alternativeNext = nextId.endsWith("001") ? nextId.replace(/\d{3}$/, "002") : nextId.replace(/\d{3}$/, String(Number(nextId.slice(-3)) + 1).padStart(3, "0"));
  assert.throws(() => validateV01TaskState(activePlan.replace(/^- Next task: .+$/m, (line) => line.replace(nextId, alternativeNext))), /immediately following/);
  assert.throws(() => validateV01TaskState(activePlan.replace(new RegExp(`^- \\[~\\] \\*\\*${currentId}` , "m"), (row) => row.replace("[~]", "[ ]"))), /only \[~\] row/);
});
