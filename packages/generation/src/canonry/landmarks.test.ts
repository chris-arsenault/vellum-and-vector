import { expect, it } from "vitest";
import type { Landmark } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { physicalSchedule } from "./schedule";
import { applyNativeStep } from "./contracts";
import {
  emplaceLandmark,
  maintainLandmark,
  placeLandmark,
  plateDriftSteps,
  signatureShortfall,
  type LandmarkLedger,
} from "./landmarks";
import { canyonCells } from "./landmarkCanyon";

const bounds: [number, number, number, number] = [0, 0, 2_000_000, 1_000_000];
const epochs = [50, -300, 0].map((TemperatureOffset, index) => ({
  StableName: `epoch-${index}`,
  TectonicStrength: 1000,
  HydrologyStrength: 1000,
  GlaciationStrength: 1000,
  CoastalStrength: 1000,
  TemperatureOffset,
  SeaLevelOffset: 0,
}));

/** World coordinates of land cells, farthest from the sea first. */
function interior(map: PhysicalField) {
  const sea: number[] = [],
    land: number[] = [];
  for (let i = 0; i < map.mesh.contentCount; i++)
    (map.WaterKindCodes[i] === 1 ? sea : land).push(i);
  const clearance = (i: number) =>
    sea.reduce(
      (best, j) =>
        Math.min(best, Math.hypot(map.mesh.x[i] - map.mesh.x[j], map.mesh.y[i] - map.mesh.y[j])),
      Infinity
    );
  return land
    .map((i) => ({ i, clearance: clearance(i) }))
    .sort((a, b) => b.clearance - a.clearance)
    .map(({ i, clearance }) => ({
      x: map.mesh.x[i] + map.mesh.origin[0],
      y: map.mesh.y[i] + map.mesh.origin[1],
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
 * Run the reference schedule with landmark emplacement after each epoch's impacts and
 * maintenance before its history, exactly where the atlas sequence places them.
 */
function evolve(seed: number, place: (map: PhysicalField) => Landmark[]) {
  const profile = atlasPhysicalProfile(),
    map = createField(createWorldMesh(bounds, 4096, profile.BoundaryPadding)),
    ledger: LandmarkLedger = new Map(),
    held: Record<string, boolean[]> = {},
    corrections: Record<string, number[]> = {},
    drift = plateDriftSteps(profile, epochs.length);
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
      (held[item.id] ??= []).push(
        Object.keys(signatureShortfall(record, record.measured)).length === 0
      );
      (corrections[item.id] ??= []).push(record.maintenance - before);
    }
  };
  for (const { step, epoch, index, phase } of physicalSchedule(epochs)) {
    if (phase === "geology" && step[0] === "mass-wasting") emplace(index);
    if (step[0] === "physical-epoch-history") maintain(index);
    applyNativeStep(
      map,
      physicalContext(seed, step[1], profile, epoch, index, epochs.length),
      step
    );
  }
  return { map, profile, ledger, held, corrections, landmarks };
}

const seed = 104729;

it("holds every mesh-scale landmark's signature through warm, glacial and present epochs", () => {
  const { map, ledger, held, landmarks } = evolve(seed, placeAll);
  expect(landmarks).toHaveLength(6);
  for (const item of landmarks) {
    const record = ledger.get(item.id)!;
    // The falls is below this mesh's landform rule and reports a latent signature it still holds.
    expect(record.realized, `${item.kind} realized at ${map.mesh.spacing} m`).toBe(
      item.kind !== "falls"
    );
    expect(held[item.id], `${item.kind} held at the end of every epoch`).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      Object.keys(signatureShortfall(record, record.measured)),
      `${item.kind} ${JSON.stringify(record.measured)} vs ${JSON.stringify(record.target)}`
    ).toEqual([]);
    expect(Number.isFinite(record.maintenance) && record.maintenance >= 0).toBe(true);
  }
  expect(map.events.filter((event) => event.kind === "landmark")).toHaveLength(6);
  const falls = ledger.get("falls-1")!;
  // Held within the centimetre of slack that signatureShortfall allows float arithmetic.
  expect(falls.measured.drop).toBeGreaterThanOrEqual(50 - 0.01);
  expect(falls.notes.some((text) => text.includes("latent"))).toBe(true);
  expect(map.faults.some((fault) => fault.id === "landmark:escarpment-1")).toBe(true);
  expect(map.LandmarkMaintenance.some((value) => value > 0)).toBe(true);
  expect(map.AvailableFacts.has("Validated")).toBe(true);
  // The last epoch's cuts are still supply awaiting transport; the ledger invariant holds.
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeLessThanOrEqual(
    map.SedimentProducedTotal * (1 + 1e-9)
  );
});

it("captures the largest divertible river into the canyon and reports where it came from", () => {
  const { map, ledger, landmarks } = evolve(seed, placeAll);
  const canyon = landmarks.find((item) => item.kind === "canyon")!,
    record = ledger.get(canyon.id)!;
  expect(record.capture).not.toBeNull();
  expect(record.notes.some((text) => text.startsWith("Captured the river"))).toBe(true);
  // At present the canyon's head reach carries the captured river's accumulation.
  const placed = placeLandmark(map, canyon)!,
    geometry = canyonCells(map, placed, record.corridor);
  const head = geometry.floor
    .filter((cell) => cell.station <= geometry.line.length / 3)
    .map((cell) => map.FlowAccumulation[cell.i]);
  expect(Math.max(...head)).toBeGreaterThanOrEqual(record.capture!.accumulation * 0.9);
});

it("is deterministic and leaves the world untouched when no landmark is placed", () => {
  const first = evolve(seed, placeAll),
    second = evolve(seed, placeAll),
    none = evolve(seed, () => []);
  expect(first.map.Elevation).toEqual(second.map.Elevation);
  expect([...first.ledger.values()].map((r) => r.measured)).toEqual(
    [...second.ledger.values()].map((r) => r.measured)
  );
  expect(none.ledger.size).toBe(0);
  expect(none.map.LandmarkMaintenance.every((value) => value === 0)).toBe(true);
  expect(none.map.events.some((event) => event.kind === "landmark")).toBe(false);
});
