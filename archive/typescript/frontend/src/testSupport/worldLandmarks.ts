import { expect } from "vitest";
import { landmarkKind, landmarkLayer, spatial, type DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "@atlas/generation";

export function assertWorldLandmarks(
  source: DomainSnapshot,
  published: DomainSnapshot,
  input: AtlasGenerationInput
) {
  const records = published.world.landmarks,
    parameters = input.resolvedFeatures!.parameters,
    magic = (record: { kind: string }) => Boolean(landmarkKind(record.kind)?.system),
    [w, s, e, n] = spatial.bounds(source.world.reference.domain);
  expect(parameters.landscapeLandmarks).toBeGreaterThan(0);
  expect(parameters.magicLandmarks).toBeGreaterThan(0);
  expect(records.filter((record) => !magic(record))).toHaveLength(parameters.landscapeLandmarks);
  expect(records.filter(magic)).toHaveLength(parameters.magicLandmarks);
  expect(new Set(records.map((record) => record.kind)).size).toBeGreaterThanOrEqual(
    Math.min(3, parameters.landscapeLandmarks) + Math.min(2, parameters.magicLandmarks)
  );
  for (const record of records) {
    const kind = landmarkKind(record.kind)!;
    expect(record.origin).toBe("generated");
    expect(record.name).not.toMatch(/^$|\d|Name-|markov:|slot:/);
    expect(record.emplacedAtEpoch).toBeLessThan(source.world.epochs.length);
    const [x0, y0, x1, y1] = spatial.bounds(record.geometry);
    expect(x0 >= w && x1 <= e && y0 >= s && y1 <= n, `${record.kind} inside the world`).toBe(true);
    const feature = published.world.features[record.id];
    expect(feature, `${record.kind} published under its record id`).toBeDefined();
    expect(feature).toMatchObject({
      kind: "landmark",
      layerId: landmarkLayer(kind),
      name: record.name,
      attributes: { landmarkKind: record.kind, origin: "generated" },
    });
    expect(["realized", "latent"]).toContain(feature.attributes.signature);
    expect(Number(feature.attributes.maintenance)).toBeGreaterThanOrEqual(0);
    if (kind.system) {
      // The injected source is a record of the world, owned by the landmark.
      const sourceRecord = published.world.magic.find((entry) => entry.landmarkId === record.id);
      expect(sourceRecord, `${record.kind} source record`).toMatchObject({
        systemId: kind.system,
      });
      expect(feature.attributes).toMatchObject({ system: kind.system });
      expect(Number(feature.attributes.sourceStrength)).toBeGreaterThan(0);
    }
    if (feature.attributes.signature !== "realized") continue;
    const capped = String(feature.attributes.notes).includes("caps the source");
    for (const [key, value] of Object.entries(feature.attributes)) {
      if (!key.endsWith("Target")) continue;
      const measured = feature.attributes[key.slice(0, -"Target".length)];
      expect(typeof measured, `${record.kind} ${key} measured ${String(measured)}`).toBe("number");
      if (!capped)
        expect(measured, `${record.kind} ${key}`).toBeGreaterThanOrEqual(Number(value) - 0.5);
    }
  }
}
