import { expect, it } from "vitest";
import type { MapDescriptor } from "@atlas/map";
import { startingPresentation, viewedChrome } from "./carriedPresentation";

function map(revision: string, street: boolean) {
  const layers = ["roads", "plots", "structures", "landUse"].map((kind) => ({
    id: `vector:${kind}`,
    catalog: {
      defaultStyle: {
        visible: false,
        labels: false,
        opacity: 1,
        minScale: 0,
        color: "#555",
        types: {},
        groups: {},
        symbols: null,
        filter: null,
      },
      featureTypes: kind === "landUse" ? [{ kind: "urbanGround", count: 4 }] : [],
    },
  }));
  return {
    reference: { revision },
    layers,
    realScale: street ? { kind: "ground" } : null,
  } as unknown as MapDescriptor;
}

it("opens City streets, roofs and precincts at Street scale and carries an explicitly hidden layer", () => {
  const city = map("city", false),
    street = map("district", true);
  const viewed = viewedChrome();
  let presentation = startingPresentation(city, undefined, null);
  expect(presentation.styles.filter((s) => s.visible).map((s) => s.layerId)).toEqual(
    expect.arrayContaining(["vector:roads", "vector:landUse", "vector:plots"])
  );
  const write = () => viewed.write(city, { presentation, panel: "layers", tool: "pan" });
  write();
  for (const visible of [true, false]) {
    presentation = {
      ...presentation,
      styles: presentation.styles.map((style) =>
        style.layerId === "vector:plots" ? { ...style, visible } : style
      ),
    };
    write();
  }
  const district = startingPresentation(street, undefined, viewed.read());
  const visible = district.styles.filter((style) => style.visible).map((style) => style.layerId);
  expect(visible).toEqual(
    expect.arrayContaining(["vector:roads", "vector:structures", "vector:landUse"])
  );
  expect(visible).not.toContain("vector:plots");
  expect(district.styles.find((style) => style.layerId === "vector:roads")?.labels).toBe(true);
});

it("opens the City catalogue when navigating from a Region and keeps an explicit choice", () => {
  const city = map("city", false);
  const region = {
    ...map("region", false),
    layers: city.layers.filter((layer) => layer.id !== "vector:landUse"),
  };
  const viewed = viewedChrome();
  let presentation = startingPresentation(region, undefined, null);
  const write = () => viewed.write(region, { presentation, panel: "layers", tool: "pan" });
  write();
  expect(presentation.styles.some((s) => s.visible)).toBe(false);
  for (const visible of [true, false]) {
    presentation = {
      ...presentation,
      styles: presentation.styles.map((s) =>
        s.layerId === "vector:plots" ? { ...s, visible } : s
      ),
    };
    write();
  }
  const arrived = startingPresentation(city, undefined, viewed.read());
  expect(arrived.styles.filter((s) => s.visible).map((s) => s.layerId)).toEqual([
    "vector:structures",
    "vector:roads",
    "vector:landUse",
  ]);
});
