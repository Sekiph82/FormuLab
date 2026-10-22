import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export class CodexAppServerClient {
  #child;
  #pending = new Map();
  #nextId = 1;
  #failure;
  #closed = false;

  constructor({ executable = process.env.CODEX_CLI || "codex" } = {}) {
    this.#child = spawn(executable, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });

    this.#child.on("error", (error) => this.#fail(error));
    this.#child.on("close", (code) => {
      if (!this.#closed) this.#fail(new Error(`Codex App Server exited (${code ?? "unknown"}).`));
    });

    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
  }

  async initialize() {
    const result = await this.#request("initialize", {
      clientInfo: {
        name: "formulab_codex_project_dashboard",
        title: "FormuLab Codex Project Dashboard",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.#notify("initialized", {});
    return result;
  }

  async listProjects() {
    const rows = await this.#listPages("project/list", {});
    return rows;
  }

  request(method, params) {
    return this.#request(method, params);
  }

  async listThreads() {
    const active = await this.#listPages("thread/list", {
      archived: false,
      limit: PAGE_LIMIT,
      sortKey: "updated_at",
      sortDirection: "desc",
      useStateDbOnly: true,
    });
    return active;
  }

  async #listPages(method, initialParams) {
    const rows = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = { ...initialParams, limit: PAGE_LIMIT };
      if (cursor) params.cursor = cursor;
      const response = await this.#request(method, params);
      const pageRows = response?.data ?? response?.projects ?? response?.threads ?? [];
      if (!Array.isArray(pageRows)) throw new Error(`${method} returned an invalid page.`);
      rows.push(...pageRows);
      cursor = response?.nextCursor ?? null;
      if (!cursor) return { rows, truncated: false };
    }
    return { rows, truncated: Boolean(cursor) };
  }

  #request(method, params) {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#closed || this.#child.stdin.destroyed) {
      return Promise.reject(new Error("Codex App Server is not available."));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex App Server timed out on ${method}.`));
      }, 15000);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error("Could not send request to Codex App Server."));
      });
    });
  }

  #notify(method, params) {
    if (this.#closed || this.#child.stdin.destroyed) return;
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || `Codex App Server rejected ${pending.method}.`);
      error.code = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  #fail(error) {
    if (this.#failure) return;
    this.#failure = new Error(error?.message || "Codex App Server failed.");
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.#failure);
    }
    this.#pending.clear();
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex App Server client closed."));
    }
    this.#pending.clear();
    if (this.#child.exitCode !== null) return;
    this.#child.kill();
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      this.#child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
