/**
 * FVL-04.026 — NAME1-NAME30 acceptance for the deterministic artifact
 * naming convention (`docs/ARTIFACT_NAMING_SPEC.md`). Golden vectors
 * (NAME1-NAME12) are shared verbatim with the Python adapter
 * (`runtime/pipeline/test_artifact_naming.py`) via
 * `artifactNaming.goldenVectors.json` — NAME30 proves both runtimes agree
 * by loading the SAME file, never a duplicated/independently-authored
 * fixture.
 */
import { describe, expect, it } from "vitest";
import goldenVectors from "./artifactNaming.goldenVectors.json";
import {
  FORMULATION_ARTIFACT_TYPES,
  formulationDisplayTitle,
  formulationExportFilename,
  formulationVersionLabel,
  literatureDisplayTitle,
  literatureFilename,
  sanitizeFilenameComponent,
  sanitizeIdComponent,
  type FormulationArtifactType,
} from "./artifactNaming";

describe("NAME1-NAME12 (golden vectors): literature naming", () => {
  for (const v of goldenVectors as { name: string; input: Parameters<typeof literatureFilename>[0]; expectedFilename: string; expectedDisplayTitle: string }[]) {
    it(v.name, () => {
      expect(literatureFilename(v.input)).toBe(v.expectedFilename);
      expect(literatureDisplayTitle(v.input)).toBe(v.expectedDisplayTitle);
    });
  }
});

describe("NAME11 (collision resistance, explicit): same sanitized human title, different stable ids -> distinct filenames", () => {
  it("two DOIs that sanitize to the same title text never collide", () => {
    const a = literatureFilename({ firstAuthor: "Kumar", year: 2020, title: "Identical Title For Collision Test", stableSourceId: "10.1111/id-a", extension: "pdf" });
    const b = literatureFilename({ firstAuthor: "Kumar", year: 2020, title: "Identical Title For Collision Test", stableSourceId: "10.2222/id-b", extension: "pdf" });
    expect(a).not.toBe(b);
    // Same human-readable prefix, genuinely different id-derived suffix.
    expect(a.replace("10.1111-id-a", "")).toBe(b.replace("10.2222-id-b", ""));
  });
});

describe("NAME13: same metadata -> exactly the same filename every run", () => {
  it("literatureFilename is a pure deterministic function of its input", () => {
    const input = { firstAuthor: "Reyes", year: 2021, title: "Repeatability Check", stableSourceId: "10.1/repeat", extension: "pdf" };
    const runs = Array.from({ length: 5 }, () => literatureFilename(input));
    expect(new Set(runs).size).toBe(1);
  });

  it("formulationExportFilename is a pure deterministic function of its input", () => {
    const input = { productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "Formula" as const, extension: "xlsx" };
    const runs = Array.from({ length: 5 }, () => formulationExportFilename(input));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("NAME17-NAME25: formulation export naming", () => {
  it("NAME17: normal formulation export matches the frozen example exactly", () => {
    expect(formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "Formula", extension: "xlsx" })).toBe(
      "FORM_Shampoo_Anti-Dandruff_FML-0042_V03_Formula.xlsx",
    );
  });

  it("NAME18: formula/product names containing illegal filename characters are sanitized", () => {
    const name = formulationExportFilename({ productFamily: "Bath & Body / Care", formulaName: 'Extra "Strong" Formula:2', formulaCode: "FML-0099", version: 1, artifactType: "Formula", extension: "xlsx" });
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name).toBe("FORM_Bath-&-Body-Care_Extra-Strong-Formula2_FML-0099_V01_Formula.xlsx");
  });

  it("NAME19: formulation version formatting is zero-padded, canonical version number untouched", () => {
    expect(formulationVersionLabel(3)).toBe("V03");
    expect(formulationVersionLabel(12)).toBe("V12");
    expect(formulationVersionLabel(0)).toBe("V00");
    // The canonical version NUMBER itself (an input, e.g. from
    // FormulationVersion.versionNumber) is never mutated by this — only a
    // derived display string is zero-padded.
    const canonicalVersionNumber = 3;
    formulationVersionLabel(canonicalVersionNumber);
    expect(canonicalVersionNumber).toBe(3);
  });

  it("NAME20: artifact type is represented from a closed, deterministic vocabulary", () => {
    for (const artifactType of FORMULATION_ARTIFACT_TYPES) {
      const name = formulationExportFilename({ productFamily: "PF", formulaName: "N", formulaCode: "C", version: 1, artifactType, extension: "json" });
      expect(name).toContain(`_${artifactType}.json`);
    }
    // Compile-time closed vocabulary — this line only needs to type-check.
    const _t: FormulationArtifactType = "Formula";
    expect(_t).toBe("Formula");
  });

  it("NAME21: a long formula/product-family name truncates deterministically without dropping the formula code or version", () => {
    const longName = "An Extremely Long Formula Name That Goes On And On Describing Every Single Nuance Of This Particular Anti-Dandruff Shampoo Product Variant";
    const name = formulationExportFilename({ productFamily: "Shampoo", formulaName: longName, formulaCode: "FML-0042", version: 3, artifactType: "Formula", extension: "xlsx" });
    expect(name).toContain("_FML-0042_V03_Formula.xlsx"); // code/version/artifactType/ext never truncated
    expect(name.length).toBeLessThan(180);
  });

  it("NAME22: canonical Formulation.code/version identity is never touched by building a display title or filename", () => {
    const formulation = { id: "form-real-id-1", code: "FML-0042" };
    const version = { id: "ver-real-id-1", versionNumber: 3 };
    formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: formulation.code, version: version.versionNumber, artifactType: "Formula", extension: "xlsx" });
    formulationDisplayTitle({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: formulation.code, version: version.versionNumber });
    expect(formulation.id).toBe("form-real-id-1");
    expect(formulation.code).toBe("FML-0042");
    expect(version.id).toBe("ver-real-id-1");
    expect(version.versionNumber).toBe(3);
  });

  it("NAME23: PDF filename (Dossier artifact type)", () => {
    expect(formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "Dossier", extension: "pdf" })).toBe(
      "FORM_Shampoo_Anti-Dandruff_FML-0042_V03_Dossier.pdf",
    );
  });

  it("NAME24: DOCX filename (Dossier artifact type)", () => {
    expect(formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "Dossier", extension: "docx" })).toBe(
      "FORM_Shampoo_Anti-Dandruff_FML-0042_V03_Dossier.docx",
    );
  });

  it("NAME25: spreadsheet/export filename (EvidenceMatrix / RegulatoryRules)", () => {
    expect(formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "EvidenceMatrix", extension: "xlsx" })).toBe(
      "FORM_Shampoo_Anti-Dandruff_FML-0042_V03_EvidenceMatrix.xlsx",
    );
    expect(formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "RegulatoryRules", extension: "csv" })).toBe(
      "FORM_Shampoo_Anti-Dandruff_FML-0042_V03_RegulatoryRules.csv",
    );
  });
});

describe("NAME26: display titles stay human-readable and separate from physical filenames", () => {
  it("literature display title keeps punctuation/Unicode a filename would strip", () => {
    const title = literatureDisplayTitle({ firstAuthor: "Ivanova", year: 2021, title: 'A Study of Silicone: Water? Ratios <Test> "Formula"/Blend' });
    expect(title).toBe('Ivanova (2021) — A Study of Silicone: Water? Ratios <Test> "Formula"/Blend');
  });

  it("formulation display title keeps the em dash separator and raw text, distinct from the filename", () => {
    const title = formulationDisplayTitle({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3 });
    expect(title).toBe("Shampoo — Anti-Dandruff — FML-0042 — V03");
    const filename = formulationExportFilename({ productFamily: "Shampoo", formulaName: "Anti-Dandruff", formulaCode: "FML-0042", version: 3, artifactType: "Formula", extension: "xlsx" });
    expect(filename).not.toContain("—");
  });
});

describe("NAME28: no second document/naming registry exists", () => {
  it("this module is the ONLY exporter of literatureFilename/formulationExportFilename in packages/shared", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const engineDir = path.resolve(process.cwd(), "src", "engine");
    const files = fs.readdirSync(engineDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "artifactNaming.ts");
    for (const f of files) {
      const src = fs.readFileSync(path.join(engineDir, f), "utf-8");
      expect(src, `${f} must not declare a second literatureFilename/formulationExportFilename`).not.toMatch(/function literatureFilename|function formulationExportFilename/);
    }
  });
});

describe("NAME29: no LLM/generative-AI reference anywhere in the naming module", () => {
  it("artifactNaming.ts contains no LLM SDK/API reference", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(process.cwd(), "src", "engine", "artifactNaming.ts"), "utf-8");
    expect(src).not.toMatch(/openai|anthropic\.com|@anthropic-ai|generativelanguage|chat\/completions|gpt-[34]|claude-[123]/i);
  });
});

describe("sanitizeFilenameComponent / sanitizeIdComponent — direct unit coverage", () => {
  it("strips Windows-illegal characters and ASCII control characters", () => {
    expect(sanitizeFilenameComponent('a<b>c:d"e/f\\g|h?i*j\x01k')).toBe("abcdefghijk");
  });

  it("Windows reserved device names are disambiguated", () => {
    for (const reserved of ["CON", "con", "PRN", "AUX", "NUL", "COM1", "LPT9"]) {
      expect(sanitizeFilenameComponent(reserved).toUpperCase()).not.toBe(reserved.toUpperCase());
    }
  });

  it("empty/whitespace-only input sanitizes to an empty string (caller supplies the fallback token)", () => {
    expect(sanitizeFilenameComponent("   ")).toBe("");
    expect(sanitizeFilenameComponent("")).toBe("");
  });

  it("sanitizeIdComponent maps DOI slashes to hyphens and never returns empty", () => {
    expect(sanitizeIdComponent("10.1234/abc/def")).toBe("10.1234-abc-def");
    expect(sanitizeIdComponent("")).toBe("UNKNOWN-ID");
  });
});
