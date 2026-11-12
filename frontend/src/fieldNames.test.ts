import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { fieldClasses, fieldName, shownUnit } from "./fieldNames";
import { commonOverlay, overlayBranch, overlayTheme } from "./overlayFields";
import { fieldLabel } from "./rasterPresentation";
import type { World } from "./types";

const world = {
  magicSystems: [{ id: "fire", name: "Fire" }],
  entities: {
    a: { id: "a", name: "Old Kessan", attributes: { traditionCode: 3, traditionKind: "tongue" } },
    b: {
      id: "b",
      name: "The March",
      attributes: { traditionCode: 4, traditionKind: "allegiance" },
    },
    c: { id: "c", name: "A river", attributes: {} },
  },
} as unknown as World;

it("files people's layers and the rock column under plain names", () => {
  expect(fieldLabel(world, "Population")).toBe("People");
  expect(overlayTheme("Population")).toBe("People");
  expect(commonOverlay("Farmland")).toBe(true);
  expect(fieldLabel(world, "IdentityAllegiance0")).toBe("Realm · latest layer");
  expect(overlayBranch(world, "IdentityTongue2")).toBe("Who the people are");
  expect(commonOverlay("IdentityTongue2")).toBe(false);
  expect(fieldLabel(world, "RockLayerKind0")).toBe("Rock · layer 1 (top) · kind");
  expect(overlayTheme("LooseLayerDepth3")).toBe("Rock and ground");
  expect(commonOverlay("RockCutLayerKind0")).toBe(false);
  expect(fieldName("Temperature")).toBeUndefined();
  expect(overlayTheme("Temperature")).toBe("Climate");
});

it("names the classes a coded layer holds", () => {
  expect(fieldClasses(world, "IdentityTongue0")!.map(({ code, name }) => [code, name])).toEqual([
    [0, "None"],
    [3, "Old Kessan"],
  ]);
  expect(fieldClasses(world, "IdentityAllegiance1")!.map(({ name }) => name)).toEqual([
    "None",
    "The March",
  ]);
  expect(fieldClasses(world, "IdentityCraft0")![1].name).toBe("Fire · hearth-keeping");
  expect(fieldClasses(world, "RockLayerKind4")!.length).toBeGreaterThan(5);
  expect(fieldClasses(world, "RockLayerDepth0")).toBeNull();
});

it("shows stored units as a reader's units", () => {
  const length = shownUnit("native-length");
  expect(length.unit).toBe("m");
  expect(MapScale.native(250) * length.factor).toBe(250);
  expect(shownUnit("per-mille")).toEqual({ unit: "%", factor: 0.1 });
  expect(shownUnit("category").unit).toBe("Classes");
  expect(shownUnit("native-temperature")).toEqual({ unit: "native-temperature", factor: 1 });
});
