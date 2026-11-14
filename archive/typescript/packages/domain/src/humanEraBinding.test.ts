import { expect, it } from "vitest";
import { beforePresentEpoch, boundEpoch } from "./society";

const epochs = [{ id: "Formation" }, { id: "Glacial maximum" }, { id: "Now" }];

it("binds an era to the epoch before the present whatever that epoch is called", () => {
  expect(boundEpoch(beforePresentEpoch, epochs)).toBe("Glacial maximum");
  expect(boundEpoch(beforePresentEpoch, [{ id: "Only" }])).toBeNull();
  expect(boundEpoch(beforePresentEpoch, [])).toBeNull();
});

it("keeps a named binding while its epoch exists and falls back to the present otherwise", () => {
  expect(boundEpoch("Formation", epochs)).toBe("Formation");
  expect(boundEpoch("Cold age", epochs)).toBeNull();
  expect(boundEpoch(null, epochs)).toBeNull();
  expect(boundEpoch(undefined, epochs)).toBeNull();
});
