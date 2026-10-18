import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createMesh, nearestTriangle, triangleIdentity } from "./mesh";
import { fractalNoise, hashUnit } from "./noise";
import { physicalProfile } from "./profile";
import { createField, type PhysicalField } from "./field";
import { physicalContext } from "./context";
import { continentalDomains, tectonicProvinces } from "./provinces";
import { continentalSutures } from "./sutures";
import { tectonicMargins } from "./margins";
import { tectonicUplift } from "./uplift";
import { initializeLandscape } from "./surface";
import { orogenicConstruction } from "./orogeny";
import { massWasting } from "./massWasting";
import { crustalSupport, lithosphericFlexure } from "./support";
import { mantlePlumeRoots } from "./plumes";
import { volcanicConstruction } from "./volcanism";
import { impactCratering } from "./impacts";
import { oceanConnectivity } from "./ocean";
import { continentalMarginEvolution, marineSedimentation } from "./continentalMargins";
import { coastalDetail } from "./coastalDetail";
import { fractureNetwork } from "./fractures";
import { geothermal } from "./geothermal";
import { plateAdvection } from "./advection";
import { climateSteps, drainageSteps } from "./sequence";
import { physicalSchedule } from "./schedule";
import { applyNativeStep } from "./contracts";

const reference = JSON.parse(
  readFileSync(new URL("../../fixtures/canonry-foundation.json", import.meta.url), "utf8")
);
function matchesReference(
  field: PhysicalField,
  expected: Record<string, { count: number; sha256: string }>
) {
  for (const [name, referenceField] of Object.entries(expected)) {
    const values = Float64Array.from(field[name as keyof PhysicalField] as Int32Array);
    expect(values.length, name).toBe(referenceField.count);
    expect(createHash("sha256").update(Buffer.from(values.buffer)).digest("hex"), name).toBe(
      referenceField.sha256
    );
  }
}

it("matches Canonry's unsigned 64-bit hashing and rotated fractal noise", () => {
  for (const p of reference.hashes) expect(hashUnit(p.salt, p.x, p.y)).toBe(p.value);
  for (const p of reference.noise)
    expect(fractalNoise(p.x, p.y, p.salt, p.scale, p.octaves)).toBeCloseTo(p.value, 14);
});
it("matches Canonry's complete multi-epoch geography, sediment and ice evolution", () => {
  const profile = { ...physicalProfile, BoundaryPaddingSteps: 8 };
  const field = createField(createMesh(2048, 8));
  const epochs = [0, 1].map((index) => ({
    StableName: `epoch-${index}`,
    TectonicStrength: 1000,
    HydrologyStrength: 1000,
    GlaciationStrength: 1000,
    CoastalStrength: 1000,
    TemperatureOffset: 0,
    SeaLevelOffset: 0,
  }));
  const schedule = physicalSchedule(epochs);
  for (const [position, instruction] of schedule.entries()) {
    const { step, epoch, index, phase } = instruction;
    applyNativeStep(
      field,
      physicalContext(104729, step[1], profile, epoch, index, epochs.length),
      step
    );
    if (schedule[position + 1]?.phase === phase) continue;
    const key = phase === "present" ? "present" : `${index}-${phase}`;
    if (reference.evolution[key]) matchesReference(field, reference.evolution[key]);
  }
});
it("matches Canonry's mesh ordering, stable identities and three-edge topology", () => {
  const mesh = createMesh(32, 2);
  expect(mesh.count).toBe(reference.mesh.count);
  for (const [i, triangle] of reference.mesh.triangles.entries()) {
    expect([mesh.x[i], mesh.y[i]]).toEqual([Math.fround(triangle.x), Math.fround(triangle.y)]);
    expect(triangleIdentity(mesh, i)).toBe(triangle.identity);
    expect(Array.from(mesh.neighbors.slice(i * 3, i * 3 + 3))).toEqual(triangle.neighbors);
    expect(Array.from(mesh.edgeX.slice(i * 3, i * 3 + 3))).toEqual(triangle.edgeX.map(Math.fround));
    expect(Array.from(mesh.edgeY.slice(i * 3, i * 3 + 3))).toEqual(triangle.edgeY.map(Math.fround));
    expect(Boolean(mesh.boundary[i])).toBe(triangle.boundary);
    expect(nearestTriangle(mesh, mesh.x[i], mesh.y[i])).toBe(i);
  }
});
it("uses Canonry's numerical defaults without replacing their physical parameters", () => {
  for (const [name, value] of Object.entries(physicalProfile))
    if (name !== "QualityTargets") expect(reference.profile[name]).toBe(value);
});
it("matches Canonry's initial geology and transported material history against the C# reference", () => {
  const profile = { ...physicalProfile, BoundaryPaddingSteps: 8 };
  const field = createField(createMesh(2048, 8));
  tectonicProvinces(field, physicalContext(104729, 0x6b31e7, profile));
  continentalDomains(field, physicalContext(104729, 0x12e5a91, profile));
  continentalSutures(field, physicalContext(104729, 0, profile));
  tectonicMargins(field, physicalContext(104729, 0, profile));
  tectonicUplift(field, physicalContext(104729, 0x4f2b17, profile));
  initializeLandscape(field);
  orogenicConstruction(field, physicalContext(104729, 0x7249d3, profile));
  mantlePlumeRoots(field, physicalContext(104729, 0x37c1, profile));
  volcanicConstruction(field, physicalContext(104729, 0x73a91d, profile));
  impactCratering(field, physicalContext(104729, 0x4d73a1, profile));
  massWasting(field, physicalContext(104729, 0, profile));
  crustalSupport(field, physicalContext(104729, 0, profile), false);
  lithosphericFlexure(field, physicalContext(104729, 0, profile));
  oceanConnectivity(field, physicalContext(104729, 0, profile));
  continentalMarginEvolution(field, physicalContext(104729, 0, profile));
  marineSedimentation(field, physicalContext(104729, 0, profile));
  crustalSupport(field, physicalContext(104729, 0, profile), false);
  lithosphericFlexure(field, physicalContext(104729, 0, profile));
  oceanConnectivity(field, physicalContext(104729, 0, profile));
  coastalDetail(field, physicalContext(104729, 0x2ba7d1, profile));
  oceanConnectivity(field, physicalContext(104729, 0, profile));
  fractureNetwork(field, physicalContext(104729, 0x6f9d2b1, profile));
  geothermal(field, physicalContext(104729, 0x152b37, profile));
  matchesReference(field, reference.geology.initial);
  for (const [, salt, process] of [...climateSteps, ...drainageSteps])
    process(field, physicalContext(104729, salt, profile));
  matchesReference(field, reference.geology.climate);
  const epoch = {
    StableName: "reference-epoch",
    TectonicStrength: 1000,
    HydrologyStrength: 1000,
    GlaciationStrength: 1000,
    CoastalStrength: 1000,
    TemperatureOffset: 0,
    SeaLevelOffset: 0,
  };
  plateAdvection(field, physicalContext(104729, 0, profile, epoch, 0, 3));
  matchesReference(field, reference.geology.advected);
});
