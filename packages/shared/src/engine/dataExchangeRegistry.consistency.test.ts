/**
 * FVL-04 hardening (Session 8, Part 4/8) — a registry-wide invariant test
 * so the exact class of bug this session closed (a `code_reference` column
 * whose target has a composite natural key and no explicit `referenceField`,
 * which would make reference resolution fall back to guessing) can never
 * silently reappear as the registry grows.
 *
 * For every `code_reference` column with a `referenceTemplate`:
 *   1. the target template must actually exist in the registry
 *   2. if `referenceField` is set, it must name a real column on the target
 *   3. if `referenceField` is ABSENT, the target's own natural key must be
 *      exactly one field (the only case `resolveColumnReferenceField()`'s
 *      documented fallback can resolve unambiguously) — a composite target
 *      natural key with no explicit `referenceField` fails this test.
 */
import { describe, expect, it } from "vitest";
import { DATA_EXCHANGE_TEMPLATES, getDataExchangeTemplate, type DataExchangeColumnDefinition, type DataExchangeTemplateDefinition } from "./dataExchangeRegistry";
import { resolveColumnReferenceField } from "./dataExchangeValidation";

/** Canonical collections that are referenced by import templates but do not
 * have their own Data Exchange import template. */
const CANONICAL_COLLECTION_REFERENCES: Record<string, ReadonlySet<string>> = {
  laboratory_trials: new Set(["trial_code"]),
};

function referenceColumns(template: DataExchangeTemplateDefinition): DataExchangeColumnDefinition[] {
  return template.columns.filter((c) => c.dataType === "code_reference" && c.referenceTemplate);
}

describe("Data Exchange registry — code_reference consistency invariant", () => {
  const cases: { templateCode: string; column: DataExchangeColumnDefinition }[] = [];
  for (const template of DATA_EXCHANGE_TEMPLATES) {
    for (const column of referenceColumns(template)) {
      cases.push({ templateCode: template.templateCode, column });
    }
  }

  it("the registry has at least one real code_reference column to check (sanity — this test cannot silently pass on zero cases)", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases.map((c) => [`${c.templateCode}.${c.column.key} -> ${c.column.referenceTemplate}`, c] as const))(
    "%s: target template exists, referenceField (explicit or unambiguous fallback) resolves to a real column",
    (_label, { column }) => {
      const target = getDataExchangeTemplate(column.referenceTemplate!);
      const canonicalFields = CANONICAL_COLLECTION_REFERENCES[column.referenceTemplate!];
      expect(target || (canonicalFields && column.referenceField && canonicalFields.has(column.referenceField)), `"${column.referenceTemplate}" is neither a registered template nor an explicitly supported canonical collection reference`).toBeTruthy();

      const resolved = resolveColumnReferenceField(column);
      expect("configError" in resolved, resolved && "configError" in resolved ? resolved.configError : undefined).toBe(false);
      if ("field" in resolved) {
        if (target) {
          const targetColumn = target.columns.find((c) => c.key === resolved.field);
          expect(targetColumn, `"${resolved.field}" is not a real column on "${column.referenceTemplate}"`).toBeDefined();
        } else {
          expect(canonicalFields?.has(resolved.field), `"${resolved.field}" is not a registered field on canonical collection "${column.referenceTemplate}"`).toBe(true);
        }
      }
    },
  );

  it("every column with an explicit referenceField genuinely names a real column on the target template", () => {
    for (const { templateCode, column } of cases) {
      if (!column.referenceField) continue;
      const target = getDataExchangeTemplate(column.referenceTemplate!);
      if (target) {
        const targetColumn = target.columns.find((c) => c.key === column.referenceField);
        expect(targetColumn, `${templateCode}.${column.key} -> ${column.referenceTemplate}.${column.referenceField} does not exist`).toBeDefined();
      } else {
        expect(CANONICAL_COLLECTION_REFERENCES[column.referenceTemplate!]?.has(column.referenceField), `${templateCode}.${column.key} -> ${column.referenceTemplate}.${column.referenceField} is not an explicitly supported canonical collection field`).toBe(true);
      }
    }
  });

  it("no column relies on the unambiguous-single-natural-key fallback against a target with a composite natural key (the exact bug class this session closed)", () => {
    for (const { templateCode, column } of cases) {
      if (column.referenceField) continue; // explicit field configured — not using the fallback
      const target = getDataExchangeTemplate(column.referenceTemplate!);
      expect(target, `${templateCode}.${column.key} uses a canonical collection without an explicit field`).toBeDefined();
      expect(target!.naturalKey.length, `${templateCode}.${column.key} references "${column.referenceTemplate}" (composite natural key ${target!.naturalKey.join("+")}) with no explicit referenceField`).toBe(1);
    }
  });
});
