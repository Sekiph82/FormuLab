import assert from "node:assert/strict";
import { test } from "node:test";
import { claimCurrentTask, isRecoverableQueueClaim, matchesExpectedQueueClaim } from "./task-queue.mjs";

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

## Tasks
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
  assert.throws(() => claimCurrentTask(readyQueue.replace("Current Task Status: READY", "Current Task Status: BLOCKED").replace("- [ ] TEST-01.002", "- [!] TEST-01.002")), /cannot claim a task in BLOCKED state/);
});

test("refuses a queue with mismatched task counts", () => {
  assert.throws(() => claimCurrentTask(readyQueue.replace("Completed Tasks: 1", "Completed Tasks: 2")), /totals do not match/);
});

test("rejects duplicate authority fields and malformed canonical task rows", () => {
  assert.throws(() => claimCurrentTask(readyQueue.replace("- Current Task Status: READY", "- Current Task Status: READY\n- Current Task Status: BLOCKED")), /Current Task Status must appear exactly once/);
  assert.throws(() => claimCurrentTask(readyQueue.replace("- [ ] TEST-01.003", "- [?] TEST-01.003")), /Malformed task row in canonical ledger/);
  assert.throws(() => claimCurrentTask(readyQueue.replace("- [ ] TEST-01.003 — Verify queue claim", "- malformed row").replace("Total Tasks: 3", "Total Tasks: 2").replace("Remaining Tasks: 2", "Remaining Tasks: 1").replace("Completion: 33.3%", "Completion: 50%")), /Malformed task row in canonical ledger/);
});

test("only retries a single unpublished claim commit on the unchanged remote base", () => {
  const safeRecovery = {
    aheadCount: 1,
    subject: "chore(tasks): claim TEST-01.002",
    changedFiles: ["TASKS.md"],
    clean: true,
    mergeBaseIsRemote: true,
    contentMatchesClaim: true,
    branch: "main",
    expectedBranch: "main",
    currentTaskId: "TEST-01.002",
  };
  assert.equal(isRecoverableQueueClaim(safeRecovery), true);
  assert.equal(isRecoverableQueueClaim({ ...safeRecovery, changedFiles: ["TASKS.md", "README.md"] }), false);
  assert.equal(isRecoverableQueueClaim({ ...safeRecovery, mergeBaseIsRemote: false }), false);
  assert.equal(isRecoverableQueueClaim({ ...safeRecovery, contentMatchesClaim: false }), false);
});

test("matches exact queue recovery bytes including the final newline", () => {
  const expectedClaim = claimCurrentTask(readyQueue);
  assert.equal(readyQueue.endsWith("\n"), true);
  assert.equal(matchesExpectedQueueClaim(readyQueue, expectedClaim.source, "TEST-01.002"), true);
  assert.equal(matchesExpectedQueueClaim(readyQueue, expectedClaim.source.trimEnd(), "TEST-01.002"), false);
  assert.equal(matchesExpectedQueueClaim(readyQueue, expectedClaim.source, "TEST-01.003"), false);
});

test("matches exact queue recovery bytes when the Git blobs use CRLF", () => {
  const crlfQueue = readyQueue.replace(/\n/g, "\r\n");
  const expectedClaim = claimCurrentTask(crlfQueue);

  assert.equal(expectedClaim.source.endsWith("\r\n"), true);
  assert.equal(matchesExpectedQueueClaim(crlfQueue, expectedClaim.source, "TEST-01.002"), true);
  assert.equal(matchesExpectedQueueClaim(crlfQueue, expectedClaim.source.replace(/\r\n/g, "\n"), "TEST-01.002"), false);
});
