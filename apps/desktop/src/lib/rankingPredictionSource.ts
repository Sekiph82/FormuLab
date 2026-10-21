import { canonicalizeForFingerprint, extractFormulaVersionDatasetRows, type Formulation, type FormulationVersion, type RawMaterial } from "@formulab/shared";
import type { FormulationCard, SessionDetail } from "./formulationV2";
import { buildPromotedFormulation } from "./promoteGeneratedFormula";
import { linesFromGeneratedFormula, listFormulations, readFormulation, saveFormulation, saveFormulationVersion } from "./formulations";

function sourceIdentity(sessionId: string, versionLabel: string): { code: string; reason: string } {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "-");
  const key = `${safe(sessionId)}-${safe(versionLabel)}`;
  return { code: `GEN-${key}`, reason: `FVL-08 exact generated source ${sessionId}/${versionLabel}` };
}

function comparableLines(lines: FormulationVersion["lines"]): unknown[] {
  return lines.map(({ lineNumber, phase, materialCode, displayName, inciName, percent, isQsToHundred, functions, activeMatterPercent, technicalMaxPercent }) => ({
    lineNumber, phase, materialCode, displayName, inciName, percent, isQsToHundred, functions, activeMatterPercent, technicalMaxPercent,
  }));
}

function matchesCard(version: FormulationVersion, card: FormulationCard): boolean {
  const expected = linesFromGeneratedFormula(card.formula);
  return canonicalizeForFingerprint(comparableLines(version.lines)) === canonicalizeForFingerprint(comparableLines(expected));
}

/** Resolve a prior exact bridge by stable source code, or save one immutable
 *  real FormulationVersion from this session card. No synthetic version id is
 *  supplied to FVL-07; saved identity comes from the formulation store. */
export async function ensureRankingPredictionSource(input: {
  session: SessionDetail;
  card: FormulationCard;
  batchKg: string;
  materials: RawMaterial[];
}): Promise<{ formulation: Formulation; version: FormulationVersion }> {
  const { code, reason } = sourceIdentity(input.session.id, input.card.version);
  const matches = (await listFormulations()).filter((item) => item.code === code);
  if (matches.length > 1) throw new Error(`Generated prediction source code "${code}" is ambiguous.`);
  if (matches.length === 1) {
    const saved = await readFormulation(matches[0]!.id);
    const linked = saved.versions.filter((version) => version.changeReason === reason);
    if (linked.length > 1) throw new Error(`Generated prediction source "${code}" has multiple linked immutable versions.`);
    if (linked.length === 1) {
      if (!matchesCard(linked[0]!, input.card)) throw new Error(`Saved prediction source "${code}" no longer matches the immutable session card.`);
      extractFormulaVersionDatasetRows({ formulationVersionIds: [linked[0]!.id], formulationVersions: [linked[0]!], formulations: [saved.formulation], materials: input.materials });
      return { formulation: saved.formulation, version: linked[0]! };
    }
    if (saved.versions.length > 0) throw new Error(`Generated prediction source "${code}" exists with unrelated formula versions.`);
    const bridge = buildPromotedFormulation(input.session, input.card, input.batchKg, { code, changeReason: reason });
    bridge.version.formulationId = saved.formulation.id;
    extractFormulaVersionDatasetRows({ formulationVersionIds: [bridge.version.id], formulationVersions: [bridge.version], formulations: [saved.formulation], materials: input.materials });
    const version = await saveFormulationVersion(bridge.version);
    return { formulation: saved.formulation, version };
  }

  const bridge = buildPromotedFormulation(input.session, input.card, input.batchKg, { code, changeReason: reason });
  extractFormulaVersionDatasetRows({ formulationVersionIds: [bridge.version.id], formulationVersions: [bridge.version], formulations: [bridge.formulation], materials: input.materials });
  const formulation = await saveFormulation(bridge.formulation);
  const version = await saveFormulationVersion(bridge.version);
  return { formulation, version };
}
