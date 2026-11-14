import { expect, it } from "vitest";
import { rockCatalogue } from "../../../packages/generation/src/rock/rockCatalogue";
import { clearLiveMagic, liveMagicForcing } from "./extinctMagic";

it("clears live magical forcing without touching retained material or physical consequences", () => {
  const fields = Object.fromEntries(
    liveMagicForcing.map((name) => [name, new Float64Array([1, 2])])
  ) as Record<(typeof liveMagicForcing)[number], Float64Array>;
  const retained = {
    ...fields,
    IceThickness: new Float64Array([12, 34]),
    RockKindCodes: new Uint8Array([rockCatalogue.keptStone.code, rockCatalogue.crushstone.code]),
    ExternalCoastalForcingHistory: new Float64Array([20, 80]),
  };
  clearLiveMagic(retained);
  for (const name of liveMagicForcing) expect([...retained[name]]).toEqual([0, 0]);
  expect([...retained.IceThickness]).toEqual([12, 34]);
  expect([...retained.RockKindCodes]).toEqual([
    rockCatalogue.keptStone.code,
    rockCatalogue.crushstone.code,
  ]);
  expect([...retained.ExternalCoastalForcingHistory]).toEqual([20, 80]);
});
