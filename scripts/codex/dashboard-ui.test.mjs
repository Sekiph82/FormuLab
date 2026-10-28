import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dashboardPath = resolve(dirname(fileURLToPath(import.meta.url)), "dashboard/dashboard.js");

class FakeElement {
  children = [];
  listeners = new Map();
  value = "";
  textContent = "";
  hidden = false;
  className = "";
  disabled = false;
  dataset = {};
  attributes = new Map();

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  matches(selector) {
    return selector.startsWith(".") && this.className.split(/\s+/).includes(selector.slice(1));
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

function allText(element) {
  return [element.textContent, ...element.children.map(allText)].join(" ");
}

function findAllByClass(element, className) {
  return [
    ...(element.className.split(/\s+/).includes(className) ? [element] : []),
    ...element.children.flatMap((child) => findAllByClass(child, className)),
  ];
}

test("keeps the last successful project view when a refresh fails", async () => {
  const selectors = ["#projects", "#threads", "#notice", "#search", "#project-select", "#selected-project", "#task-summary", "#task-details", "#owner-questions", "#questions-list", "#refresh", "#project-count", "#thread-count", "#task-id", "#task-title", "#task-status", "#task-scope", "#next-task", "#completion", "#project-subtitle", "#updated", "#source", "#theme-toggle"];
  const elements = new Map(selectors.map((selector) => [selector, new FakeElement()]));
  let refreshTimer;
  let refreshInterval;
  let fetchCount = 0;
  const overview = {
    generatedAt: "2026-10-22T10:00:00.000Z",
    source: "Codex App Server read-only APIs",
    projectListState: "available",
    projectCount: 2,
    activeThreadCount: 1,
    truncated: false,
    projects: [{
      id: "project-1",
      name: "Project Alpha",
      roots: ["C:\\work\\alpha"],
      workflowState: "available",
      jobs: [
        { id: "DEVX-01.003", task: "Build the live activity board", stage: "BUILD", round: 1, reviews: { rules: "pending", code: "pending", tests: "pending" }, reviewEvidence: { rules: "audit/rules.md", code: "audit/code.md", tests: "audit/tests.md" } },
        ...[1, 2, 3, 4, 5].map((number) => ({ id: `DEVX-01.00${number}`, task: `Merged job ${number}`, stage: "MERGED", round: 1, updatedAt: `2026-10-22T10:0${number}:00Z`, reviews: { rules: "pass", code: "pass", tests: "pass" } })),
        { id: "DEVX-01.006", task: "Merged job with missing date", stage: "MERGED", round: 1, reviews: { rules: "pass", code: "pass", tests: "pass" } },
        { id: "DEVX-01.007", task: "Merged job with invalid date", stage: "MERGED", round: 1, updatedAt: "not-a-date", reviews: { rules: "pass", code: "pass", tests: "pass" } },
      ],
      task: {
        milestone: "DEVX-01",
        sprint: "DEVX-01-S01",
        currentTask: { id: "DEVX-01.006", title: "Curate project list" },
        currentTaskStatus: "IN_PROGRESS",
        nextTask: "FVL-11.001 — Acceptance matrix",
        completion: "91.6%",
      },
      questions: [{ id: "Q-DEVX-01.004-1", question: "Which acceptance path should be used?", taskId: "DEVX-01.004", answer: null }],
      threads: [{ id: "thread-1", title: "Visible task", cwd: "C:\\work\\alpha", status: "running", updatedAt: null, source: "Codex" }],
    }, {
      id: "project-2",
      name: "Project Beta",
      roots: ["C:\\work\\beta"],
      workflowState: "available",
      jobs: [1, 2, 3, 4].map((number) => ({ id: `BETA-${number}`, task: `Beta merged job ${number}`, stage: "MERGED", round: 1, updatedAt: `2026-10-22T11:0${number}:00Z`, reviews: { rules: "pass", code: "pass", tests: "pass" } })),
      threads: [{ id: "thread-2", title: "Other project's work", cwd: "C:\\work\\beta", status: "needsAttention", updatedAt: null, source: "Codex" }],
    }],
  };
  const document = {
    activeElement: null,
    querySelector(selector) {
      return elements.get(selector);
    },
    createElement() {
      return new FakeElement();
    },
    documentElement: { dataset: {} },
  };
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "POST") return { ok: true, async json() { return { submittedAt: "2026-10-22T10:01:00Z" }; } };
    fetchCount += 1;
    if (fetchCount === 1) return { ok: true, async json() { return overview; } };
    return { ok: false, async json() { return { error: "Codex App Server data is temporarily unavailable." }; } };
  };

  runInNewContext(await readFile(dashboardPath, "utf8"), {
    document,
    window: { matchMedia() { return { matches: false }; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch,
    setInterval(callback, milliseconds) { refreshTimer = callback; refreshInterval = milliseconds; },
    Date,
    Number,
    String,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshInterval, 2_000);
  assert.equal(allText(elements.get("#projects")).includes("Visible task"), false);
  assert.equal(allText(elements.get("#threads")).includes("Visible task"), true);
  for (const stage of ["SPEC", "BUILD", "REVIEW", "APPROVE", "MERGED", "ESCALATED"]) {
    assert.equal(allText(elements.get("#projects")).includes(stage), true);
  }
  assert.equal(allText(elements.get("#projects")).includes("DEVX-01.003"), true);
  assert.equal(allText(elements.get("#projects")).includes("+4 more"), true);
  assert.equal(findAllByClass(elements.get("#projects"), "job-card").length, 4);
  const mergedColumn = findAllByClass(elements.get("#projects"), "board-column").find((column) => column.className.includes("stage-merged"));
  const visibleMergedCards = findAllByClass(mergedColumn, "job-card");
  assert.deepEqual(visibleMergedCards.map((card) => allText(card).match(/DEVX-01\.\d+/)?.[0]), ["DEVX-01.005", "DEVX-01.004", "DEVX-01.003"]);
  findAllByClass(elements.get("#projects"), "more-jobs")[0].listeners.get("click")();
  assert.equal(findAllByClass(elements.get("#projects"), "job-card").length, 8);
  assert.equal(allText(elements.get("#projects")).includes("Show fewer"), true);
  assert.equal(elements.get("#project-count").textContent, "2");
  assert.equal(elements.get("#project-select").value, "project-1");
  let jobCard = findAllByClass(elements.get("#projects"), "job-card")[0];
  let chips = jobCard.children.find((child) => child.className === "review-chips").children;
  assert.deepEqual(chips.map((chip) => [chip.textContent, chip.className]), [
    ["rules", "review-chip pending"],
    ["code", "review-chip pending"],
    ["tests", "review-chip pending"],
  ]);

  overview.projects[0].jobs[0].reviews = { rules: "pass", code: "pass", tests: "pass" };
  overview.projects[0].jobs[0].stage = "SPEC";
  elements.get("#project-select").listeners.get("change")();
  jobCard = findAllByClass(elements.get("#projects"), "job-card")[0];
  chips = jobCard.children.find((child) => child.className === "review-chips").children;
  assert.deepEqual(chips.map((chip) => chip.className), [
    "review-chip pass", "review-chip pending", "review-chip pending",
  ]);

  overview.projects[0].jobs[0].stage = "REVIEW";
  elements.get("#project-select").listeners.get("change")();
  jobCard = findAllByClass(elements.get("#projects"), "job-card")[0];
  chips = jobCard.children.find((child) => child.className === "review-chips").children;
  assert.deepEqual(chips.map((chip) => chip.className), [
    "review-chip pass", "review-chip pass", "review-chip pass",
  ]);

  assert.equal(elements.get("#task-status").textContent, "IN_PROGRESS");
  assert.match(allText(elements.get("#selected-project")), /1 active Codex task/);
  assert.equal(elements.get("#task-summary").hidden, false);
  assert.equal(elements.get("#task-details").hidden, false);
  assert.equal(elements.get("#owner-questions").hidden, false);
  assert.match(allText(elements.get("#questions-list")), /Which acceptance path should be used/);
  const questionCard = elements.get("#questions-list").children[0];
  const form = questionCard.children.find((child) => child.className === "answer-form");
  const input = form.children[0];
  input.value = "Use the existing acceptance matrix.";
  document.activeElement = input;
  await refreshTimer();
  assert.equal(elements.get("#questions-list").children[0].children.find((child) => child.className === "answer-form").children[0], input);
  assert.equal(input.value, "Use the existing acceptance matrix.");
  document.activeElement = null;
  await form.listeners.get("submit")({ preventDefault() {} });
  assert.equal(requests.some(({ url, options }) => url === "/api/owner-answers" && JSON.parse(options.body).projectId === "project-1" && JSON.parse(options.body).answer === "Use the existing acceptance matrix."), true);

  const requestsBeforeProjectChange = requests.length;
  elements.get("#project-select").value = "project-2";
  elements.get("#project-select").listeners.get("change")();
  assert.equal(requests.length, requestsBeforeProjectChange);
  assert.equal(allText(elements.get("#threads")).includes("Other project's work"), true);
  assert.equal(allText(elements.get("#threads")).includes("Visible task"), false);
  assert.equal(allText(elements.get("#projects")).includes("+1 more"), true);
  assert.deepEqual(findAllByClass(elements.get("#projects"), "job-card").map((card) => allText(card).match(/BETA-\d+/)?.[0]), ["BETA-4", "BETA-3", "BETA-2"]);
  assert.equal(elements.get("#task-summary").hidden, false);
  assert.equal(elements.get("#task-details").hidden, false);
  assert.match(allText(elements.get("#selected-project")), /1 active Codex task/);

  await refreshTimer();

  assert.equal(allText(elements.get("#threads")).includes("Other project's work"), true);
  assert.equal(elements.get("#project-count").textContent, "2");
  assert.match(elements.get("#notice").textContent, /Showing the last successful data/);
});
