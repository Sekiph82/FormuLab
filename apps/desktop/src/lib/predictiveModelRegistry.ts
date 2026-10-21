import {
  createPredictiveModelRegistry,
  registerPredictiveModel,
  predictiveModelArtifactSchema,
  type PredictiveModelArtifact,
  type PredictiveModelRegistry,
} from "@formulab/shared";
import { listRecords, upsertRecords } from "./masterdata";

/** Desktop persistence adapter for the canonical FVL-07 append-only registry. */
export async function readAcceptedPredictiveModels(): Promise<PredictiveModelRegistry & { rejectedModels: PredictiveModelArtifact[] }> {
  const accepted = [] as PredictiveModelArtifact[];
  const rejected = [] as PredictiveModelArtifact[];
  for (const raw of await listRecords("predictive_models")) {
    const parsed = predictiveModelArtifactSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Predictive model registry contains an invalid artifact: ${parsed.error.message}`);
    (parsed.data.evaluation.acceptance === "ACCEPTED" ? accepted : rejected).push(parsed.data);
  }
  const registry = await createPredictiveModelRegistry(accepted);
  return { ...registry, rejectedModels: rejected };
}

/** Only accepted, checksum-valid model versions can enter the registry. The
 *  Rust collection independently refuses overwrite or delete by model id. */
export async function appendAcceptedPredictiveModel(model: PredictiveModelArtifact): Promise<PredictiveModelRegistry> {
  const current = await readAcceptedPredictiveModels();
  const next = await registerPredictiveModel(current, model);
  await upsertRecords("predictive_models", [model]);
  return next;
}
