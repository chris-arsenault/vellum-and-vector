import { detachGrid } from "@atlas/domain";
import { generateAtlas, generationPreview } from "@atlas/generation";
import type { GenerationProducer } from "../generationExecution";
import { transferableBuffers } from "../transferableBuffers";

const yieldControl = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Retain the source runner for the existing development probes during the port. */
export const typescriptGeneration: GenerationProducer = async (
  source,
  input,
  _operationId,
  execution,
  observers
) => {
  const result = await generateAtlas(source, input, {
    ...observers,
    cache: execution.blocks.cache,
    features: execution.features,
    sourceFeatures: execution.sourceFeatures,
    networks: execution.networks,
    sourceNetworks: execution.sourceNetworks,
    contours: execution.contours,
    cancelled: execution.cancelled,
    yieldControl,
    async saveBoundary(boundary) {
      const preview = generationPreview(boundary.state);
      if (!preview.channels.Elevation) return;
      const label =
        boundary.kind === "epoch"
          ? boundary.ancestry.map((epoch) => epoch.id).join(" / ")
          : "Present geography";
      const grid = detachGrid(preview);
      execution.send({ kind: "preview", grid, label }, transferableBuffers(grid));
      await yieldControl();
    },
  });
  return { state: result.state, close() {} };
};
