import { generateBand, putChannel, type ReadBand } from "@atlas/domain";
import { ask } from "./coupling/answers";
import { humanLayersOf } from "./human/humanLayers";
import type { GenerationState, MapProcessContext } from "./process";
import { nativeContext } from "./world/context";

/**
 * How many people live on the land and how many it feeds as it is used, published for the
 * map and for any finer map made of it. Both are read from the land: the people's own layer
 * and the answer to what each cell supports.
 */
export function publishLandPopulation(state: GenerationState, context: MapProcessContext) {
  const work = state.physical!,
    fed = ask(work.map, "support", nativeContext(state, context, 0)),
    publish = (name: "populationDensity" | "populationCapacity", values: Pick<ReadBand, "get">) =>
      putChannel(
        state.surface,
        name,
        "people/square-kilometre",
        generateBand(
          state.surface.coverage,
          "float64",
          name,
          (i) => (work.samples.get(i) >= 0 ? values.get(work.samples.get(i)) : 0),
          work.samples.length
        )
      );
  const layers = humanLayersOf(work.map);
  publish("populationDensity", { get: (cell) => layers.people(cell) });
  publish("populationCapacity", fed);
}
