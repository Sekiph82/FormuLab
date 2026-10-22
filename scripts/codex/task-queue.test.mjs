import assert from "node:assert/strict";
import { test } from "node:test";
import { claimCurrentTask } from "./task-queue.mjs";

const readyQueue = `# FormuLab — Canonical GitHub Task State

## Project Status
- Current Milestone: TEST-01
- Current Sprint: TEST-01-S01
- Current Task: TEST-01.002 — Implement queue claim
- Current Task Status: READY
- Next Task: TEST-01.003 — Verify queue claim
- Required Actor: CODEX
- Tracking Repository: https://github.com/Sekiph82/FormuLab
- Tracking Branch: main

## Progress
- Total Tasks: 3
- Completed Tasks: 1
- Remaining Tasks: 2
- Completion: 33.3%

- [x] TEST-01.001 — Define queue
- [ ] TEST-01.002 — Implement queue claim
- [ ] TEST-01.003 — Verify queue claim
`;

test("claims only the explicitly current READY task and preserves queue order", () => {
  const result = claimCurrentTask(readyQueue);

  assert.equal(result.changed, true);
  assert.match(result.source, /Current Task Status: IN_PROGRESS/);
  assert.match(result.source, /- \[~\] TEST-01\.002 — Implement queue claim/);
  assert.match(result.source, /Next Task: TEST-01\.003 — Verify queue claim/);
  assert.match(result.source, /Completed Tasks: 1\n- Remaining Tasks: 2\n- Completion: 33\.3%/);
});

test("is idempotent for a valid in-progress queue claim", () => {
  const claimed = claimCurrentTask(readyQueue).source;
  const result = claimCurrentTask(claimed);

  assert.equal(result.changed, false);
  assert.equal(result.source, claimed);
});

test("refuses to infer a task or claim a blocked task", () => {
  assert.throws(() => claimCurrentTask(readyQueue.replace("TEST-01.002 — Implement queue claim", "TEST-01.099 — Untracked task")), /match exactly one ledger row/);
  assert.throws(() => claimCurrentTask(readyQueue.replace("Current Task Status: READY", "Current Task Status: BLOCKED")), /cannot claim a task in BLOCKED state/);
});

test("refuses a queue with mismatched task counts", () => {
  assert.throws(() => claimCurrentTask(readyQueue.replace("Completed Tasks: 1", "Completed Tasks: 2")), /totals do not match/);
});
