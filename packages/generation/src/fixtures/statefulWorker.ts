/** A separately bundled execution realm must rebind reviewed module implementations. */
import { parentPort } from "node:worker_threads";
import { atlasGenerationModules } from "../atlasModules";
import { statefulInventoryModule } from "./statefulModule";
import { generateAtlas, type AtlasGenerationInput } from "../atlasWorkflow";
import { generationSnapshot } from "../atlasPublication";
import { configureSpatial, type DomainSnapshot } from "@atlas/domain";
import { GeometryKernel } from "../../../storage-browser/src/geometryKernel";
import { GeosSpatial } from "../../../storage-browser/src/geosSpatial";

const kernel = await GeometryKernel.create();
configureSpatial((precision) => new GeosSpatial(kernel, precision));

if (!parentPort) throw new Error("Start this fixture in a worker thread.");
const port = parentPort;
atlasGenerationModules.register(statefulInventoryModule);
port.on(
  "message",
  async (data: { snapshot: DomainSnapshot; input: AtlasGenerationInput; operationId: string }) => {
    try {
      const result = await generateAtlas(data.snapshot, data.input);
      const snapshot = generationSnapshot(result, data.input, data.operationId, data.snapshot, []);
      port.postMessage({ kind: "completed", snapshot, history: result.state.history });
    } catch (error) {
      port.postMessage({ kind: "failed", error: String(error) });
    }
  }
);
