import { putChannel, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
export function projectPhysicalMaterial(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  const prepared = map.continuous?.geography?.categories?.physicalMaterial;
  if (prepared) {
    const entries = prepared.entries.map((entry) => ({
      code: entry.code,
      covers: spatial.pointCoverage(entry.footprint),
    }));
    putChannel(
      state.surface,
      "physicalMaterial",
      "category",
      Float64Array.from(
        work.samples,
        (i) =>
          entries.find((entry) =>
            entry.covers({
              x: map.mesh.x[i] + map.mesh.origin[0],
              y: map.mesh.y[i] + map.mesh.origin[1],
              z: 0,
            })
          )?.code ?? prepared.fallback
      ),
      "category"
    );
    ((state.surface.geography ??= {}).categories ??= {}).physicalMaterial = prepared;
    return;
  }
}
