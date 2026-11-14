import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { coastalFrame } from "./coastalFrame";
import { releaseWorking } from "./physicalNumerics";

/** The ocean field stays marine; this view identifies the shore that its medium contacts. */
export function contactView(map: PhysicalField, field: MagicField) {
  const marine = field.definition.origins.some((origin) => origin.propagation === "ocean-rays"),
    frame = marine
      ? coastalFrame(map, field.definition.parameters.beamWidth, field.intensity)
      : undefined;
  return {
    intensity: (cell: number) =>
      frame && map.WaterKindCodes.get(cell) === 0
        ? Math.max(field.intensity.get(cell), frame.strength.get(cell) * frame.coverage.get(cell))
        : field.intensity.get(cell),
    coverage: (cell: number) =>
      frame && map.WaterKindCodes.get(cell) === 0
        ? Math.max(
            field.systemCoverage.get(cell),
            (frame.coverage.get(cell) * frame.strength.get(cell)) / 1000
          )
        : field.systemCoverage.get(cell),
    close: () => {
      if (frame) releaseWorking(map, frame.strength, frame.coverage, frame.source);
    },
  };
}
/** Offshore action reaches actual dry coast through the same shore geometry as ordinary waves. */
export function receiveCoastalAction(
  map: PhysicalField,
  offshore: import("@atlas/domain").Band,
  strength: number,
  width: number,
  received: import("@atlas/domain").Band
) {
  if (strength === 0) return;
  const frame = coastalFrame(map, width, { get: (cell) => offshore.get(cell) * strength });
  for (let i = 0; i < map.mesh.count; i++)
    if (frame.coverage.get(i) > 0)
      received.set(
        i,
        Math.min(1000, received.get(i) + frame.strength.get(i) * frame.coverage.get(i))
      );
  releaseWorking(map, frame.strength, frame.coverage, frame.source);
}
