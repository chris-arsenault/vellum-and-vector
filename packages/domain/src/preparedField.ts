import {
  prepareSampleCoefficients,
  preparedSampleInterpolator,
  type SampleCoefficients,
} from "./smoothSamples";
import {
  prepareAdaptiveCoefficients,
  preparedAdaptiveInterpolator,
  type PreparedAdaptiveCoefficients,
} from "./adaptivePoint";
import { visitAdaptiveOverlap } from "./adaptiveTransfer";
import type { Grid } from "./grids";
import type { SampleSupport, SampleEnclosure } from "./smoothSamples";
import type { Position } from "./model";
import { adaptiveCell, adaptiveGeometry } from "./adaptiveTopology";
import { adaptiveInterval, adaptiveGradientInterval } from "./adaptiveExtrema";
import { type EncloseSegment } from "./sampleSegmentBounds";
import { samplePositiveSupport } from "./samplePositiveSupport";
import { adaptiveSegmentReader } from "./adaptiveSegment";

export type NumericValues = (Float64Array | Float32Array | Int32Array | Uint8Array) & {
  reduce(callback: (sum: number, value: number, i: number) => number, initial: number): number;
};
export interface ChannelTransform {
  scale: number;
  offset: number;
}
export interface PreparedField {
  support: SampleSupport;
  coefficients: Record<string, SampleCoefficients>;
  transforms: Record<string, ChannelTransform>;
  adaptive?: Record<string, PreparedAdaptiveCoefficients>;
}
export interface PreparedChannelData {
  province?: { partition: import("./tectonicField").ProvincePartition; values: number[] };
  coefficients?: SampleCoefficients;
  adaptive?: PreparedAdaptiveCoefficients;
  transform?: ChannelTransform;
}
export function preparedValue(
  support: SampleSupport,
  values: ArrayLike<number>,
  data: PreparedChannelData
) {
  if (!data.adaptive && !data.coefficients)
    throw new Error("Generation must prepare field coefficients before delivery.");
  const at = data.adaptive
      ? adaptiveReader(data.adaptive)
      : preparedSampleInterpolator(support, values, data.coefficients!),
    transform = data.transform ?? { scale: 1, offset: 0 };
  const read = (x: number, y: number) => at(x, y) * transform.scale + transform.offset;
  const scale = (range: number[], offset = 0): [number, number] =>
    transform.scale === 0
      ? [offset, offset]
      : [
          Math.min(...range.map((v) => v * transform.scale + offset)),
          Math.max(...range.map((v) => v * transform.scale + offset)),
        ];
  return Object.assign(read, {
    positiveSupport: () => {
      if (transform.scale <= 0 || transform.offset !== 0) return null;
      if (!data.adaptive) return samplePositiveSupport(support, values, data.coefficients!);
      // For a nonnegative patch with low=0 and high>0, clamping does not
      // change where f>0. Trace its signed polynomial so a zero plateau is
      // certified by negative bounds instead of refining its whole area.
      return adaptiveReader(data.adaptive, true);
    },
    segment: ((a, b, level) => {
      const result = at.segment(
        a,
        b,
        level === undefined ? undefined : (level - transform.offset) / transform.scale
      );
      return { range: scale(result.range, transform.offset), derivative: scale(result.derivative) };
    }) as EncloseSegment,
    enclose: (
      box: Parameters<typeof at.bounds>[0],
      candidates?: number[],
      level?: number
    ): SampleEnclosure => {
      const e = at.enclose(
        box,
        candidates,
        level === undefined ? undefined : (level - transform.offset) / transform.scale
      );
      return {
        range: scale(e.range, transform.offset),
        gradient: [scale(e.gradient[0]), scale(e.gradient[1])],
      };
    },
  });
}
export function prepareGridChannel(grid: Grid, name: string, supplied?: PreparedChannelData) {
  const province = supplied?.province;
  if (province) {
    const geography = (grid.geography ??= {});
    geography.provinces = {
      ...geography.provinces,
      [name]: province,
    };
  } else if (grid.geography?.provinces?.[name]) {
    grid.geography.provinces = { ...grid.geography.provinces };
    delete grid.geography.provinces[name];
  }
  if (!grid.mesh && !grid.topology && !grid.prepared) return;
  const support =
    grid.mesh ??
    grid.prepared?.support ??
    (() => {
      const g = adaptiveGeometry(grid.topology!);
      return {
        x: g.x,
        y: g.y,
        origin: [0, 0] as [number, number],
        spacing: Math.sqrt(grid.measures.reduce((a, b) => a + b, 0) / grid.measures.length),
      };
    })();
  const field = (grid.prepared ??= { support, coefficients: {}, transforms: {} });
  delete field.coefficients[name];
  if (field.adaptive) delete field.adaptive[name];
  delete field.transforms[name];
  if (supplied?.transform) field.transforms[name] = supplied.transform;
  if (province) return;
  if (grid.quantities?.[name] !== "intensive") return;
  if (supplied?.adaptive) (field.adaptive ??= {})[name] = supplied.adaptive;
  else if (supplied?.coefficients) field.coefficients[name] = supplied.coefficients;
  else if (grid.topology)
    (field.adaptive ??= {})[name] = prepareAdaptiveCoefficients(grid.topology, grid.channels[name]);
  else if (grid.mesh?.adaptive) {
    const { topology, leafToSample } = grid.mesh.adaptive;
    (field.adaptive ??= {})[name] = prepareAdaptiveCoefficients(
      topology,
      (leaf) => grid.channels[name][leafToSample[leaf]]
    );
  } else field.coefficients[name] = prepareSampleCoefficients(field.support, grid.channels[name]);
}
export function channelValue(grid: Grid, name: string, i: number) {
  const value = grid.channels[name][i],
    transform = grid.prepared?.transforms[name];
  return transform ? value * transform.scale + transform.offset : value;
}
/** An algorithm's temporary unit conversion, never another stored geographic map. */
export function channelValues(grid: Grid, name: string): Float64Array {
  const source = grid.channels[name];
  if (!grid.prepared?.transforms[name] && source instanceof Float64Array) return source;
  return Float64Array.from(source, (_, i) => channelValue(grid, name, i));
}
export function preparedChannel(grid: Grid, name: string) {
  const field = grid.prepared,
    coefficients = field?.coefficients[name],
    adaptive = field?.adaptive?.[name];
  if (!field || (!coefficients && !adaptive))
    throw new Error(`Generation has not prepared field ${name}.`);
  const at = adaptive
      ? adaptiveReader(adaptive)
      : preparedSampleInterpolator(field.support, grid.channels[name], coefficients!),
    transform = field.transforms[name] ?? { scale: 1, offset: 0 };
  const total =
    name === "maximumGroundedIceFlux" && grid.channels.maximumIceFlux
      ? preparedChannel(grid, "maximumIceFlux")
      : null;
  const read = (p: Position): number =>
    Math.min(at(p.x, p.y) * transform.scale + transform.offset, total ? total(p) : Infinity);
  return Object.assign(read, {
    bounds: (box: Parameters<typeof at.bounds>[0], candidates?: number[]): [number, number] => {
      const range = at.bounds(box, candidates).map((v) => v * transform.scale + transform.offset);
      const maximum = total?.bounds(box, candidates);
      return [
        Math.min(Math.min(...range), maximum?.[0] ?? Infinity),
        Math.min(Math.max(...range), maximum?.[1] ?? Infinity),
      ];
    },
  });
}
function adaptiveReader(field: PreparedAdaptiveCoefficients, positiveSupport = false) {
  return Object.assign(preparedAdaptiveInterpolator(field, undefined, positiveSupport), {
    segment: adaptiveSegmentReader(field, positiveSupport),
    enclose: (
      box: Parameters<typeof visitAdaptiveOverlap>[1],
      _candidates?: number[],
      level?: number
    ): SampleEnclosure => {
      const cells: number[] = [];
      visitAdaptiveOverlap(field.topology, box, (i) => cells.push(i));
      const hull: [number, number] = [
        Math.min(...cells.map((i) => field.cells[i].low)),
        Math.max(...cells.map((i) => field.cells[i].high)),
      ];
      if (level !== undefined && (hull[0] > level || hull[1] <= level))
        return {
          range: hull,
          gradient: [
            [-Infinity, Infinity],
            [-Infinity, Infinity],
          ],
        };
      const result: SampleEnclosure = {
        range: [Infinity, -Infinity],
        gradient: [
          [Infinity, -Infinity],
          [Infinity, -Infinity],
        ],
      };
      for (const i of cells) {
        const b = adaptiveCell(field.topology, i);
        const piece = {
          i,
          box: [
            Math.max(b[0], box[0]),
            Math.max(b[1], box[1]),
            Math.min(b[2], box[2]),
            Math.min(b[3], box[3]),
          ] as typeof box,
        };
        for (const [target, range] of [
          [result.range, adaptiveInterval(field.topology, field.cells[i], piece, positiveSupport)],
          [
            result.gradient[0],
            adaptiveGradientInterval(field.topology, field.cells[i], piece, 0, positiveSupport),
          ],
          [
            result.gradient[1],
            adaptiveGradientInterval(field.topology, field.cells[i], piece, 1, positiveSupport),
          ],
        ]) {
          target[0] = Math.min(target[0], range[0]);
          target[1] = Math.max(target[1], range[1]);
        }
      }
      return result;
    },
    bounds: (box: Parameters<typeof visitAdaptiveOverlap>[1]) => {
      let low = Infinity,
        high = -Infinity;
      visitAdaptiveOverlap(field.topology, box, (i) => {
        const b = adaptiveCell(field.topology, i);
        const range = adaptiveInterval(
          field.topology,
          field.cells[i],
          {
            i,
            box: [
              Math.max(b[0], box[0]),
              Math.max(b[1], box[1]),
              Math.min(b[2], box[2]),
              Math.min(b[3], box[3]),
            ],
          },
          positiveSupport
        );
        low = Math.min(low, range[0]);
        high = Math.max(high, range[1]);
      });
      return [low, high] as [number, number];
    },
  });
}
