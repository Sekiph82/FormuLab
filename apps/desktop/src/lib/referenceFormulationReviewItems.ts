import type { ReferenceFormulationRecord } from "@formulab/shared";

export interface ReferenceFormulationReviewItem {
  targetType: "identity" | "ingredient" | "procedure" | "target";
  targetKey: string;
  fieldPath: string;
  label: string;
  sourceValue: string;
  evidenceExcerpt: string;
  pageNumber?: number;
  blockIndex?: number;
  rowIndex?: number;
  cellIndex?: number;
  sourceKind?: string;
  confidence?: number;
}

export function buildReferenceFormulationReviewItems(record: ReferenceFormulationRecord): ReferenceFormulationReviewItem[] {
  const items: ReferenceFormulationReviewItem[] = [];
  record.identityCandidates.forEach((candidate, index) => {
    const evidence = candidate.evidence[0]!;
    items.push({
      targetType: "identity", targetKey: `identity:${candidate.field}:${index}`,
      fieldPath: `identityCandidates[${index}].${candidate.field}`, label: candidate.field.replace(/_/g, " "),
      sourceValue: candidate.rawValue, evidenceExcerpt: evidence.excerpt,
      pageNumber: evidence.pageNumber, blockIndex: evidence.blockIndex, sourceKind: evidence.source, confidence: evidence.confidence,
    });
  });

  const ingredientFields = [
    ["ingredientName", "Ingredient name"], ["supplierProductCode", "Supplier product code"],
    ["inciOrChemicalName", "INCI or chemical wording"], ["function", "Supplier-stated function"],
    ["phase", "Phase or order"], ["amount", "Amount"], ["unit", "Unit"], ["basis", "Basis"],
  ] as const;
  record.ingredientLines.forEach((line) => {
    ingredientFields.forEach(([field, label]) => {
      const value = line[field];
      if (!value) return;
      const evidence = value.evidence;
      items.push({
        targetType: "ingredient", targetKey: `ingredient:${line.id}:${field}`,
        fieldPath: `ingredientLines[${line.id}].${field}`, label, sourceValue: value.rawValue,
        evidenceExcerpt: line.rawRow.join(" | "), pageNumber: evidence.pageNumber, blockIndex: evidence.blockIndex,
        rowIndex: evidence.rowIndex, cellIndex: evidence.cellIndex, sourceKind: evidence.source, confidence: evidence.confidence,
      });
    });
  });

  record.procedureSteps.forEach((step) => {
    const evidence = step.evidence;
    items.push({
      targetType: "procedure", targetKey: `procedure:${step.id}:instruction`,
      fieldPath: `procedureSteps[${step.id}].rawInstruction`, label: `Procedure step ${step.sequenceOrder}`,
      sourceValue: step.rawInstruction, evidenceExcerpt: evidence.excerpt, pageNumber: evidence.pageNumber,
      blockIndex: evidence.blockIndex, rowIndex: evidence.rowIndex, cellIndex: evidence.cellIndex,
      sourceKind: evidence.source, confidence: evidence.confidence,
    });
    if (step.phase) {
      const phaseEvidence = step.phase.evidence;
      items.push({
        targetType: "procedure", targetKey: `procedure:${step.id}:phase`,
        fieldPath: `procedureSteps[${step.id}].phase`, label: `Step ${step.sequenceOrder} phase`,
        sourceValue: step.phase.rawValue, evidenceExcerpt: phaseEvidence.excerpt, pageNumber: phaseEvidence.pageNumber,
        blockIndex: phaseEvidence.blockIndex, rowIndex: phaseEvidence.rowIndex, cellIndex: phaseEvidence.cellIndex,
        sourceKind: phaseEvidence.source, confidence: phaseEvidence.confidence,
      });
    }
    step.conditions.forEach((condition, index) => {
      const conditionEvidence = condition.evidence;
      items.push({
        targetType: "procedure", targetKey: `procedure:${step.id}:condition:${index}`,
        fieldPath: `procedureSteps[${step.id}].conditions[${index}]`, label: `Step ${step.sequenceOrder} ${condition.kind}`,
        sourceValue: condition.rawValue, evidenceExcerpt: conditionEvidence.excerpt, pageNumber: conditionEvidence.pageNumber,
        blockIndex: conditionEvidence.blockIndex, rowIndex: conditionEvidence.rowIndex, cellIndex: conditionEvidence.cellIndex,
        sourceKind: conditionEvidence.source, confidence: conditionEvidence.confidence,
      });
    });
  });

  record.targetCandidates.forEach((candidate) => {
    const evidence = candidate.evidence;
    items.push({
      targetType: "target", targetKey: `target:${candidate.id}`,
      fieldPath: `targetCandidates[${candidate.id}].${candidate.field}`, label: candidate.rawPropertyLabel,
      sourceValue: candidate.rawValue, evidenceExcerpt: evidence.excerpt, pageNumber: evidence.pageNumber,
      blockIndex: evidence.blockIndex, rowIndex: evidence.rowIndex, cellIndex: evidence.cellIndex,
      sourceKind: evidence.source, confidence: evidence.confidence,
    });
  });
  return items;
}
