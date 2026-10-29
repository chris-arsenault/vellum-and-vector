import { expect, it } from "vitest";
import { fixture, record, scope, write } from "./catalogFixture";

it("keeps one product per family, valid while its stamp matches", async () => {
  const catalog = await fixture();
  const stamp = catalog.productStamp(scope.worldId, ["feature"]);
  await catalog.writeProduct(scope.worldId, "drawn:root", stamp, { marks: [1, 2] });
  expect(await catalog.readProduct(scope.worldId, "drawn:root", stamp)).toEqual({ marks: [1, 2] });
  await write(catalog, [record("wood")]);
  const next = catalog.productStamp(scope.worldId, ["feature"]);
  expect(next).not.toBe(stamp);
  expect(catalog.productStamp(scope.worldId, ["field"])).toBe(
    catalog.productStamp(scope.worldId, ["field"])
  );
  expect(await catalog.readProduct(scope.worldId, "drawn:root", next)).toBeNull();
  await catalog.writeProduct(scope.worldId, "drawn:root", next, { marks: [3] });
  expect(await catalog.readProduct(scope.worldId, "drawn:root", stamp)).toBeNull();
});
