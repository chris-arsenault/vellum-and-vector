import { expect, it, vi } from "vitest";
import { rectangle } from "@atlas/domain";
import { GeometryKernel } from "./geometryKernel";
import { encodeRecordGeometry } from "./catalogRecords";
import { fixture, scope, world, record, write } from "./catalogFixture";

// Finding 8: a generated record's geometry is encoded once, by its producer.
it("stores a producer-encoded record without encoding its geometry again", async () => {
  let db: import("@sqlite.org/sqlite-wasm").Database | undefined;
  const catalog = await fixture((opened) => (db = opened)),
    producer = await GeometryKernel.create(64),
    encode = vi.spyOn(GeometryKernel.prototype, "encode");
  try {
    const shape = rectangle([20, 20, 300, 200]),
      generated = record("generated", shape),
      edited = record("edited", shape);
    generated.encoded = encodeRecordGeometry(generated, producer, world.reference.precision!);
    const byProducer = encode.mock.calls.length;
    expect(byProducer).toBe(1);
    await write(catalog, [generated]);
    // The catalog stored the producer's bytes: no second encoding of the generated record.
    expect(encode.mock.calls.length).toBe(byProducer);
    await write(catalog, [edited]);
    expect(encode.mock.calls.length).toBe(byProducer + 1);
    const stored = (id: string) =>
      db!.selectValue(
        "SELECT g.data FROM records_core r JOIN geometry_values g ON g.geometry_id=r.geometry_id WHERE r.id=?",
        [id]
      ) as Uint8Array;
    expect(Array.from(stored("generated"))).toEqual(Array.from(stored("edited")));
    expect((await catalog.readFeature(scope, "generated")).geometry).toEqual(
      (await catalog.readFeature(scope, "edited")).geometry
    );
  } finally {
    encode.mockRestore();
    producer.close();
  }
});
it("keeps a staged producer encoding as bytes through an atomic publication", async () => {
  const catalog = await fixture(),
    producer = await GeometryKernel.create(64),
    encode = vi.spyOn(GeometryKernel.prototype, "encode");
  try {
    const generated = record("staged", rectangle([30, 30, 90, 90]));
    generated.encoded = encodeRecordGeometry(generated, producer, world.reference.precision!);
    const byProducer = encode.mock.calls.length,
      operationId = crypto.randomUUID(),
      token = await catalog.beginPublication({
        worldId: scope.worldId,
        operationId,
        expectedWorldRevision: (await catalog.readEditor(scope.worldId)).version,
        history: { kind: "generate", actor: "generator" },
      });
    await catalog.appendPublication(token, {
      operationId,
      worldId: scope.worldId,
      expected: [generated.reference],
      writes: [generated],
      removes: [],
      resources: [],
    });
    await catalog.finishPublication(token);
    expect(encode.mock.calls.length).toBe(byProducer);
    expect((await catalog.readFeature(scope, "staged")).geometry.type).toBe("Polygon");
  } finally {
    encode.mockRestore();
    producer.close();
  }
});
