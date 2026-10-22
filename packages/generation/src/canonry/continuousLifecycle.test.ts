import { expect, it } from "vitest";
import { preparedSampleInterpolator } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { initialSteps } from "./sequence";
import { applyNativeStep } from "./contracts";
import { physicalFieldReader, preparePhysicalChannels } from "./continuousState";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { composeNativeAuthoring, type AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { atlasChannels } from "./atlasChannels";

it("tectonic construction commits the field read by the next process and a cold worker", () => {
  const profile = atlasPhysicalProfile();
  const map = createField(createWorldMesh([0, 0, 400_000, 300_000], 256, profile.BoundaryPadding));
  const elevation = map.Elevation;
  for (const step of initialSteps.slice(0, 5))
    applyNativeStep(map, physicalContext(104729, step[1], profile), step);
  expect(map.Elevation).toBe(elevation);
  expect(elevation.some((v) => v !== 0)).toBe(true);
  const source = map.continuous!;
  expect(source.support.x).toBe(map.mesh.x);
  const coefficients = source.coefficients.Elevation!;
  expect(coefficients.dx.every(Number.isFinite)).toBe(true);
  const x = map.mesh.x[10] + map.mesh.spacing * 0.31;
  const y = map.mesh.y[10] + map.mesh.spacing * 0.17;
  const processRead = physicalFieldReader(map, "Elevation")(x, y);
  const cloned = structuredClone({ support: source.support, values: elevation, coefficients });
  const consumer = preparedSampleInterpolator(cloned.support, cloned.values, cloned.coefficients);
  expect(consumer(x + map.mesh.origin[0], y + map.mesh.origin[1])).toBe(processRead);
  const old = coefficients.dx.slice();
  for (const step of initialSteps.slice(5, 7))
    applyNativeStep(map, physicalContext(104729, step[1], profile), step);
  expect(map.continuous!.coefficients.Elevation).toBe(coefficients);
  expect(coefficients.dx).not.toEqual(old);
  expect(Number.isFinite(physicalFieldReader(map, "Elevation")(x, y))).toBe(true);
});

it("prepares sparse adaptive support without holes and keeps retained readers fresh", () => {
  const mesh = createAdaptiveWorldMesh(
    [0, 0, 1000, 1000],
    {
      maximumSize: 250,
      minimumSize: 15.625,
      refine: (box) => box[0] < 200 && box[1] < 200,
    },
    0
  );
  const map = createField(mesh);
  for (let i = 0; i < mesh.count; i++) map.Elevation[i] = 100 + mesh.x[i] * 0.2;
  preparePhysicalChannels(map, []);
  const read = physicalFieldReader(map, "Elevation");
  for (let y = 5; y < 1000; y += 10)
    for (let x = 5; x < 1000; x += 10)
      expect(Number.isFinite(read(x - mesh.origin[0], y - mesh.origin[1]))).toBe(true);
  const previous = read(100, 100);
  for (let i = 0; i < mesh.count; i++) map.Elevation[i] += 200;
  preparePhysicalChannels(map, ["Elevation"]);
  expect(read(100, 100)).toBeCloseTo(previous + 200, 8);
});

it("commits authored terrain and reconciled water together", () => {
  const profile = atlasPhysicalProfile();
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 64, 0));
  map.Elevation.fill(-1024);
  map.WaterSurfaceElevations.fill(0);
  map.WaterDepths.fill(1024);
  map.WaterKindCodes.fill(1);
  preparePhysicalChannels(map, []);
  const depth = physicalFieldReader(map, "WaterDepths");
  const work = {
    map,
    profile,
    samples: new Int32Array(map.mesh.count),
    inherited: false,
    sampling: { maximumSize: 100, minimumSize: 10, featureSamples: 2 },
    fixed: [
      {
        binding: atlasChannels.find((binding) => binding.native === "Elevation")!,
        values: Float64Array.from(map.mesh.x, (x) => -512 + x / 10),
      },
    ],
  } satisfies AtlasPhysicalWorkspace;
  composeNativeAuthoring(work);
  expect(map.WaterDepths.every((value) => value > 0)).toBe(true);
  const x = map.mesh.x[10] + map.mesh.spacing * 0.21;
  const y = map.mesh.y[10] + map.mesh.spacing * 0.17;
  expect(map.continuous!.coefficients.WaterDepths!.dx[10]).toBeCloseTo(-0.1, 10);
  expect(depth(x, y)).toBeCloseTo(512 - x / 10, 8);
});
