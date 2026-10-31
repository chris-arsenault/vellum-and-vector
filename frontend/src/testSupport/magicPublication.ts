import { expect } from "vitest";
import type { FeatureReader, Grid } from "@atlas/domain";
import { generationSource } from "../workspaceGeneration";
import { WorkspaceFields } from "../workspaceFields";
import { workspaceRasters } from "../workspaceRasters";
import { gridPosition, rectangle, spatial } from "@atlas/domain";
import { workspaceCell } from "../workspaceCell";
import type { generatedMagicRegion } from "./generatedMagicRegion";
import { siblingRegion, type RegionalWorkloadOutput } from "./regionalWorkload";

type Fixture = Awaited<ReturnType<typeof generatedMagicRegion>>;

export async function adjacentMagicRegion(f: Fixture) {
  const world = await f.workspace.catalog.readEditor(f.id),
    outline = world.views.find((view) => view.id === world.areas[f.child].regionId)!.region!
      .footprint,
    [w, , e] = spatial.bounds(world.areas[f.root].footprint),
    [x0, y0, x1, y1] = spatial.bounds(outline),
    width = x1 - x0,
    east = e - x1 > x0 - w,
    left = east ? x1 + width / 4 : x0 - width * 1.25;
  return siblingRegion(
    f,
    "Independent adjacent magical country",
    rectangle([left, y0, left + width, y1])
  );
}

export function reportMagicWorkload(step: string, output: RegionalWorkloadOutput) {
  console.info("generated magic Standard region", {
    step,
    samples: output.samples,
    generationMs: output.generationMs,
    phases: output.phases,
    features: output.counts,
  });
}

/** Exact comparisons concern one map's ownership or a repeat from pinned inputs,
 * never numerical agreement between a child and its parent. */
export function magicSamples(grids: Record<string, Grid>) {
  return Object.fromEntries(
    Object.entries(grids).flatMap(([id, grid]) =>
      Object.entries(grid.channels)
        .filter(([name]) => name.startsWith("magic:"))
        .map(([name, values]) => [
          `${id}/${name}`,
          {
            values: Float64Array.from(values),
            unit: grid.units[name],
            quantity: grid.quantities?.[name] ?? "intensive",
          },
        ])
    )
  );
}
export function assertMagicSamples(
  actual: ReturnType<typeof magicSamples>,
  expected: ReturnType<typeof magicSamples>
) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, before] of Object.entries(expected)) {
    const after = actual[key];
    expect(after.unit, key).toBe(before.unit);
    expect(after.quantity, key).toBe(before.quantity);
    expect(after.values.length, key).toBe(before.values.length);
    expect(
      after.values.every((value, i) => Object.is(value, before.values[i])),
      key
    ).toBe(true);
  }
}
export function magicPlaces(features: FeatureReader) {
  return [...features.values()]
    .filter((feature) => feature.layerId === "magic")
    .map(({ kind, name, geometry, footprint }) => ({ kind, name, geometry, footprint }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export async function magicMapState(f: Fixture, areaId: string) {
  const source = await generationSource(f.workspace.catalog, f.id, areaId),
    fields = new WorkspaceFields(
      f.workspace.catalog,
      f.workspace.resources,
      f.workspace.working.cache
    );
  try {
    await fields.read(source, {
      scope: source.scope,
      objects: [],
      spatialLayers: [],
      parentHistory: [],
      dependencies: false,
      channels: source.world.fields
        .map((field) => ({
          fieldId: field.id,
          names: field.channels?.filter((name) => name.startsWith("magic:")) ?? [],
        }))
        .filter((field) => field.names.length > 0),
    });
    return {
      samples: magicSamples(source.numerical),
      records: {
        fields: source.world.fields,
        societies: source.world.societies,
        drainage: source.world.drainage,
        epochs: source.world.epochs,
        features: f.workspace.catalog.exportFeatures(f.id, areaId, null, 128),
      },
    };
  } finally {
    await fields.close();
  }
}
export async function assertMagicMapUnchanged(
  f: Fixture,
  areaId: string,
  before: Awaited<ReturnType<typeof magicMapState>>
) {
  const after = await magicMapState(f, areaId);
  assertMagicSamples(after.samples, before.samples);
  expect(after.records).toEqual(before.records);
}
export async function assertMagicPublication(f: Fixture, areaId: string, grid: Grid) {
  const index = Math.floor(grid.active.length / 2),
    started = performance.now(),
    inspection = await workspaceCell(
      f.workspace,
      f.id,
      areaId,
      gridPosition(grid, index),
      f.workspace.working.cache
    ),
    values = inspection.cells.flatMap((cell) => cell.values);
  for (const name of ["elevation", "water", "magic:fire:stock:vein/held"])
    expect(values.find((value) => value.channel === name)?.value, name).toBe(
      grid.channels[name].get(index)
    );
  console.info("regional cell inspection", {
    milliseconds: performance.now() - started,
    channels: values.length,
  });
  const rasters = await workspaceRasters(f.workspace, f.id, areaId, grid.bounds, 100),
    magic = rasters.filter((raster) => raster.channel.startsWith("magic:"));
  expect(magic.map((raster) => raster.channel).sort()).toEqual(
    Object.keys(grid.channels)
      .filter((name) => name.startsWith("magic:"))
      .sort()
  );
  for (const raster of magic) {
    expect(raster.field.scope.areaId, raster.channel).toBe(areaId);
    expect(spatial.covers(raster.footprint, raster.field.scope.footprint)).toBe(true);
    expect(raster.field.units[raster.channel]).toBe(grid.units[raster.channel]);
    expect(raster.field.quantities[raster.channel]).toBe(
      grid.quantities?.[raster.channel] ?? "intensive"
    );
    if (raster.channel.includes(":stock:"))
      expect(raster.field.quantities[raster.channel], raster.channel).toBe("extensive");
    if (raster.channel.endsWith(":coverage") || raster.channel.includes(":coverage:"))
      expect(raster.field.quantities[raster.channel], raster.channel).toBe("intensive");
  }
}
