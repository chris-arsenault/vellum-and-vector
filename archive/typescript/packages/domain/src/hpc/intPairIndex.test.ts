import { expect, it } from "vitest";
import { IntPairIndex } from "./intPairIndex";

it("retains distinct signed integer pairs through growth and repeated lookup", () => {
  const pairs = new IntPairIndex();
  for (let key = 0; key < 512; key++) {
    expect(pairs.include(key, 0)).toBe(key * 2);
    expect(pairs.include(key, -1)).toBe(key * 2 + 1);
  }
  for (let key = 511; key >= 0; key--) {
    expect(pairs.include(key, 0)).toBe(key * 2);
    expect(pairs.include(key, -1)).toBe(key * 2 + 1);
    expect(pairs.first(key * 2)).toBe(key);
    expect(pairs.second(key * 2 + 1)).toBe(-1);
  }
});
it("clears identities without letting prior table slots collide with a new population", () => {
  const pairs = new IntPairIndex();
  for (let key = 0; key < 256; key++) pairs.include(key, key % 5);
  pairs.clear();
  expect(pairs.include(255, 0)).toBe(0);
  expect(pairs.include(-17, 3)).toBe(1);
  expect(pairs.include(255, 0)).toBe(0);
  expect(pairs.first(1)).toBe(-17);
  expect(pairs.length).toBe(2);
});
