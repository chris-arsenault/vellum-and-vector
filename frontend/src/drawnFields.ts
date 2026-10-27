import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import { Circle, Fill, Stroke, Style } from "ol/style.js";
import { fieldInterpolator, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { LoadedDrawnMapInput as DrawnMapInput } from "./drawnMap";
import { bounds, lineage } from "./presentation";
import type { World } from "./types";
import type { CartographicPresentation } from "@atlas/domain";
import { atlasColour } from "./drawnSymbols";
import { rasterLimits } from "./rasterTiles";

// Printed stipple spacing is anchored in world coordinates for each composition.
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
export function initialSubjectFields(view: CartographicPresentation, world: World, areaId: string) {
  if (view.subject !== "cultural" || view.fields.length) return view;
  const ancestors = new Set(lineage(world, areaId).map((a) => a.id));
  const channels = world.fields
    .filter((f) => ancestors.has(f.areaId))
    .flatMap((f) => f.channels ?? []);
  for (const prefix of ["culture:", "languageUse:", "religion:"]) {
    const channel = channels.find((c) => c.startsWith(prefix));
    if (channel) return { ...view, fields: [channel] };
  }
  return view;
}
export function fieldMarks(input: DrawnMapInput, footprint: Geometry): FieldMark[] {
  const box = bounds(footprint),
    covers = spatial.pointCoverage(footprint);
  const step = Math.max(box[2] - box[0], box[3] - box[1]) / fieldMarksAcrossSubject;
  return input.view.fields.flatMap((channel, index) => {
    const parts = input.rasters
      .filter((r) => r.channel === channel)
      .slice()
      .reverse();
    const samplers = parts.map((r) => ({
      covers: spatial.pointCoverage(r.footprint),
      at: fieldInterpolator(r.field, channel),
    }));
    const maximum =
      socialFieldChannel.test(channel) && channel.includes(":")
        ? 1
        : Math.max(1, rasterLimits(parts)[1]);
    const result: FieldMark[] = [];
    for (let y = Math.floor(box[1] / step); y * step < box[3]; y++) {
      for (let x = Math.floor(box[0] / step); x * step < box[2]; x++) {
        const p = {
          x: (x + 0.3 + (index % 3) * 0.2) * step,
          y: (y + 0.3 + (index % 2) * 0.3) * step,
          z: 0,
        };
        if (!covers(p)) continue;
        const value = samplers.find((s) => s.covers(p))?.at(p) ?? 0;
        const weight = Math.max(0, Math.min(1, value / maximum));
        if (weight > 0) result.push({ point: [p.x, p.y], channel, weight, spacing: step, index });
      }
    }
    return result;
  });
}
export function illustratedFields(input: Pick<DrawnMapInput, "view">, marks: FieldMark[]) {
  return marks.map((mark) => {
    const feature = new Feature({ geometry: fieldGeometry(mark) });
    const color = input.view.style === "ink" ? "#594b36" : atlasColour(mark.channel);
    const stipple = mark.channel.startsWith("population");
    feature.setStyle(
      new Style({
        image: stipple
          ? new Circle({
              radius: 1 + Math.sqrt(mark.weight) * 3,
              fill: new Fill({ color: color + "bb" }),
            })
          : undefined,
        stroke: stipple
          ? undefined
          : new Stroke({ color: color + "b0", width: 0.5 + mark.weight * 1.4 }),
        zIndex: -40,
      })
    );
    return feature;
  });
}
function fieldGeometry(mark: FieldMark) {
  if (mark.channel.startsWith("population")) return new Point(mark.point);
  const angle = ((mark.index % 4) * Math.PI) / 4 + Math.PI / 6;
  const length = mark.spacing * 0.75 * Math.sqrt(mark.weight);
  const dx = (Math.cos(angle) * length) / 2,
    dy = (Math.sin(angle) * length) / 2;
  return new LineString([
    [mark.point[0] - dx, mark.point[1] - dy],
    [mark.point[0] + dx, mark.point[1] + dy],
  ]);
}
