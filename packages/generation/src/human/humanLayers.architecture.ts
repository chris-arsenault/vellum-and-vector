import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { humanBandNames, humanLayerIds } from "@atlas/domain";
import { source, sourceFiles } from "../architectureReach";
import { quantityKinds } from "../coupling/quantities";
import { physicalChannels } from "../world/atlasChannels";

/**
 * Structure of the people's layers on the land (docs/SOCIETY-ECONOMY-INTERACTIONS-PLAN.md).
 * These prove who may write the layers and what the new namespace may touch; they say nothing
 * about what a generated map looks like. The compiler carries the main guarantee: everyone
 * but the registered operations receives a read-only view of the owner. The source checks
 * here catch the direct routes round it; a band reached through an alias is not caught.
 */
const files = () => [...sourceFiles(source)].map((path) => relative(source, path));
const text = (path: string) => readFileSync(join(source, path), "utf8");
const bands = [...humanBandNames] as string[];
/** The owner: the band store, the changes, and how layers are lost and carried. */
const owner = ["layerBands", "humanLayers", "humanLoss", "humanCarry"].map(
    (name) => `human/${name}.ts`
  ),
  operations = "human/layerOperations.ts";
const namespace = () => files().filter((path) => path.startsWith("human/"));
/** Lines of the files that match, as `file:line`. */
function lines(paths: string[], pattern: RegExp) {
  return paths.flatMap((path) =>
    text(path)
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}`] : []))
  );
}

describe("people's layers have one writer", () => {
  const writes = new RegExp(`\\b(${bands.join("|")})\\b\\s*\\)?\\s*\\.(set|add|fill|copyFrom)\\(`);
  const namedWrites =
    /\[(humanLayers|humanRemains|identityColumn)\b[^\n]*\]\s*\.(set|add|fill|copyFrom)\(/;
  it("writes the layer bands only inside the owner", () => {
    const others = files().filter((path) => !owner.includes(path));
    expect([...lines(others, writes), ...lines(others, namedWrites)]).toEqual([]);
  });
  it("hands the owner's changes only to the registered operations", () => {
    const others = files().filter((path) => path !== operations && !owner.includes(path));
    expect(
      lines(others, /humanLayerWriter|HumanLayerWriter|\/(layerBands|humanLoss|humanCarry)"/)
    ).toEqual([]);
  });
  it("registers one opaque operation for each change the owner offers", () => {
    const offered = [
        ...text("human/humanLayers.ts")
          .split("class HumanLayers")[1]
          .matchAll(/^ {2}(?!private|constructor)(\w+)\(/gm),
      ].map((match) => match[1]),
      registered = [...text(operations).matchAll(/humanLayerWriter\(map\)\s*\.(\w+)\(/g)].map(
        (match) => match[1]
      );
    expect(offered.length).toBeGreaterThan(0);
    expect(registered.sort()).toEqual(offered.sort());
    expect(text(operations).match(/defineCommand\(/g)).toHaveLength(offered.length);
  });
});

describe("every human band is declared", () => {
  it("is carried by its owner as a package, never band by band", () => {
    expect(bands.filter((name) => quantityKinds[name] !== "carried")).toEqual([]);
  });
  it("has a unit and a publication owner, so maps and child maps receive it", () => {
    const declared = new Set<string>(physicalChannels.map(({ name }) => name));
    expect(bands.filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe("queries and the lattice", () => {
  it("keeps questions pure: a module that answers one submits no operation", () => {
    const answering = namespace().filter((path) => /\brespond\(\{/.test(text(path)));
    expect(answering.length).toBeGreaterThan(0);
    expect(lines(answering, /layerOperations|humanLayerWriter|runOperation|defineCommand/)).toEqual(
      []
    );
  });
  it("works on the land's mesh and never on the display raster", () => {
    expect(
      lines(
        namespace(),
        /\.surface\b|[{,]\s*surface\s*[,}:]|putChannel|gridPosition|gridNeighbors|RegularGrid/
      )
    ).toEqual([]);
  });
});

describe("the land and its people meet without naming each other", () => {
  const physical = () => files().filter((path) => !path.startsWith("human/"));
  it("names no human band or layer outside people's own code", () => {
    // The declarations that list bands for the schema, the units and the crust are not
    // processes, and the sequence of people's processes is wiring.
    const declarations = ["coupling/quantities.ts", "world/atlasChannels.ts", "peopleProcesses.ts"];
    // A band is named by reading it off the map or by its name as a string. What the rest of
    // the generator may import from people's code is their processes, their read view, the
    // run's memory of places, works and events, and the catalogue of the land's hazards.
    const named = new RegExp(
      `\\.(${bands.join("|")})\\b|["'\`](${bands.join("|")})["'\`]|(humanLayers|humanRemains|identityColumn)[.\\[]|human/(?!humanChannels|place|landProcesses|humanLayers"|identity(Reads|Processes)"|traditions"|(work|event)Registry"|hazardCatalogue")`
    );
    expect(
      lines(
        physical().filter(
          (path) => !declarations.includes(path) && path !== "coupling/responders.ts"
        ),
        named
      )
    ).toEqual([]);
  });
  it("writes no ground, water, ice or climate from people's code", () => {
    const theirs =
      /\b(Elevation|BedrockElevation|SedimentThickness|SurfaceRockLoad|CrustThickness|SoilDepth|SoilWater|Temperature|Moisture|Rainfall|Runoff|IceThickness|WaterDepths|WaterKindCodes|RiverOrders|FlowAccumulation|TreeCover|GrassCover)\b\s*\.(set|add|fill|copyFrom)\(/;
    expect(
      lines(
        namespace().filter((path) => !/TestFixture\.ts$/.test(path)),
        theirs
      )
    ).toEqual([]);
  });
  it("names no layer kind in the owner: every kind is handled by its catalogue facts", () => {
    const kind = new RegExp(`["'\`](${humanLayerIds.join("|")})["'\`]`);
    expect(lines([...owner, operations], kind)).toEqual([]);
  });
  // The steps of a pass are about particular layers and name them as what they submit; what
  // they may not do is decide by a layer's kind.
  it("branches on no layer kind outside the catalogue", () => {
    const branch = new RegExp(
      `(===|!==|case)\\s*["'\`](${humanLayerIds.join("|")})["'\`]|["'\`](${humanLayerIds.join("|")})["'\`]\\s*(===|!==)`
    );
    expect(
      lines(
        namespace().filter((path) => path !== "human/layerCatalogue.ts"),
        branch
      )
    ).toEqual([]);
  });
});

describe("places have one publisher", () => {
  it("makes settlement and ruin records only in the catalogue's place builders", () => {
    // A map that lived its own people reads places from the land; a refined map still builds
    // what its parent left and what it proposed until regions run the same operations (M7).
    const builders = ["poi/settlements/landPlaces.ts", "poi/settlements/communityRecords.ts"];
    const makes = /(generatedFeature|regionalFeature)\(\s*state,[^;]*?["'`]settlement["'`]/s;
    expect(
      files()
        .filter((path) => makes.test(text(path)))
        .sort()
    ).toEqual(builders.sort());
  });
  it("reads the places of a map that lived its own people from the land's layers", () => {
    expect(text("poi/settlements/landPlaces.ts")).toMatch(/knownPlaces\(state\)/);
    expect(text("human/placeRegistry.ts")).not.toMatch(/society/);
    // The classifier decides nothing: it submits no operation and keeps no record.
    expect(
      lines(
        ["human/placeClassifier.ts", "human/hinterlands.ts"],
        /runOperation|runMemory|defineCommand/
      )
    ).toEqual([]);
  });
});
