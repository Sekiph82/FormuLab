import type { ReferenceFormulationNormalizationVersion, ReferenceFormulationRecord } from "@formulab/shared";

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

export function buildReferenceFormulationReviewItems(
  record: ReferenceFormulationRecord,
  normalization?: ReferenceFormulationNormalizationVersion,
): ReferenceFormulationReviewItem[] {
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
    // One decision per canonical-chemistry candidate of the latest normalization; the native
    // append command checks the same key, path and INCI-cell evidence against the persisted version.
    const normalizedLine = normalization?.referenceFormulationRecordId === record.id
      ? normalization.lines.find((candidate) => candidate.sourceLineId === line.id) : undefined;
    const cell = line.inciOrChemicalName ?? line.ingredientName;
    if (normalization && normalizedLine && cell) {
      normalizedLine.canonicalChemistry.candidateIds.forEach((chemistryId) => {
        items.push({
          targetType: "ingredient",
          targetKey: `normalization:${normalization.id}:line:${line.id}:canonicalChemistry:${chemistryId}`,
          fieldPath: `normalizations[${normalization.id}].lines[${line.id}].canonicalChemistry`,
          label: "Canonical chemistry", sourceValue: chemistryId,
          evidenceExcerpt: line.rawRow.join(" | "), pageNumber: cell.evidence.pageNumber, blockIndex: cell.evidence.blockIndex,
          rowIndex: cell.evidence.rowIndex, cellIndex: cell.evidence.cellIndex, sourceKind: cell.evidence.source, confidence: cell.evidence.confidence,
        });
      });
    }
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
