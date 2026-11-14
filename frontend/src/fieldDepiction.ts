import type { Geometry } from "geojson";
import { bounds } from "./presentation";

export const fieldMarksAcrossSubject = 58;
export const socialFieldChannel =
  /^(culture:|language:|languageUse:|religion:|population$|populationDensity$)/;
export interface FieldMark {
  point: [number, number];
  channel: string;
  weight: number;
  spacing: number;
  index: number;
}
type Point = { x: number; y: number; z: number };
export interface FieldDepiction {
  channel: string;
  maximum: number;
  samplers: { covers(point: Point): boolean; at(point: Point): number }[];
}
/** Stipple spacing is anchored in chart coordinates for each composition. */
export async function depictFields(
  fields: FieldDepiction[],
  footprint: Geometry,
  coverage: (polygons: Geometry[], points: Point[]) => Promise<boolean[][]>
): Promise<FieldMark[]> {
  const box = bounds(footprint);
  const step = Math.max(box[2] - box[0], box[3] - box[1]) / fieldMarksAcrossSubject;
  const candidates = fields.flatMap((_, index) => {
    const result: { point: Point; index: number }[] = [];
    for (let y = Math.floor(box[1] / step); y * step < box[3]; y++) {
      for (let x = Math.floor(box[0] / step); x * step < box[2]; x++) {
        const point = {
          x: (x + 0.3 + (index % 3) * 0.2) * step,
          y: (y + 0.3 + (index % 2) * 0.3) * step,
          z: 0,
        };
        result.push({ point, index });
      }
    }
    return result;
  });
  if (!candidates.length) return [];
  const [covered] = await coverage(
    [footprint],
    candidates.map((entry) => entry.point)
  );
  return candidates.flatMap(({ point, index }, i) => {
    if (!covered[i]) return [];
    const { channel, maximum, samplers } = fields[index];
    const value = samplers.find((sampler) => sampler.covers(point))?.at(point) ?? 0;
    const weight = Math.max(0, Math.min(1, value / maximum));
    return weight > 0
      ? [{ point: [point.x, point.y] as [number, number], channel, weight, spacing: step, index }]
      : [];
  });
}
