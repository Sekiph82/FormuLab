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

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }
}

function allText(element) {
  return [element.textContent, ...element.children.map(allText)].join(" ");
}

test("keeps the last successful project view when a refresh fails", async () => {
  const selectors = ["#projects", "#notice", "#search", "#refresh", "#project-count", "#thread-count", "#task-id", "#task-title", "#updated", "#source"];
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
    task: { currentTask: { id: "DEVX-01.005", title: "Dashboard recovery" } },
    projects: [{
      id: "project-1",
      name: "FormuLab",
      roots: ["C:\\work\\FormuLab"],
      threads: [{ id: "thread-1", title: "Visible task", cwd: "C:\\work\\FormuLab", status: "idle", updatedAt: null, source: "Codex" }],
    }],
  };
  const document = {
    querySelector(selector) {
      return elements.get(selector);
    },
    createElement() {
      return new FakeElement();
    },
  };
  const fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) return { ok: true, async json() { return overview; } };
    return { ok: false, async json() { return { error: "Codex App Server data is temporarily unavailable." }; } };
  };

  runInNewContext(await readFile(dashboardPath, "utf8"), {
    document,
    fetch,
    setInterval(callback) { refreshTimer = callback; },
    Date,
    Number,
    String,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(allText(elements.get("#projects")).includes("Visible task"), true);
  assert.equal(elements.get("#project-count").textContent, "1");

  await refreshTimer();

  assert.equal(allText(elements.get("#projects")).includes("Visible task"), true);
  assert.equal(elements.get("#project-count").textContent, "1");
  assert.match(elements.get("#notice").textContent, /Showing the last successful data/);
});
