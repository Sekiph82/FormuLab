/**
 * Section 24 — structural architecture guards proving the Connector
 * Management frontend never becomes a second business-rule authority:
 * no direct masterdata write bypassing the real bridge/commit layer, no
 * second Import History/Crosswalk store, no eval/new Function, no LLM
 * SDK reference, no vendor-specific production branch, no write-method
 * literal anywhere in this UI surface.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "components", "dataExchange", "connectors");
const LIB_FILES = ["connectorConnections.ts", "connectorTest.ts", "connectorFileInspect.ts"].map((f) => join(process.cwd(), "src", "lib", f));

function tsxFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
    .map((f) => join(DIR, f));
}

describe("CFUI27: no connector UI component performs a direct canonical write", () => {
  it("no .tsx component under connectors/ imports upsertRecords/deleteRecord from @/lib/masterdata directly", () => {
    for (const file of tsxFiles().filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(file, "utf-8");
      if (!src.includes('from "@/lib/masterdata"')) continue;
      const importLine = src.split("\n").find((l) => l.includes('from "@/lib/masterdata"')) ?? "";
      expect(importLine, `${file} must not import upsertRecords/deleteRecord from @/lib/masterdata directly`).not.toMatch(/\bupsertRecords\b|\bdeleteRecord\b/);
    }
  });

  it("the only real canonical-write path reachable from this UI is confirmConnectorImport() -> commitDataExchangeRows()", () => {
    const bridgeSrc = readFileSync(join(process.cwd(), "src", "lib", "connectorImportBridge.ts"), "utf-8");
    expect(bridgeSrc).toMatch(/commitDataExchangeRows/);
  });
});

describe("CFUI28 (structural): no plaintext credential field/keyword anywhere in the connector UI or its lib adapters", () => {
  it("no source file references a raw password/apiKey/bearer/connectionString field", () => {
    for (const file of [...tsxFiles(), ...LIB_FILES]) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${file} must not reference a raw credential field`).not.toMatch(/\bpassword\s*[:=]|\bapiKey\s*[:=]|\bconnectionString\s*[:=]/i);
    }
  });
});

describe("Section 26: security sweep over the new connector UI + config-adapter surface", () => {
  const files = [...tsxFiles(), ...LIB_FILES, join(process.cwd(), "..", "..", "packages", "shared", "src", "engine", "connectorConnection.ts")];

  it("no write-method literal (POST/PUT/PATCH/DELETE) anywhere in this surface", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${file} must not contain a write-method literal`).not.toMatch(/["'](POST|PUT|PATCH|DELETE)["']/);
    }
  });

  it("no eval/new Function/LLM SDK reference anywhere in this surface", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${file} must not contain eval/new Function`).not.toMatch(/\beval\(|new Function\(/);
      expect(src, `${file} must not reference an LLM SDK/API`).not.toMatch(/openai|anthropic\.com|@anthropic-ai|generativelanguage|chat\/completions/i);
    }
  });

  it("no vendor/customer-specific production branch anywhere in this surface", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${file} must not branch on a specific sourceSystemId/vendor/customer literal`).not.toMatch(/sourceSystem(Id)?\s*===\s*["']|vendor\s*===\s*["']|customer\s*===\s*["']/);
    }
  });

  it("no second Import History or Crosswalk collection name is introduced", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${file} must not declare a second import-history/crosswalk collection`).not.toMatch(/"connector_import_(jobs|history)"|"connector_crosswalks"|"data_exchange_import_jobs_v2"/);
    }
  });
});
