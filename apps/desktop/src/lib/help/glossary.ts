/** A small, real-domain-vocabulary glossary — separate from `HELP_TOPICS`
 *  because a term is not a page. Definitions live in the "help" i18n
 *  namespace under `glossary.<id>`. Every term here is drawn from the
 *  app's actual schemas/docs, never invented. */
export interface GlossaryTerm {
  id: string;
  termKey: string;
  definitionKey: string;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  { id: "workingDraft", termKey: "glossary.workingDraft.term", definitionKey: "glossary.workingDraft.definition" },
  { id: "savedVersion", termKey: "glossary.savedVersion.term", definitionKey: "glossary.savedVersion.definition" },
  { id: "approvalRole", termKey: "glossary.approvalRole.term", definitionKey: "glossary.approvalRole.definition" },
  { id: "blockingFinding", termKey: "glossary.blockingFinding.term", definitionKey: "glossary.blockingFinding.definition" },
  { id: "dossier", termKey: "glossary.dossier.term", definitionKey: "glossary.dossier.definition" },
  { id: "evidenceConfirmation", termKey: "glossary.evidenceConfirmation.term", definitionKey: "glossary.evidenceConfirmation.definition" },
  { id: "qsToHundred", termKey: "glossary.qsToHundred.term", definitionKey: "glossary.qsToHundred.definition" },
  { id: "landedCost", termKey: "glossary.landedCost.term", definitionKey: "glossary.landedCost.definition" },
  { id: "costSnapshot", termKey: "glossary.costSnapshot.term", definitionKey: "glossary.costSnapshot.definition" },
  { id: "compatibilityFinding", termKey: "glossary.compatibilityFinding.term", definitionKey: "glossary.compatibilityFinding.definition" },
  { id: "safetyClassification", termKey: "glossary.safetyClassification.term", definitionKey: "glossary.safetyClassification.definition" },
  { id: "doeStudy", termKey: "glossary.doeStudy.term", definitionKey: "glossary.doeStudy.definition" },
  { id: "reverseFormulationCandidate", termKey: "glossary.reverseFormulationCandidate.term", definitionKey: "glossary.reverseFormulationCandidate.definition" },
  { id: "dataExchangeTemplate", termKey: "glossary.dataExchangeTemplate.term", definitionKey: "glossary.dataExchangeTemplate.definition" },
  { id: "auditEvent", termKey: "glossary.auditEvent.term", definitionKey: "glossary.auditEvent.definition" },
  { id: "watermark", termKey: "glossary.watermark.term", definitionKey: "glossary.watermark.definition" },
  { id: "readinessBlocker", termKey: "glossary.readinessBlocker.term", definitionKey: "glossary.readinessBlocker.definition" },
  { id: "jurisdiction", termKey: "glossary.jurisdiction.term", definitionKey: "glossary.jurisdiction.definition" },
  { id: "testMethodSnapshot", termKey: "glossary.testMethodSnapshot.term", definitionKey: "glossary.testMethodSnapshot.definition" },
];
