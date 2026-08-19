/**
 * FVL-04.016 — Mapping Profile Model acceptance (MAP1-MAP10), plus
 * TR15/TR16 (existing Data Exchange validator boundary, no direct commit).
 */
import { describe, expect, it } from "vitest";
import { applyMappingProfile, effectiveMappingProfileStatus, mappingProfileCode, validateMappingProfile, validateMappingProfileSupersession } from "./mappingProfile";
import { discoverSourceSchema } from "./schemaDiscovery";
import { stageCsvFile } from "./fileConnector";
import { previewDataExchangeImport } from "./dataExchangeValidation";
import { getDataExchangeTemplate } from "./dataExchangeRegistry";
import type { MappingProfile } from "../schemas/connector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

function csvFixture() {
  return stageCsvFile(
    "CHT_LIMS",
    "materials",
    "Chemical_ID,Chemical_Name,Vendor_ID,Vendor_Name,Price_USD\n883729,Decyl Glucoside,V-441,ABC Chemicals,3.20",
    opts,
  );
}

function schemaFor(staged: ReturnType<typeof csvFixture>) {
  return discoverSourceSchema("CHT_LIMS", [{ entity: "materials", records: staged.records }]);
}

function baseProfile(overrides: Partial<MappingProfile> = {}): MappingProfile {
  const merged: Omit<MappingProfile, "code"> = {
    schemaVersion: "1.0",
    profileId: "profile-1",
    profileName: "CHT_LIMS materials",
    sourceSystemId: "CHT_LIMS",
    sourceEntity: "materials",
    sourceSchemaFingerprint: "",
    profileVersion: 1,
    status: "active",
    fieldMappings: [],
    constantMappings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "test",
    ...overrides,
  };
  return { ...merged, code: mappingProfileCode(merged.profileId, merged.profileVersion) };
}

describe("MAP1: arbitrary source fields map to raw_materials", () => {
  it("Chemical_ID/Chemical_Name map to material_code/material_name", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [
        { sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "Chemical_Name", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
    });
    expect(validateMappingProfile(profile, schema)).toEqual([]);
    const result = applyMappingProfile(profile, staged.records[0]);
    const candidate = result.candidates.find((c) => c.targetTemplate === "raw_materials")!;
    expect(candidate.row).toMatchObject({ material_code: "883729", material_name: "Decyl Glucoside" });
  });
});

describe("MAP2: the same row fans into Supplier + MaterialSupplier + MaterialPrice", () => {
  it("one source record produces multiple canonical candidate rows", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [
        { sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "Chemical_Name", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "Vendor_ID", targetTemplate: "suppliers", targetField: "supplier_code" },
        { sourceField: "Vendor_Name", targetTemplate: "suppliers", targetField: "supplier_name" },
        { sourceField: "Chemical_ID", targetTemplate: "material_suppliers", targetField: "material_code" },
        { sourceField: "Vendor_ID", targetTemplate: "material_suppliers", targetField: "supplier_code" },
        { sourceField: "Chemical_ID", targetTemplate: "material_prices", targetField: "material_code" },
        { sourceField: "Vendor_ID", targetTemplate: "material_prices", targetField: "supplier_code" },
        { sourceField: "Price_USD", targetTemplate: "material_prices", targetField: "unit_price", transformations: [{ op: "parse_decimal", config: { decimalSeparator: "." } }] },
      ],
      constantMappings: [
        { targetTemplate: "material_prices", targetField: "currency", value: "USD" },
        { targetTemplate: "material_prices", targetField: "valid_from", value: "2026-01-01" },
      ],
    });
    expect(validateMappingProfile(profile, schema)).toEqual([]);
    const result = applyMappingProfile(profile, staged.records[0]);
    const targets = result.candidates.map((c) => c.targetTemplate).sort();
    expect(targets).toEqual(["material_prices", "material_suppliers", "raw_materials", "suppliers"]);
  });
});

describe("MAP3: a target field typo fails validation", () => {
  it("material_cude (typo) is reported as target_field_not_found", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [{ sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_cude" }],
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues.some((i) => i.code === "target_field_not_found")).toBe(true);
  });
});

describe("MAP4: missing required source input yields a structured mapping error", () => {
  it("a required target field with no mapping at all fails validation before any row is processed", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [{ sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" }],
      // material_name is required and has no mapping.
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_required_target_field", targetTemplate: "raw_materials", targetField: "material_name" }));
  });
});

describe("MAP5: a changed source schema fingerprint blocks an incompatible profile by default", () => {
  it("the profile's own recorded fingerprint no longer matches the current schema", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({ sourceSchemaFingerprint: "stale-fingerprint-from-a-different-schema" });
    const issues = validateMappingProfile(profile, schema);
    expect(issues).toEqual([{ code: "schema_fingerprint_mismatch", message: expect.stringContaining("stale-fingerprint-from-a-different-schema") }]);
  });
});

describe("MAP6/MAP7: profile version lineage; v1 remains immutable/readable after v2 exists", () => {
  it("a superseding v2 carries the EXACT immutable code of the version it replaces (never merely the logical profileId)", () => {
    const v1 = baseProfile({ profileId: "profile-1", profileVersion: 1, status: "active" });
    const v2 = baseProfile({ profileId: "profile-1", profileVersion: 2, status: "active", supersedesProfileCode: v1.code });
    expect(v1.profileVersion).toBe(1);
    expect(v2.supersedesProfileCode).toBe("profile-1::v1");
    expect(v1.code).not.toBe(v2.code); // exact version linkage, never ambiguous

    const staged = csvFixture();
    const result = applyMappingProfile({ ...v2, sourceSchemaFingerprint: schemaFor(staged).fingerprint, fieldMappings: [{ sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" }] }, staged.records[0]);
    expect(result.profileId).toBe("profile-1");
    expect(result.profileVersion).toBe(2);
  });
});

describe("FVL-04.016 hardening (Session 7, Part G): mapping-profile version lifecycle — derived supersession, exact chain, no impossible mutation", () => {
  it("effectiveMappingProfileStatus derives 'superseded' from the existence of a newer version, without ever mutating v1's own stored status", () => {
    const v1 = baseProfile({ profileId: "profile-1", profileVersion: 1, status: "active" });
    // Before v2 exists, v1 is still effectively active.
    expect(effectiveMappingProfileStatus(v1, [v1])).toBe("active");

    const v2 = baseProfile({ profileId: "profile-1", profileVersion: 2, status: "active", supersedesProfileCode: v1.code });
    const all = [v1, v2];
    expect(effectiveMappingProfileStatus(v1, all)).toBe("superseded");
    expect(effectiveMappingProfileStatus(v2, all)).toBe("active");
    // v1's own persisted object is never rewritten — its stored `status`
    // field is still literally "active"; only the DERIVED view changes.
    expect(v1.status).toBe("active");

    const v3 = baseProfile({ profileId: "profile-1", profileVersion: 3, status: "active", supersedesProfileCode: v2.code });
    const chain = [v1, v2, v3];
    expect(effectiveMappingProfileStatus(v1, chain)).toBe("superseded");
    expect(effectiveMappingProfileStatus(v2, chain)).toBe("superseded");
    expect(effectiveMappingProfileStatus(v3, chain)).toBe("active");
  });

  it("validateMappingProfileSupersession rejects a version naming itself as superseded", () => {
    const v1 = baseProfile({ profileId: "profile-1", profileVersion: 1, supersedesProfileCode: undefined });
    const selfReferencing = { ...v1, supersedesProfileCode: v1.code };
    expect(validateMappingProfileSupersession(selfReferencing, [])).toContainEqual(expect.objectContaining({ code: "profile_cannot_supersede_itself" }));
  });

  it("validateMappingProfileSupersession rejects a supersedesProfileCode that names no already-persisted version", () => {
    const v2 = baseProfile({ profileId: "profile-1", profileVersion: 2, supersedesProfileCode: "profile-1::v1" });
    expect(validateMappingProfileSupersession(v2, [])).toContainEqual(expect.objectContaining({ code: "supersedes_target_not_found" }));
  });

  it("validateMappingProfileSupersession rejects a duplicate version code (the same rejection append-only storage would apply)", () => {
    const v1 = baseProfile({ profileId: "profile-1", profileVersion: 1 });
    const duplicate = baseProfile({ profileId: "profile-1", profileVersion: 1 });
    expect(validateMappingProfileSupersession(duplicate, [v1])).toContainEqual(expect.objectContaining({ code: "profile_version_already_exists" }));
  });

  it("validateMappingProfileSupersession rejects cross-family supersession", () => {
    const otherFamily = baseProfile({ profileId: "profile-OTHER", profileVersion: 1 });
    const v2 = baseProfile({ profileId: "profile-1", profileVersion: 2, supersedesProfileCode: otherFamily.code });
    expect(validateMappingProfileSupersession(v2, [otherFamily])).toContainEqual(expect.objectContaining({ code: "supersedes_target_different_profile_family" }));
  });

  it("a genuinely valid v2 -> v1 supersession passes with no issues", () => {
    const v1 = baseProfile({ profileId: "profile-1", profileVersion: 1 });
    const v2 = baseProfile({ profileId: "profile-1", profileVersion: 2, supersedesProfileCode: v1.code });
    expect(validateMappingProfileSupersession(v2, [v1])).toEqual([]);
  });
});

describe("Session 8 Part 5 (MP1-MP12): exact immutable Mapping Profile supersession chain — no gaps, no branching, active-successor-only effective supersession", () => {
  it("MP1: a v1 with no predecessor at all validates with no issues", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1, supersedesProfileCode: undefined });
    expect(validateMappingProfileSupersession(v1, [])).toEqual([]);
  });

  it("MP2: a v2 with no supersedesProfileCode at all is rejected — it must name the exact latest version", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1 });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, supersedesProfileCode: undefined });
    expect(validateMappingProfileSupersession(v2, [v1])).toContainEqual(expect.objectContaining({ code: "profile_must_supersede_exact_latest" }));
  });

  it("MP3: a genuine v2 -> v1 supersession (v1 is the only, and therefore latest, prior version) validates with no issues", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1 });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, supersedesProfileCode: v1.code });
    expect(validateMappingProfileSupersession(v2, [v1])).toEqual([]);
  });

  it("MP4: v3 naming v1 as predecessor while v2 is missing entirely is rejected as a version gap", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1 });
    const v3 = baseProfile({ profileId: "mp-fam", profileVersion: 3, supersedesProfileCode: v1.code });
    expect(validateMappingProfileSupersession(v3, [v1])).toContainEqual(expect.objectContaining({ code: "profile_version_not_sequential" }));
  });

  it("MP5: v3 naming v1 as predecessor while v2 genuinely exists is rejected as branching off the wrong predecessor (v2 is the real latest)", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1 });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, supersedesProfileCode: v1.code });
    const v3 = baseProfile({ profileId: "mp-fam", profileVersion: 3, supersedesProfileCode: v1.code });
    expect(validateMappingProfileSupersession(v3, [v1, v2])).toContainEqual(expect.objectContaining({ code: "profile_must_supersede_exact_latest" }));
  });

  it("MP6: v1 active + v2 draft naming v1 -> v1 stays effectively active (a draft successor must not deactivate its predecessor)", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1, status: "active" });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, status: "draft", supersedesProfileCode: v1.code });
    expect(effectiveMappingProfileStatus(v1, [v1, v2])).toBe("active");
    expect(effectiveMappingProfileStatus(v2, [v1, v2])).toBe("draft");
  });

  it("MP7: v1 active + v2 active naming v1 -> v1 is effectively superseded", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1, status: "active" });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, status: "active", supersedesProfileCode: v1.code });
    expect(effectiveMappingProfileStatus(v1, [v1, v2])).toBe("superseded");
    expect(effectiveMappingProfileStatus(v2, [v1, v2])).toBe("active");
  });

  it("MP8: a full v1/v2/v3 active chain reports correct effective status at every link", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1, status: "active" });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, status: "active", supersedesProfileCode: v1.code });
    const v3 = baseProfile({ profileId: "mp-fam", profileVersion: 3, status: "active", supersedesProfileCode: v2.code });
    const chain = [v1, v2, v3];
    expect(validateMappingProfileSupersession(v2, [v1])).toEqual([]);
    expect(validateMappingProfileSupersession(v3, [v1, v2])).toEqual([]);
    expect(effectiveMappingProfileStatus(v1, chain)).toBe("superseded");
    expect(effectiveMappingProfileStatus(v2, chain)).toBe("superseded");
    expect(effectiveMappingProfileStatus(v3, chain)).toBe("active");
  });

  it("MP9: cross-family supersession is still rejected under the exact-chain rule too", () => {
    const otherFamily = baseProfile({ profileId: "mp-other", profileVersion: 1 });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, supersedesProfileCode: otherFamily.code });
    expect(validateMappingProfileSupersession(v2, [otherFamily])).toContainEqual(expect.objectContaining({ code: "supersedes_target_different_profile_family" }));
  });

  it("MP10: a duplicate version code is still rejected under the exact-chain rule too", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1 });
    const duplicate = baseProfile({ profileId: "mp-fam", profileVersion: 1 });
    expect(validateMappingProfileSupersession(duplicate, [v1])).toContainEqual(expect.objectContaining({ code: "profile_version_already_exists" }));
  });

  it("MP11: validating a chain never mutates any prior version's own object — every row is byte-for-byte unchanged", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1, status: "active" });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, status: "active", supersedesProfileCode: v1.code });
    const v1Before = JSON.stringify(v1);
    const v2Before = JSON.stringify(v2);
    validateMappingProfileSupersession(v2, [v1]);
    effectiveMappingProfileStatus(v1, [v1, v2]);
    expect(JSON.stringify(v1)).toBe(v1Before);
    expect(JSON.stringify(v2)).toBe(v2Before);
  });

  it("MP12: an old version's own stored status field is never rewritten to 'superseded' — only the derived view changes", () => {
    const v1 = baseProfile({ profileId: "mp-fam", profileVersion: 1, status: "active" });
    const v2 = baseProfile({ profileId: "mp-fam", profileVersion: 2, status: "active", supersedesProfileCode: v1.code });
    expect(effectiveMappingProfileStatus(v1, [v1, v2])).toBe("superseded");
    expect(v1.status).toBe("active"); // the stored field itself, untouched
  });
});

describe("MAP8: no arbitrary executable expression support", () => {
  it("an unknown/scripted op name fails validation rather than being silently executed", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [{ sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code", transformations: [{ op: "eval_js" as never, config: { code: "process.exit()" } }] }],
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues.some((i) => i.code === "unknown_transformation_op")).toBe(true);
  });
});

describe("FVL-04.016 hardening D3: transformation config is validated before any row is processed", () => {
  it("parse_decimal with no decimalSeparator fails profile validation, not just runtime", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [
        { sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "Chemical_Name", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "Price_USD", targetTemplate: "material_prices", targetField: "unit_price", transformations: [{ op: "parse_decimal", config: {} }] },
      ],
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues.some((i) => i.code === "invalid_transformation_config" && i.targetField === "unit_price")).toBe(true);
  });

  it("convert_unit with an unrecognized unit fails profile validation", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [{ sourceField: "Price_USD", targetTemplate: "raw_materials", targetField: "material_code", transformations: [{ op: "convert_unit", config: { from: "furlongs", to: "kg" } }] }],
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues.some((i) => i.code === "invalid_transformation_config")).toBe(true);
  });

  it("map_boolean with overlapping trueValues/falseValues fails profile validation", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [{ sourceField: "Price_USD", targetTemplate: "raw_materials", targetField: "material_code", transformations: [{ op: "map_boolean", config: { trueValues: ["Y"], falseValues: ["y"] } }] }],
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues.some((i) => i.code === "invalid_transformation_config")).toBe(true);
  });
});

describe("FVL-04.016 hardening D5: fan-out natural-key coverage validated up front", () => {
  it("a material_prices fan-out target missing its valid_from natural-key field fails validation before commit", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [
        { sourceField: "Chemical_ID", targetTemplate: "material_prices", targetField: "material_code" },
        { sourceField: "Vendor_ID", targetTemplate: "material_prices", targetField: "supplier_code" },
        { sourceField: "Price_USD", targetTemplate: "material_prices", targetField: "unit_price", transformations: [{ op: "parse_decimal", config: { decimalSeparator: "." } }] },
      ],
      // No mapping at all for valid_from — a naturalKey field.
      constantMappings: [{ targetTemplate: "material_prices", targetField: "currency", value: "USD" }],
    });
    const issues = validateMappingProfile(profile, schema);
    expect(issues.some((i) => (i.code === "missing_required_target_field" || i.code === "missing_target_natural_key_field") && i.targetField === "valid_from")).toBe(true);
  });
});

describe("MAP9: no direct masterdata commit — mappingProfile.ts exposes no persistence function", () => {
  it("applyMappingProfile/validateMappingProfile are pure; the module has no upsert/commit/write export", async () => {
    const mod = await import("./mappingProfile");
    const exportNames = Object.keys(mod);
    expect(exportNames.some((n) => /commit|write|persist|upsert/i.test(n))).toBe(false);
  });
});

describe("MAP10/TR15: canonical candidates conform to and pass the EXISTING Data Exchange validator", () => {
  it("a mapped raw_materials candidate previews as valid_create through the real previewDataExchangeImport", () => {
    const staged = csvFixture();
    const schema = schemaFor(staged);
    const profile = baseProfile({
      sourceSchemaFingerprint: schema.fingerprint,
      fieldMappings: [
        { sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "Chemical_Name", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
    });
    const result = applyMappingProfile(profile, staged.records[0]);
    const candidate = result.candidates.find((c) => c.targetTemplate === "raw_materials")!;
    const template = getDataExchangeTemplate("raw_materials")!;
    const headers = template.columns.map((c) => c.key);
    const row = headers.map((h) => candidate.row[h] ?? "");
    const preview = previewDataExchangeImport(template, [headers, row], { resolveReference: () => true });
    expect(preview.rows[0].state).toBe("valid_create");
  });
});

describe("TR16: no direct commit authority anywhere in the mapping/transformation layer", () => {
  it("neither mappingProfile.ts nor transformation.ts imports the desktop commit layer", async () => {
    const mappingSrc = await import("node:fs").then((fs) => fs.readFileSync(new URL("./mappingProfile.ts", import.meta.url), "utf-8"));
    const transformSrc = await import("node:fs").then((fs) => fs.readFileSync(new URL("./transformation.ts", import.meta.url), "utf-8"));
    expect(mappingSrc).not.toMatch(/dataExchangeCommit|upsertRecords/);
    expect(transformSrc).not.toMatch(/dataExchangeCommit|upsertRecords/);
  });
});
