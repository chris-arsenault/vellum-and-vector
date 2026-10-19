import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMesh, nearestTriangle, triangleIdentity } from "./mesh";
import { fractalNoise, hashUnit } from "./noise";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { physicalSchedule } from "./schedule";
import { applyNativeStep } from "./contracts";

const reference = JSON.parse(
  readFileSync(new URL("../../fixtures/canonry-foundation.json", import.meta.url), "utf8")
);

it("retains the established deterministic hashing and noise primitives", () => {
  for (const p of reference.hashes) expect(hashUnit(p.salt, p.x, p.y)).toBe(p.value);
  for (const p of reference.noise)
    expect(fractalNoise(p.x, p.y, p.salt, p.scale, p.octaves)).toBeCloseTo(p.value, 14);
});

it("retains triangle identities and three-edge topology", () => {
  const mesh = createMesh(32, 2);
  expect(mesh.count).toBe(reference.mesh.count);
  for (const [i, triangle] of reference.mesh.triangles.entries()) {
    expect(triangleIdentity(mesh, i)).toBe(triangle.identity);
    expect(Array.from(mesh.neighbors.slice(i * 3, i * 3 + 3))).toEqual(triangle.neighbors);
    expect(nearestTriangle(mesh, mesh.x[i], mesh.y[i])).toBe(i);
  }
});

it("carries construction, erosion, sediment and ice through warm, glacial and present epochs", () => {
  const profile = atlasPhysicalProfile();
  const field = createField(
    createWorldMesh([0, 0, 2_000_000, 1_000_000], 4096, profile.BoundaryPadding)
  );
  const epochs = [50, -300, 0].map((TemperatureOffset, index) => ({
    StableName: `epoch-${index}`,
    TectonicStrength: 1000,
    HydrologyStrength: 1000,
    GlaciationStrength: 1000,
    CoastalStrength: 1000,
    TemperatureOffset,
    SeaLevelOffset: 0,
  }));
  for (const instruction of physicalSchedule(epochs)) {
    const { step, epoch, index } = instruction;
    try {
      applyNativeStep(
        field,
        physicalContext(104729, step[1], profile, epoch, index, epochs.length),
        step
      );
    } catch (cause) {
      throw new Error(`${instruction.phase}/${index}/${step[0]}`, { cause });
    }
  }
  expect(field.CompletedEpochCount).toBe(3);
  expect(field.AvailableFacts.has("Validated")).toBe(true);
  expect(field.events.some((event) => event.kind === "impact")).toBe(true);
  expect(field.VolcanicConstructionHistory.some((value) => value > 0)).toBe(true);
  expect(field.CumulativeFluvialErosion.some((value) => value > 0)).toBe(true);
  expect(field.CumulativeGlacialErosion.some((value) => value > 0)).toBe(true);
  expect(field.MaximumGroundedIceFlux.some((value) => value > profile.GlacierFluxThreshold)).toBe(
    true
  );
  expect(
    Math.abs(
      field.SedimentProducedTotal - field.SedimentDepositedTotal - field.SedimentExportedTotal
    )
  ).toBeLessThan(field.SedimentProducedTotal * 1e-8);
});
