/* eslint-disable max-lines-per-function -- The browser worker fixture keeps its lifecycle in one closure. */
import type { AtlasFeature, DomainSnapshot, Grid, Landmark, SocietyRegion } from "@atlas/domain";
import { generationSnapshot } from "@atlas/generation";
import { sendGeneration } from "../src/generationTransport";
import type {
  CompletedBoundary,
  AtlasGenerationInput,
  PublicationDefinition,
  GenerationDiagnostic,
} from "@atlas/generation";

/** The records a fixture run leaves in the world, as the real run would leave them. */
function seedFixtureWorld(
  snapshot: DomainSnapshot,
  records: { society?: SocietyRegion; ecologicalFeatures: AtlasFeature[]; landmarks: Landmark[] }
) {
  const { areaId, spaceId } = snapshot.scope;
  if (records.society) snapshot.world.societies = { [areaId]: { ...records.society, areaId } };
  for (const feature of records.ecologicalFeatures)
    snapshot.world.features[feature.id] = { ...feature, areaId };
  for (const landmark of records.landmarks)
    snapshot.world.landmarks.push({ ...landmark, areaId, spaceId });
}
/** Small generated fields use the production publication and transfer path. */
export function installGenerationFixtureRuntime({
  hold,
  fields,
  terrain,
  life,
  ecologicalFeatures,
  landmarks,
  society,
  diagnostics,
}: {
  hold: boolean;
  fields: boolean;
  terrain: boolean;
  life: boolean;
  ecologicalFeatures: AtlasFeature[];
  landmarks: Landmark[];
  society?: SocietyRegion;
  diagnostics: GenerationDiagnostic[];
}) {
  const pending = new Set<() => Promise<void>>();
  Object.assign(window, {
    completeGenerationFixture() {
      return Promise.all([...pending].map((complete) => complete()));
    },
  });
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args) {
      if (!String(args[0]).includes("generation.worker")) return Reflect.construct(target, args);
      let stopped = false;
      let complete: (() => Promise<void>) | undefined;
      const worker = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        terminate() {
          stopped = true;
          if (complete) pending.delete(complete);
        },
        postMessage(message: {
          snapshot: DomainSnapshot;
          input: AtlasGenerationInput;
          operationId: string;
        }) {
          Object.assign(window, {
            generationFixtureInput: structuredClone(message.input),
            generationFixtureSnapshot: structuredClone(message.snapshot),
            generationFixtureWorker: worker,
          });
          // Pin the same input revision that a real worker receives through structured cloning.
          const snapshot = structuredClone(message.snapshot);
          const original = structuredClone(snapshot);
          const publications = message.input.configuration?.inputs
            ?.publications as unknown as PublicationDefinition[];
          const fieldPublications = new Map(
            publications.flatMap((definition) =>
              definition.kind === "field" ? [[definition.channel, definition] as const] : []
            )
          );
          complete = async () => {
            if (complete) pending.delete(complete);
            if (stopped) return;
            seedFixtureWorld(snapshot, { society, ecologicalFeatures, landmarks });
            const footprint = snapshot.scope.footprint;
            if (footprint.type !== "Polygon") throw new Error("Fixture expects a polygon scope");
            const rings = footprint.coordinates.flat(2);
            const xs = rings.filter((_, i) => i % 2 === 0);
            const ys = rings.filter((_, i) => i % 2 === 1);
            const bounds: Grid["bounds"] = [
              Math.min(...xs),
              Math.min(...ys),
              Math.max(...xs),
              Math.max(...ys),
            ];
            const size = 16;
            const biomeAt = (i: number) => {
              if (!ecologicalFeatures.length) return i % size < 8 ? 10 : 14;
              return i % size < 5 ? 10 : i % size < 11 ? 7 : 15;
            };
            const channels: Grid["channels"] = {};
            // Without fields the fixture publishes features and society only: no raster map.
            const fixtureChannels = !fields
              ? []
              : [
                  "elevation",
                  "temperature",
                  "flow",
                  "water",
                  "naturalSurface",
                  "finalSurface",
                  "bedrock",
                  "sediment",
                  "rock",
                  "province",
                  "continentalFraction",
                  "fracture",
                  "geothermal",
                  "impactExcavation",
                  "volcanicConstruction",
                  "glacialErosion",
                  "glacialDeposition",
                  "coastalErosion",
                  "deposition",
                  ...(life ? ["biome", "treeCover", "broadleafSaplings", "soilWater"] : []),
                  ...snapshot.world.magicSystems!.flatMap((system) => [
                    `magic:${system.id}:history`,
                    `magic:${system.id}:coastalHistory`,
                  ]),
                ];
            for (const name of fixtureChannels) {
              if (!fieldPublications.has(name))
                throw new Error(`Register a publication descriptor for fixture channel ${name}.`);
              channels[name] = Float64Array.from({ length: size * size }, (_, i) => {
                const physical = physicalFixtureValue(name, i, size);
                if (physical !== undefined) return physical;
                if (name === "biome") return biomeAt(i);
                if (name === "treeCover") return 0.7;
                if (name === "broadleafSaplings") return 0.1;
                if (name === "soilWater") return 0.08;
                if (name !== "elevation" || !terrain) return i % size;
                const x = (i % size) / (size - 1),
                  y = Math.floor(i / size) / (size - 1);
                return -500 + 2400 * Math.exp(-8 * ((x - 0.6) ** 2 + (y - 0.6) ** 2));
              });
            }
            const surface: Grid = {
              id: "browser-fixture",
              scope: { ...snapshot.scope, resolution: (bounds[2] - bounds[0]) / (size - 1) },
              bounds,
              width: size,
              height: size,
              active: new Uint8Array(size * size).fill(1),
              measures: new Float64Array(size * size).fill(
                ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / (size * size)
              ),
              channels,
              units: Object.fromEntries(
                Object.keys(channels).map((name) => [name, fieldPublications.get(name)!.unit])
              ),
              quantities: Object.fromEntries(
                Object.keys(channels).map((name) => [name, fieldPublications.get(name)!.quantity])
              ),
            };
            const result: CompletedBoundary = {
              kind: "final",
              configurationHash: "browser-fixture",
              ancestry: [],
              state: {
                domain: snapshot,
                surface,
                facts: new Set(Object.keys(channels)),
                history: [],
                publications,
                diagnostics,
              },
            };
            const output = generationSnapshot(result, message.input, message.operationId, original);
            await sendGeneration(output, [], diagnostics, (data, transfer) => {
              if (!stopped)
                worker.onmessage?.(
                  new MessageEvent("message", { data: structuredClone(data, { transfer }) })
                );
            });
          };
          pending.add(complete);
          for (const diagnostic of diagnostics)
            worker.onmessage?.(
              new MessageEvent("message", { data: { kind: "diagnostic", diagnostic } })
            );
          worker.onmessage?.(
            new MessageEvent("message", {
              data: {
                kind: "progress",
                path: ["fixture"],
                fraction: 0.5,
                message: "Preparing test fields",
              },
            })
          );
          if (!hold) queueMicrotask(complete);
        },
      };
      return worker;
    },
  });
  function physicalFixtureValue(name: string, i: number, size: number) {
    const values: Record<string, number> = {
      water: 0,
      impactExcavation: 0,
      volcanicConstruction: 0,
      glacialErosion: 0,
      glacialDeposition: 0,
      coastalErosion: 0,
      deposition: 0,
      geothermal: 0,
      province: 0,
      rock: 1,
      continentalFraction: 1,
      fracture: 1,
      sediment: 0,
    };
    if (name === "bedrock") return i % size;
    if (Object.hasOwn(values, name)) return values[name];
    return undefined;
  }
}
