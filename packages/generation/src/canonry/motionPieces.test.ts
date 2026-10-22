import { expect, it } from "vitest";
import {
  createAdaptiveTopology,
  createGrid,
  gridPosition,
  putChannel,
  rectangle,
  spatial,
} from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { prepareMotionPieces } from "./motionPieces";
import { affinePoint } from "./materialAffine";
import { provinceTransport } from "./provinceTransport";
import { buildTransportPlan, weightScale } from "./transportPlan";

function fixture() {
  const bounds: [number, number, number, number] = [0, 0, 100, 100],
    footprint = rectangle(bounds);
  const map = createField(
    adaptivePhysicalMesh(
      createAdaptiveTopology(bounds, { maximumSize: 100, minimumSize: 100 }),
      footprint
    )
  );
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 100,
    strength: 0,
    sites: [{ x: 0, y: 0, priority: 0, assembly: 1, motionX: 0, motionY: 0 }],
  };
  const scope = {
    worldId: "world",
    areaId: "area",
    spaceId: "surface",
    footprint,
    crsId: "fictional",
    revision: 1,
    time: "present",
    resolution: 10,
  };
  return { map, scope };
}
it("composes subcell X/Y scopes without a native sample mask", () => {
  const { map, scope } = fixture(),
    x = createGrid("x", { ...scope, footprint: rectangle([10, 10, 20, 20]) }, 2, 2),
    y = createGrid("y", { ...scope, footprint: rectangle([15, 15, 25, 25]) }, 2, 2);
  putChannel(x, "crustMotionX", "ratio", new Float64Array(4).fill(1));
  putChannel(y, "crustMotionY", "ratio", new Float64Array(4).fill(2));
  map.authoredMotion = [
    { channel: "crustMotionX", source: x, footprint: x.scope.footprint },
    { channel: "crustMotionY", source: y, footprint: y.scope.footprint },
  ];
  expect(map.mesh.count).toBe(1);
  const pieces = prepareMotionPieces(map, 5);
  for (const [source, expected] of [
    [
      [12, 12],
      [17, 12],
    ],
    [
      [17, 17],
      [22, 27],
    ],
    [
      [23, 23],
      [23, 33],
    ],
    [
      [50, 50],
      [50, 50],
    ],
  ] as const) {
    const piece = pieces.find((p) =>
      spatial.pointCoverage(p.source)({ x: source[0], y: source[1], z: 0 })
    )!;
    expect(affinePoint(piece.forward, [...source])).toEqual(expected);
    expect(piece.density).toBe(1);
  }
  expect(pieces.reduce((sum, p) => sum + spatial.area(p.source), 0)).toBeCloseTo(10000, 8);
});
it.each([2, 4, 8])(
  "integrates affine authored compression with conserved source area at detail%s",
  (detail) => {
    const { map, scope } = fixture(),
      source = createGrid("compression", scope, 3, 3);
    putChannel(
      source,
      "crustMotionX",
      "ratio",
      Float64Array.from(source.active, (_, i) => -gridPosition(source, i).x / 20)
    );
    map.authoredMotion = [{ channel: "crustMotionX", source, footprint: scope.footprint }];
    map.motionDetail = detail;
    const pieces = prepareMotionPieces(map, 10);
    expect(pieces.reduce((sum, p) => sum + spatial.area(p.source), 0)).toBeCloseTo(10000, 6);
    expect(spatial.area(spatial.unionAll(pieces.map((p) => p.image)))).toBeCloseTo(5000, 6);
    for (const p of pieces) {
      expect(p.density).toBeCloseTo(2, 10);
      expect(affinePoint(p.forward, [25, 25])).toEqual([12.5, 25]);
    }
  }
);

it.each([
  { point: false, residual: 0 },
  { point: true, residual: 0 },
  { point: false, residual: 1e-9 },
])("conserves compressed material and retains its winning history (%s)", ({ point, residual }) => {
  const { map, scope } = fixture();
  map.mesh = adaptivePhysicalMesh(
    createAdaptiveTopology([0, 0, 100, 100], { maximumSize: 50, minimumSize: 50 }),
    scope.footprint
  );
  const patch = createGrid("collapse", scope, 3, 3);
  putChannel(
    patch,
    "crustMotionX",
    "ratio",
    Float64Array.from(patch.active, (_, i) => 50 - (1 - residual) * gridPosition(patch, i).x)
  );
  map.authoredMotion = [{ channel: "crustMotionX", source: patch, footprint: scope.footprint }];
  if (point) {
    putChannel(
      patch,
      "crustMotionY",
      "ratio",
      Float64Array.from(patch.active, (_, i) => 50 - gridPosition(patch, i).y)
    );
    map.authoredMotion.push({
      channel: "crustMotionY",
      source: patch,
      footprint: scope.footprint,
    });
  }
  const transport = provinceTransport(map, 1);
  for (let i = 0; i < map.mesh.count; i++)
    expect(transport.contributions!(i).reduce((sum, v) => sum + v.fraction, 0)).toBeCloseTo(1, 8);
  expect(transport.sourceAt(50, 50)).toEqual(point ? [0, 0] : [0, 50]);
  expect(transport.transport(rectangle([60, 10, 80, 80]))).toBeNull();
  const history = transport.transport(scope.footprint);
  expect(history).not.toBeNull();
  expect(spatial.pointCoverage(history!)({ x: 50, y: 50, z: 0 })).toBe(true);
  expect(spatial.area(history!)).toBe(0);
});

it.each([1.4e-8, 2.7e-8])(
  "conserves source material when a compressed image rounds to a different area (%s)",
  (residual) => {
    const { map, scope } = fixture(),
      patch = createGrid("near-collapse", scope, 3, 3);
    putChannel(
      patch,
      "crustMotionX",
      "ratio",
      Float64Array.from(patch.active, (_, i) => 50 - (1 - residual) * gridPosition(patch, i).x)
    );
    map.authoredMotion = [{ channel: "crustMotionX", source: patch, footprint: scope.footprint }];
    const transport = provinceTransport(map, 1);
    expect(transport.contributions!(0).reduce((sum, v) => sum + v.fraction, 0)).toBeCloseTo(1, 8);
  }
);

it("moves material from an authored patch between native samples", () => {
  const { map, scope } = fixture();
  map.mesh = adaptivePhysicalMesh(
    createAdaptiveTopology([0, 0, 100, 100], { maximumSize: 50, minimumSize: 50 }),
    scope.footprint
  );
  const patch = createGrid("small", { ...scope, footprint: rectangle([45, 10, 49, 20]) }, 2, 2);
  putChannel(patch, "crustMotionX", "ratio", new Float64Array(4).fill(1));
  map.authoredMotion = [
    { channel: "crustMotionX", source: patch, footprint: patch.scope.footprint },
  ];
  const transport = provinceTransport(map, 10),
    plan = buildTransportPlan(map, 10);
  const source = Array.from(map.mesh.x).findIndex(
    (x, i) => x + map.mesh.origin[0] === 25 && map.mesh.y[i] + map.mesh.origin[1] === 25
  );
  const target = Array.from(map.mesh.x).findIndex(
    (x, i) => x + map.mesh.origin[0] === 75 && map.mesh.y[i] + map.mesh.origin[1] === 25
  );
  let total = 0,
    arrived = 0;
  for (let n = plan.offsets[source]; n < plan.offsets[source + 1]; n++) {
    total += plan.weights[n];
    if (plan.targets[n] === target) arrived += plan.weights[n];
  }
  expect(total / weightScale).toBeCloseTo(1, 10);
  expect(arrived / weightScale).toBeCloseTo(40 / 2500, 10);
  expect(transport.sourceAt(57, 15)).toEqual([47, 15]);
  expect(spatial.area(transport.transport(patch.scope.footprint)!)).toBeCloseTo(40, 8);
});

it("selects compressed unhistoried material ahead of a lighter arrival", () => {
  const { map, scope } = fixture(),
    patch = createGrid("compression", { ...scope, footprint: rectangle([20, 10, 40, 20]) }, 2, 2);
  putChannel(
    patch,
    "crustMotionX",
    "ratio",
    Float64Array.from(patch.active, (_, i) => -gridPosition(patch, i).x / 20)
  );
  map.authoredMotion = [
    { channel: "crustMotionX", source: patch, footprint: patch.scope.footprint },
  ];
  const transport = provinceTransport(map, 10);
  expect(transport.sourceAt(15, 15)).toEqual([30, 15]);
  const oldHistory = transport.transport(rectangle([11, 11, 19, 19]));
  expect(oldHistory ? spatial.area(oldHistory) : 0).toBe(0);
  expect(spatial.area(transport.transport(patch.scope.footprint)!)).toBeCloseTo(100, 8);
});

it.each([2, 4, 8])(
  "retains both folded donors in material transfer and resolves history ties at detail%s",
  (detail) => {
    const { map, scope } = fixture(),
      patch = createGrid("fold", scope, 3, 3);
    putChannel(
      patch,
      "crustMotionX",
      "ratio",
      Float64Array.from(patch.active, (_, i) => {
        const x = gridPosition(patch, i).x;
        return Math.abs(x - 50) - x;
      })
    );
    map.authoredMotion = [
      { channel: "crustMotionX", source: patch, footprint: patch.scope.footprint },
    ];
    map.motionDetail = detail;
    const transport = provinceTransport(map, 1);
    expect(transport.contributions!(0).reduce((sum, v) => sum + v.fraction, 0)).toBeCloseTo(1, 8);
    expect(transport.sourceAt(20, 25)).toEqual([30, 25]);
    const rightHistory = transport.transport(rectangle([60, 10, 80, 40]));
    expect(rightHistory ? spatial.area(rightHistory) : 0).toBe(0);
    expect(spatial.area(transport.transport(scope.footprint)!)).toBeCloseTo(5000, 6);
  }
);
