import { expect, it } from "vitest";
import type { Landmark } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { validateLandscape } from "./surface";
import {
  emplaceLandmark,
  maintainLandmark,
  landmarkRecord,
  placeLandmark,
  signatureShortfall,
  type LandmarkLedger,
} from "./landmarks";
import { captureInto, canyonCells } from "./landmarkCanyon";
import { nearestTriangle } from "./mesh";
import { drainageConditioning } from "./drainageFlood";
import { drainageGuidance } from "./flowGuidance";
import { flowRouting } from "./routing";
import { riverNetwork } from "./rivers";
import { units } from "./math";

const bounds: [number, number, number, number] = [0, 0, 2_000_000, 1_000_000];

/** World coordinates of land cells, farthest from the sea first. */
function interior(map: PhysicalField) {
  const sea: number[] = [],
    land: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    (map.WaterKindCodes.get(i) === 1 ? sea : land).push(i);
  }
  const clearance = (i: number) =>
    sea.reduce(
      (best, j) =>
        Math.min(best, Math.hypot(map.mesh.x(i) - map.mesh.x(j), map.mesh.y(i) - map.mesh.y(j))),
      Infinity
    );
  return land
    .map((i) => ({ i, clearance: clearance(i) }))
    .sort((a, b) => b.clearance - a.clearance)
    .map(({ i, clearance }) => ({
      x: map.mesh.x(i) + map.mesh.origin[0],
      y: map.mesh.y(i) + map.mesh.origin[1],
      clearance,
    }));
}
/** Anchor points at least `apart` metres from each other and `clearance` metres from the sea. */
function anchors(map: PhysicalField, count: number, apart: number, clearance: number) {
  const chosen: { x: number; y: number }[] = [];
  for (const site of interior(map)) {
    if (site.clearance < clearance) break;
    if (chosen.every((c) => Math.hypot(c.x - site.x, c.y - site.y) >= apart)) chosen.push(site);
    if (chosen.length === count) break;
  }
  expect(chosen, "separated interior anchors").toHaveLength(count);
  return chosen;
}
/** A point `length` metres from `from`, heading away from the other anchors. */
function away(from: { x: number; y: number }, others: { x: number; y: number }[], length: number) {
  const dx = others.reduce((sum, o) => sum + (from.x - o.x), 0),
    dy = others.reduce((sum, o) => sum + (from.y - o.y), 0),
    span = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / span) * length, y: from.y + (dy / span) * length };
}
function landmark(
  kind: string,
  geometry: Landmark["geometry"],
  parameters: Record<string, number>
): Landmark {
  return { id: `${kind}-1`, name: kind, kind, geometry, parameters, emplacedAtEpoch: 0 };
}
function path(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    type: "LineString" as const,
    coordinates: [
      [from.x, from.y],
      [(from.x + to.x) / 2, (from.y + to.y) / 2],
      [to.x, to.y],
    ],
  };
}
/** One landmark of each kind on well separated interior sites; the canyon farthest inland. */
function placeAll(map: PhysicalField): Landmark[] {
  const [canyonFrom, mountain, dome, crater, scarpFrom, fallsAt] = anchors(
    map,
    6,
    250_000,
    150_000
  );
  const canyonTo = away(canyonFrom, [mountain, dome, crater, scarpFrom], 150_000);
  const scarpTo = away(scarpFrom, [mountain, dome, crater, canyonFrom], 150_000);
  return [
    landmark(
      "falls",
      { type: "Point", coordinates: [fallsAt.x, fallsAt.y] },
      { drop: 50, discharge: 2400, captureDistance: 150 }
    ),
    landmark(
      "volcanic-mountain",
      { type: "Point", coordinates: [mountain.x, mountain.y] },
      { summit: 4500, prominence: 3000, baseRadius: 60 }
    ),
    landmark(
      "dome-ring",
      { type: "Point", coordinates: [dome.x, dome.y] },
      { diameter: 160, ringCount: 3, ringRelief: 120 }
    ),
    landmark(
      "impact-ring",
      { type: "Point", coordinates: [crater.x, crater.y] },
      { diameter: 90, rimHeight: 300, floorDepth: 500 }
    ),
    landmark("canyon", path(canyonFrom, canyonTo), {
      depth: 900,
      rimWidth: 20,
      captureDistance: 150,
    }),
    landmark("escarpment", path(scarpFrom, scarpTo), { throw: 600, scarpWidth: 20 }),
  ];
}

/**
 * A known inland plateau loses relief between maintenance passes: summits lower
 * and excavations fill toward the original level, challenging each signature.
 * Landmark tests need that disturbance, not an unrelated complete physical history.
 */
function evolve(_seed: number, place: (map: PhysicalField) => Landmark[]) {
  const profile = atlasPhysicalProfile({ landFraction: 0.7 }),
    map = createField(createWorldMesh(bounds, 4096, profile.BoundaryPadding)),
    ledger: LandmarkLedger = new Map(),
    held: Record<string, Record<string, number>[]> = {},
    corrections: Record<string, number[]> = {},
    drift: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const ocean = Math.abs(map.mesh.x(i)) > 900_000 || Math.abs(map.mesh.y(i)) > 400_000;
    map.WaterKindCodes.set(i, ocean ? 1 : 0);
    map.Elevation.set(i, units(ocean ? -500 : 1000));
    map.BedrockElevation.set(i, map.Elevation.get(i));
    map.CrustThickness.set(i, units(4000));
    map.CrustContinentalFraction.set(i, 1000);
    map.RockResistance.set(i, 1000);
  }
  let landmarks: Landmark[] = [];
  const emplace = (index: number) => {
    if (index === 0) landmarks = place(map);
    for (const item of landmarks)
      if (item.emplacedAtEpoch === index) emplaceLandmark(map, profile, item, index, ledger, drift);
  };
  const maintain = (index: number) => {
    for (const item of landmarks) {
      const before = ledger.get(item.id)?.maintenance ?? 0;
      const record = maintainLandmark(map, profile, item, index, ledger, drift)!;
      (held[item.id] ??= []).push(signatureShortfall(record, record.measured));
      (corrections[item.id] ??= []).push(record.maintenance - before);
    }
  };
  emplace(0);
  for (let index = 0; index < 3; index++) {
    if (index > 0)
      for (let i = 0; i < map.mesh.count; i++) {
        if (map.WaterKindCodes.get(i) === 1) continue;
        map.BedrockElevation.set(
          i,
          units(1000) + (map.BedrockElevation.get(i) - units(1000)) * 0.8
        );
        map.Elevation.set(i, map.BedrockElevation.get(i) + map.SedimentThickness.get(i));
      }
    maintain(index);
    validateLandscape(map);
  }
  return { map, profile, ledger, held, corrections, landmarks };
}

const seed = 104729;

it("restores every landmark's signature after repeated controlled relief loss", () => {
  const { map, ledger, held, corrections, landmarks } = evolve(seed, placeAll);
  expect(landmarks).toHaveLength(6);
  for (const item of landmarks) {
    const record = ledger.get(item.id)!;
    // The falls is below this mesh's landform rule and reports a latent signature it still holds.
    expect(record.realized, `${item.kind} realized at ${map.mesh.spacing} m`).toBe(
      item.kind !== "falls"
    );
    expect(held[item.id], `${item.kind} held after every disturbance`).toEqual([{}, {}, {}]);
    expect(
      Object.keys(signatureShortfall(record, record.measured)),
      `${item.kind} ${JSON.stringify(record.measured)} vs ${JSON.stringify(record.target)}`
    ).toEqual([]);
    expect(Number.isFinite(record.maintenance) && record.maintenance >= 0).toBe(true);
    expect(
      corrections[item.id].slice(1).some((value) => value > 0),
      `${item.kind} required repair`
    ).toBe(true);
  }
  expect(map.events.filter((event) => event.kind === "landmark")).toHaveLength(6);
  const falls = ledger.get("falls-1")!;
  // Held within the centimetre of slack that signatureShortfall allows float arithmetic.
  expect(falls.measured.drop).toBeGreaterThanOrEqual(50 - 0.01);
  expect(falls.notes.some((text) => text.includes("latent"))).toBe(true);
  expect(map.faults.some((fault) => fault.id === "landmark:escarpment-1")).toBe(true);
  expect(Array.from(map.LandmarkMaintenance).some((value) => value > 0)).toBe(true);
  // The last epoch's cuts are still supply awaiting transport; the ledger invariant holds.
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeLessThanOrEqual(
    map.SedimentProducedTotal * (1 + 1e-9)
  );
});

/** River cells southwest of the head within capture reach, largest flow first. */
function southernRivers(map: PhysicalField, head: number) {
  return Array.from({ length: map.mesh.count }, (_, i) => i)
    .filter(
      (i) =>
        map.RiverOrders.get(i) > 0 &&
        map.mesh.y(i) < 0 &&
        map.mesh.x(i) < 0 &&
        Math.hypot(map.mesh.x(i) - map.mesh.x(head), map.mesh.y(i) - map.mesh.y(head)) < 150_000
    )
    .sort((a, b) => map.FlowAccumulation.get(b) - map.FlowAccumulation.get(a));
}
it("captures the largest divertible river into the canyon and reports where it came from", () => {
  // Two east-draining valleys: the wet southern river can be incised into the
  // lower northern canyon. Later climate is free to move or remove a river.
  const map = createField(createWorldMesh([0, 0, 400_000, 300_000], 1024, 0)),
    context = physicalContext(seed, 0, atlasPhysicalProfile());
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i),
      y = map.mesh.y(i);
    map.Elevation.set(
      i,
      units((y >= 0 ? 300 : 700) - x * 0.001 + (Math.abs(y) - 60_000) ** 2 * 0.00000005)
    );
    map.BedrockElevation.set(i, map.Elevation.get(i));
    map.Runoff.set(i, y < 0 ? 1000 : 20);
    if (x > 180_000) map.WaterKindCodes.set(i, 1);
  }
  const route = () => {
    drainageConditioning(map, context);
    drainageGuidance(map, context);
    flowRouting(map, context);
    riverNetwork(map, context);
  };
  route();
  const head = nearestTriangle(map.mesh, 0, 60_000),
    candidates = southernRivers(map, head);
  expect(candidates.length).toBeGreaterThan(1);
  const [largest, smaller] = candidates;
  map.RiverOrders.fill(0);
  map.RiverOrders.set(largest, 1);
  map.RiverOrders.set(smaller, 1);
  const placed = placeLandmark(
      map,
      landmark("canyon", path({ x: 200_000, y: 210_000 }, { x: 300_000, y: 210_000 }), {
        depth: 900,
        rimWidth: 20,
        captureDistance: 150,
      })
    )!,
    record = landmarkRecord(map, placed),
    geometry = canyonCells(map, placed),
    headReach = new Set(
      geometry.floor
        .filter((cell) => cell.station <= geometry.line.length / 3)
        .map((cell) => cell.i)
    ),
    discharge = map.FlowAccumulation.get(largest),
    runoff = Array.from(map.Runoff);
  captureInto(map, record, {
    head,
    floor: new Set(geometry.floor.map((cell) => cell.i)),
    floorWidth: map.mesh.spacing,
    reach: 150_000,
    label: "canyon head",
  });
  expect(record.capture).toEqual({
    x: map.mesh.x(largest),
    y: map.mesh.y(largest),
    accumulation: discharge,
  });
  expect(record.notes.some((text) => text.startsWith("Captured the river"))).toBe(true);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
  route();
  let current = largest;
  for (let n = 0; n < map.mesh.count && current >= 0 && !headReach.has(current); n++)
    current = map.FlowTargets.get(current);
  expect(headReach.has(current), "the captured river reaches the canyon head").toBe(true);
  expect(
    Math.max(...Array.from(headReach, (i) => map.FlowAccumulation.get(i)))
  ).toBeGreaterThanOrEqual(discharge * 0.9);
  expect(Array.from(map.Runoff)).toEqual(runoff);
});

it("is deterministic and leaves the world untouched when no landmark is placed", () => {
  const first = evolve(seed, placeAll),
    second = evolve(seed, placeAll),
    none = evolve(seed, () => []);
  expect(Array.from(first.map.Elevation)).toEqual(Array.from(second.map.Elevation));
  expect([...first.ledger.values()].map((r) => r.measured)).toEqual(
    [...second.ledger.values()].map((r) => r.measured)
  );
  expect(none.ledger.size).toBe(0);
  expect(Array.from(none.map.LandmarkMaintenance).every((value) => value === 0)).toBe(true);
  expect(none.map.events.some((event) => event.kind === "landmark")).toBe(false);
});
