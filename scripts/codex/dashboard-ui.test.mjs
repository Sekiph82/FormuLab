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

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

function allText(element) {
  return [element.textContent, ...element.children.map(allText)].join(" ");
}

test("keeps the last successful project view when a refresh fails", async () => {
  const selectors = ["#projects", "#notice", "#search", "#project-select", "#selected-project", "#task-summary", "#task-details", "#refresh", "#project-count", "#thread-count", "#task-id", "#task-title", "#task-status", "#task-scope", "#next-task", "#completion", "#project-subtitle", "#updated", "#source", "#theme-toggle"];
  const elements = new Map(selectors.map((selector) => [selector, new FakeElement()]));
  let refreshTimer;
  let fetchCount = 0;
  const overview = {
    generatedAt: "2026-10-22T10:00:00.000Z",
    source: "Codex App Server read-only APIs",
    projectListState: "available",
    projectCount: 1,
    activeThreadCount: 1,
    truncated: false,
    task: {
      milestone: "DEVX-01",
      sprint: "DEVX-01-S01",
      currentTask: { id: "DEVX-01.006", title: "Curate project list" },
      currentTaskStatus: "IN_PROGRESS",
      nextTask: "FVL-11.001 — Acceptance matrix",
      completion: "91.6%",
    },
    projects: [{
      id: "project-1",
      name: "FormuLab",
      roots: ["C:\\work\\FormuLab"],
      threads: [{ id: "thread-1", title: "Visible task", cwd: "C:\\work\\FormuLab", status: "running", updatedAt: null, source: "Codex" }],
    }, {
      id: "project-2",
      name: "Wonder_Pop",
      repositoryUrl: "https://github.com/Sekiph82/Wonder_Pop",
      roots: [],
      threads: [{ id: "thread-2", title: "Other project's work", cwd: "C:\\work\\Wonder_Pop", status: "needsAttention", updatedAt: null, source: "Codex" }],
    }],
  };
  const document = {
    querySelector(selector) {
      return elements.get(selector);
    },
    createElement() {
      return new FakeElement();
    },
    documentElement: { dataset: {} },
  };
  const fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) return { ok: true, async json() { return overview; } };
    return { ok: false, async json() { return { error: "Codex App Server data is temporarily unavailable." }; } };
  };

  runInNewContext(await readFile(dashboardPath, "utf8"), {
    document,
    window: { matchMedia() { return { matches: false }; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch,
    setInterval(callback) { refreshTimer = callback; },
    Date,
    Number,
    String,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(allText(elements.get("#projects")).includes("Visible task"), true);
  assert.equal(elements.get("#project-count").textContent, "1");
  assert.equal(elements.get("#project-select").value, "project-1");
  assert.equal(elements.get("#task-status").textContent, "IN_PROGRESS");
  assert.match(allText(elements.get("#selected-project")), /1 active Codex task/);
  assert.equal(elements.get("#task-summary").hidden, false);
  assert.equal(elements.get("#task-details").hidden, false);

  elements.get("#project-select").value = "project-2";
  elements.get("#project-select").listeners.get("change")();
  assert.equal(allText(elements.get("#projects")).includes("Other project's work"), true);
  assert.equal(allText(elements.get("#projects")).includes("Visible task"), false);
  assert.equal(elements.get("#task-summary").hidden, true);
  assert.equal(elements.get("#task-details").hidden, true);
  assert.match(allText(elements.get("#selected-project")), /1 active Codex task/);

  await refreshTimer();

  assert.equal(allText(elements.get("#projects")).includes("Other project's work"), true);
  assert.equal(elements.get("#project-count").textContent, "1");
  assert.match(elements.get("#notice").textContent, /Showing the last successful data/);
});
