/* eslint-disable max-lines -- one entry per owner direction; the list grows with each direction. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realScaleDirections, type OwnerDirection } from "./ownerDirections.realScale";

/**
 * Whose direction the code carries (AGENTS.md, "Whose direction the code carries").
 *
 * Agents design most of this application and may redesign what they designed. The owner's own
 * directions and corrections stand until the owner changes them. Each is marked in the code it
 * governs with `owner-direction(<date>): <direction>` and listed here. This check fails when a
 * listed mark is gone, so a direction cannot be removed without someone seeing this file.
 *
 * Do not edit an entry, its mark or its test on your own judgement: ask the owner. When the
 * owner gives a direction, add its mark, its entry and, where a test can state it, its test.
 */
const directions: readonly OwnerDirection[] = [
  {
    direction: "raise an existing building on placement",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/town/fabric/projects.rs"],
    test: "crates/atlas-generation/src/town/fabric/projects.rs",
  },
  {
    direction: "Eases reduces a placement requirement for a class of later placements",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/town/siting.rs"],
    test: "crates/atlas-generation/src/town/siting.rs",
  },
  {
    direction:
      "great works are meta types only, with significant variation per type and no set proper name",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/town/catalogue/works.rs"],
    test: "crates/atlas-host/tests/major_works.rs",
  },
  {
    direction:
      "settlement types own their policies and recurring processes do not switch on settlement type",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/town/templates.rs"],
    test: "crates/atlas-host/tests/town_kernels.rs",
  },
  {
    direction:
      "major works are independent of the settlement template, can be preselected for larger cities and can arise organically",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/town/major_works.rs"],
    test: "crates/atlas-generation/src/town/major_works.rs",
  },
  {
    direction:
      "rank settlement templates from initial conditions and choose randomly with greater weight toward the top",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/town/templates.rs"],
    test: "crates/atlas-generation/src/town/templates.rs",
  },
  {
    direction: "the final geologic era happens in the middle of human history",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/atlas/sequence.rs"],
    test: "crates/atlas-generation/tests/sequence.rs",
  },
  {
    direction:
      "use exaggerated realism for population bands, with 300-500k capitals and exceptional cities around 2 million",
    given: "2026-11-19",
    marks: ["crates/atlas-generation/src/field/people/yields.rs"],
    test: "crates/atlas-generation/src/field/people/feed.rs",
  },
  {
    direction:
      "grow towns from an inhabited kernel across roughly 18 recurring iterations of comparable magnitude",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/atlas/town.rs"],
    test: "crates/atlas-generation/src/atlas/town.rs",
  },
  {
    direction: "town development runs independently of regional development rounds",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/atlas/town.rs"],
    test: "crates/atlas-generation/src/atlas/town.rs",
  },
  {
    direction: "support these kinds of effects in a generic extensible manner",
    given: "2026-11-17",
    marks: ["crates/atlas-generation/src/atlas/town/providers.rs"],
    test: "crates/atlas-generation/src/atlas/town/providers.rs",
  },
  {
    direction: "numerical lattice population density, terrain and magic all influence layout",
    given: "2026-11-17",
    marks: ["crates/atlas-generation/src/atlas/town/development.rs"],
  },
  {
    direction:
      "human-layer density is an approximate census, not a placement obligation; artistic composition takes priority over numerical accuracy",
    given: "2026-11-17",
    marks: ["crates/atlas-generation/src/processes/town/construction.rs"],
  },
  {
    direction: "projects adapt shared existing fabric; they must not stamp finished neighbourhoods",
    given: "2026-11-17",
    marks: ["crates/atlas-generation/src/town/fabric.rs"],
    test: "crates/atlas-host/tests/town_development.rs",
  },
  {
    direction: "temporary selections are independent of saved regions",
    given: "2026-11-17",
    marks: ["crates/atlas-map/src/regions/mod.rs"],
    test: "crates/atlas-host/tests/regions.rs",
  },
  {
    direction: "selection types are tools in a toolbar; select first, then act",
    given: "2026-11-17",
    marks: ["frontend/src/PublishedSelectionToolbar.tsx"],
    test: "frontend/tests/regionSelection.test.ts",
  },
  {
    direction: "right-click a selection to refine it",
    given: "2026-11-17",
    marks: ["frontend/src/MapSelectionMenu.tsx"],
    test: "frontend/tests/regionalGeneration.test.ts",
  },
  {
    direction: "a selection is temporary geography to act on, not a permanent map scope",
    given: "2026-11-17",
    marks: ["frontend/src/usePublishedRegions.ts"],
    test: "frontend/tests/regionSelection.test.ts",
  },
  {
    direction: "clearly list all regions of the current map",
    given: "2026-11-17",
    marks: ["frontend/src/PublishedRegionsPanel.tsx"],
    test: "frontend/tests/regionSelection.test.ts",
  },
  {
    direction: "regenerate map opens a modal over the current map",
    given: "2026-11-17",
    marks: ["frontend/src/App.tsx"],
    test: "frontend/tests/regionalGeneration.test.ts",
  },
  {
    direction: "the deployed version must look like the approved surface screenshots",
    given: "2026-11-17",
    marks: ["crates/atlas-generation/src/publication/sampling/paint.rs"],
    test: "crates/atlas-host/tests/map_sampling.rs",
  },
  {
    direction: "GIS and numerical data must stay in sync including deletion",
    given: "2026-11-15",
    marks: [
      "crates/atlas-host/src/native_jobs/contexts.rs",
      "crates/atlas-host/src/browser_workspace/contexts.rs",
    ],
    test: [
      "crates/atlas-host/tests/postgres_maps.rs",
      "crates/atlas-host/tests/context_retention.rs",
    ],
  },
  {
    direction: "list worlds, regions, generations, including orphans; weave it into the UI",
    given: "2026-11-15",
    marks: ["frontend/src/FinishedMapLibrary.tsx"],
    test: "frontend/tests/selectionStorage.test.ts",
  },
  {
    direction: "limited checkpoints only; do not chase arbitrary resume points",
    given: "2026-11-15",
    marks: ["crates/atlas-generation/src/atlas/dispatch/run/checkpoint.rs"],
    test: "crates/atlas-generation/src/atlas/dispatch/run/checkpoint.rs",
  },
  {
    direction: "only one checkpoint per job - overwrite data, not new",
    given: "2026-11-15",
    marks: ["crates/atlas-host/src/job_files.rs"],
    test: "crates/atlas-host/src/job_files.rs",
  },
  {
    direction: "old data either works in the current format or does not load; no migrations",
    given: "2026-11-15",
    marks: ["crates/atlas-gis/src/stored.rs"],
    test: "crates/atlas-gis/src/stored.rs",
  },
  {
    direction:
      "when refining a region, create the child map first, drop the user into it, then offer the refinement controls",
    given: "2026-11-16",
    marks: ["frontend/src/App.tsx"],
    test: "frontend/tests/regionalGeneration.test.ts",
  },
  {
    direction: "regional refinement is a modal with only changeable selections",
    given: "2026-11-15",
    marks: ["frontend/src/RegionalGeneration.tsx"],
    test: "frontend/tests/regionalGeneration.test.ts",
  },
  {
    direction: "if it is on the server, it is a world; no Save action is required",
    given: "2026-11-15",
    marks: ["crates/atlas-gis/src/postgres_maps/library.rs"],
    test: "crates/atlas-host/tests/postgres_maps.rs",
  },
  {
    direction: "server maps and their view preferences do not require a Save action",
    given: "2026-11-15",
    marks: ["frontend/src/FinishedSave.tsx"],
    test: "frontend/tests/selectionStorage.test.ts",
  },
  {
    direction: "high-level generation logs include start, stop and duration",
    given: "2026-11-15",
    marks: ["crates/atlas-host/src/native_jobs/run.rs"],
  },
  {
    direction: "create our own secrets and use them through the Ahara platform",
    given: "2026-11-15",
    marks: ["infrastructure/terraform/database.tf"],
  },
  {
    direction: "create a custom Docker image and place it in Compose for now",
    given: "2026-11-15",
    marks: ["compose.yaml"],
  },
  {
    direction:
      "viewer and generator are independent clients of GIS storage through data boundaries, not language boundaries",
    given: "2026-11-14",
    marks: ["crates/atlas-gis/src/lib.rs"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction:
      "world and region use common representation rules, selected by geography rather than map type",
    given: "2026-11-14",
    marks: ["crates/atlas-generation/src/atlas/initial.rs"],
    test: "crates/atlas-host/tests/map_sampling.rs",
  },
  {
    direction: "generation must be Rust only",
    given: "2026-11-14",
    marks: ["crates/atlas-host/src/browser_control.rs"],
    test: "crates/atlas-host/tests/browser_publication.rs",
  },
  {
    direction: "preserve explicit saves; working regions and views stay local until saved",
    given: "2026-11-13",
    marks: ["crates/atlas-gis/src/map_store/library.rs"],
    test: [
      "archive/typescript/remaining-runtime/packages/storage-browser/src/mapPublication.test.ts",
      "archive/typescript/remaining-runtime/packages/storage-browser/src/mapNavigation.test.ts",
      "crates/atlas-host/tests/postgres_maps.rs",
      "frontend/tests/selectionStorage.test.ts",
    ],
  },
  {
    direction: "presentation reads only GIS map storage, never numerical generation storage",
    given: "2026-11-14",
    marks: ["frontend/src/FinishedMapEditor.tsx"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "map production belongs in Rust; TypeScript is UI, view code and facade",
    given: "2026-11-14",
    marks: ["crates/atlas-host/src/generation_bindings.rs"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "backend has LAN-only access and no public route",
    given: "2026-11-13",
    marks: ["crates/atlas-host/src/bin/atlas_server.rs"],
    test: "archive/typescript/packages/server/src/mapHttp.integration.test.ts",
  },
  {
    direction: "presentation reads only GIS storage, never numerical generation storage",
    given: "2026-11-14",
    marks: ["crates/atlas-gis/src/map_store/mod.rs"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "naming belongs in Rust; TypeScript is UI, view code and facade",
    given: "2026-11-14",
    marks: ["crates/atlas-generation/src/naming/mod.rs"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "archived TypeScript generation is unused by active code",
    given: "2026-11-14",
    marks: ["pnpm-workspace.yaml"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "TypeScript generation tests stay outside normal CI",
    given: "2026-11-14",
    marks: ["vitest.config.ts"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "computation uses one Rust core for native and WASM",
    given: "2026-11-12",
    marks: ["crates/atlas-host/src/browser_job.rs", "crates/atlas-host/src/native_jobs/run.rs"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "child elevation and coastline may change freely, including at their edges",
    given: "2026-10-29",
    marks: ["crates/atlas-generation/src/field/refinement/adaptive_relief.rs"],
  },
  {
    direction: "delete both old C# and TypeScript backends",
    given: "2026-11-12",
    marks: ["packages/atlas-context/src/separation.architecture.ts"],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "later parent changes leave children's captured inputs unchanged",
    given: "2026-10-29",
    marks: [
      "archive/typescript/packages/application/src/captureSelectedMap.ts",
      "crates/atlas-host/src/regional_capture.rs",
    ],
    test: "archive/typescript/frontend/src/generationInputs.test.ts",
  },
  {
    direction: "software architecture paradigms should not change during the Rust port",
    given: "2026-11-12",
    marks: ["crates/atlas-generation/src/execution.rs"],
    test: "crates/atlas-generation/tests/execution.rs",
  },
  {
    direction: "map and generation use separate schemas",
    given: "2026-11-12",
    marks: [
      "crates/atlas-map/src/lib.rs",
      "packages/map/src/index.ts",
      "crates/atlas-gis/src/map_store/schema.sql",
      "archive/typescript/packages/storage-postgres/src/map.sql",
      "crates/atlas-gis/src/postgres_maps/schema.sql",
    ],
    test: "packages/atlas-context/src/separation.architecture.ts",
  },
  {
    direction: "only pure browser or pure backend is supported",
    given: "2026-11-12",
    marks: ["packages/atlas-context/src/context.ts"],
    test: "packages/atlas-context/src/context.test.ts",
  },
  {
    direction:
      "water gets the same intentional paradigms and columnar state as geology and society",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/water/water.architecture.ts",
      "crates/atlas-generation/src/water/owner.rs",
    ],
    test: "packages/atlas-context/src/rustFoundations.architecture.ts",
  },
  {
    direction: "add the river-mouth sediment deposition process back",
    given: "2026-11-13",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/world/fluvial.ts",
      "crates/atlas-generation/src/processes/fluvial.rs",
    ],
    test: [
      "archive/typescript/packages/generation/src/world/riverMouthDeposition.test.ts",
      "crates/atlas-generation/src/field/sediment_tests.rs",
    ],
  },
  {
    direction:
      "rivers are kept things that processes change; cells hold quantities and are never rivers",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/water/reachEvolution.ts",
      "crates/atlas-generation/src/water/evolution.rs",
    ],
    test: "crates/atlas-generation/src/water/network_tests.rs",
  },
  {
    direction: "water gets an actual column of water, carried and inherited as one package",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/water/column.ts",
      "crates/atlas-generation/src/water/column.rs",
    ],
    test: "crates/atlas-generation/src/water/column_tests.rs",
  },
  {
    direction: "a cell's own yield, however large, never makes it a river",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/water/riverSize.ts",
      "crates/atlas-generation/src/water/network.rs",
    ],
    test: "crates/atlas-generation/tests/river_significance.rs",
  },
  {
    direction:
      "the stream a parent's river-side town stands on continues on a finer map whatever its water there",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/regional/seats.ts",
      "crates/atlas-generation/src/field/refinement/seats.rs",
    ],
    test: "archive/typescript/packages/generation/src/regional/seats.test.ts",
  },
  {
    direction:
      "numerical accuracy and reproducibility are not goals of this repository, and guarding them is forbidden",
    given: "2026-11-13",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/world/validation.ts",
      "crates/atlas-generation/src/atlas/validation.rs",
    ],
    test: "archive/typescript/packages/generation/src/world/riverValidation.test.ts",
  },
  {
    direction:
      "a region starts at the parent's level and gets more defined; the parent's elevation is not thrown away",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/regional/startingGround.ts",
      "crates/atlas-generation/src/field/refinement/columns.rs",
    ],
    test: "archive/typescript/packages/generation/src/rock/groundShares.test.ts",
  },
  {
    direction:
      "what is inside a parent cell comes from the rock column, shaped by all the relevant processes",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/rock/contactRealization.ts",
      "crates/atlas-generation/src/rock/ground/contacts.rs",
    ],
    test: "archive/typescript/packages/generation/src/rock/contactRealization.test.ts",
  },
  {
    direction: "plate movement and tectonic strength cannot be coupled",
    given: "2026-11-07, restated 2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/world/tectonicControls.ts",
      "crates/atlas-generation/src/tectonics/controls.rs",
    ],
    test: [
      "archive/typescript/packages/generation/src/world/tectonicMotion.test.ts",
      "crates/atlas-generation/tests/tectonics.rs",
    ],
  },
  {
    direction: "plate travel needs to be much bigger; a few cells of travel is not enough",
    given: "2026-11-07",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/terrainCartography.ts",
      "crates/atlas-generation/src/atlas/configuration/cartography.rs",
    ],
    test: "crates/atlas-host/src/generation_application.rs",
  },
  {
    direction: "plate travel is a share of the world's size, not a fixed distance",
    given: "2026-11-07",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/world/profile.ts",
      "crates/atlas-generation/src/tectonics/province_settings.rs",
    ],
    test: "crates/atlas-generation/tests/tectonics.rs",
  },
  {
    direction:
      "the default is a good mix of very mountainous parts and large stretches of relatively flat land",
    given: "2026-11-09, restated 2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/terrainCartography.ts",
      "crates/atlas-generation/src/atlas/configuration/cartography.rs",
    ],
    test: "crates/atlas-host/src/generation_application.rs",
  },
  {
    // Magic and terrain settings are entered as shares of the map; cell size is not.
    direction: "geology is shares of the map; digital representation precision is fixed",
    given: "2026-11-12",
    marks: [
      "archive/typescript/packages/domain/src/mapScale.ts",
      "crates/atlas-generation/src/scale.rs",
    ],
  },
  {
    direction:
      "a standard region has roughly the cells of the default standard world, at 7-ish land regions in a world",
    given: "2026-11-12",
    marks: [
      "archive/typescript/packages/domain/src/regionalScale.ts",
      "crates/atlas-generation/src/atlas/resolution.rs",
    ],
    test: "crates/atlas-generation/tests/scale_settings.rs",
  },
  {
    // Covers world detail levels and the regional ladder (confirmed 2026-11-12).
    direction: "the resolutions are fixed; a detail level is not a cell count",
    given: "2026-11-12",
    marks: [
      "archive/typescript/retired-adapters/packages/generation/src/resolution.ts",
      "archive/typescript/packages/domain/src/regionalScale.ts",
      "crates/atlas-generation/src/atlas/resolution.rs",
    ],
    test: [
      "archive/typescript/packages/generation/src/resolution.test.ts",
      "crates/atlas-generation/tests/scale_settings.rs",
    ],
  },
  ...realScaleDirections,
  {
    direction: "the town square is an open area surrounded by businesses",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/town/catalogue/trade.rs"],
    test: "crates/atlas-host/tests/town_development.rs",
  },
  {
    direction: "town housing includes multi-storey, connected houses",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/town/roofs.rs"],
    test: "crates/atlas-host/tests/town_development.rs",
  },
  {
    direction: "special rules for a POI belong in the POI",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/town/catalogue.rs"],
    test: [
      "crates/atlas-generation/src/town/catalogue.rs",
      "packages/atlas-context/src/rustFoundations.architecture.ts",
      "packages/atlas-context/src/separation.architecture.ts",
    ],
  },
  {
    direction: "we do want nearly everything to have a street address",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/town/addresses.rs"],
    test: "crates/atlas-host/tests/town_development.rs",
  },
  {
    direction: "individual buildings can grow on land without a street",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/town/plots.rs"],
    test: "crates/atlas-host/tests/town_development.rs",
  },
  {
    direction: "a cramped mountain town with small byways is a realistic goal",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/town/byway.rs"],
    test: "crates/atlas-generation/src/town/byway.rs",
  },
  {
    direction:
      "a project's steps stand as they are built; one that cannot be built stops the project, leaving what was finished",
    given: "2026-11-20",
    marks: ["crates/atlas-generation/src/town/fabric/projects.rs"],
    test: "crates/atlas-generation/src/town/fabric/projects.rs",
  },
  {
    direction: "major crossings of the main road lead out into the countryside",
    given: "2026-11-18",
    marks: ["crates/atlas-generation/src/processes/town/crossroads.rs"],
    test: "crates/atlas-generation/src/processes/town/crossroads.rs",
  },
  {
    direction: "colour house roofs by residential, civic and economic function",
    given: "2026-11-18",
    marks: ["frontend/src/realScaleStyles.ts"],
    test: "frontend/src/realScale.test.ts",
  },
  {
    direction:
      "the agreement clause is that major landmarks in a parent map must appear and roughly agree with a child map; that is it",
    given: "2026-11-16",
    marks: ["crates/atlas-generation/src/field/refinement/people.rs"],
  },
  {
    direction:
      "refinement does not run processes that change population, as it does not run plate advection",
    given: "2026-11-21",
    marks: ["crates/atlas-generation/src/field/refinement/people.rs"],
  },
  {
    direction: "on a topo map, ice fields must not block everything else out",
    given: "2026-11-16",
    marks: ["frontend/src/rasterStyles.ts"],
  },
  {
    direction:
      "a map has no outside; cells beyond the bounds are not normally addressable and exist only as boundary support for numerical calculation",
    given: "2026-11-16",
    marks: ["crates/atlas-generation/src/lattice/triangular.rs"],
    test: "crates/atlas-generation/tests/lattice.rs",
  },
];

const root = join(__dirname, "../../..");
const mark = ({ given, direction }: OwnerDirection) => `owner-direction(${given}): ${direction}`;
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the owner's directions are still carried by the code", () => {
  for (const entry of directions)
    it(entry.direction, () => {
      expect(entry.marks.some((path) => !path.startsWith("archive/"))).toBe(true);
      for (const path of entry.marks) expect(read(path), path).toContain(mark(entry));
      const tests = typeof entry.test === "string" ? [entry.test] : (entry.test ?? []);
      for (const path of tests) expect(existsSync(join(root, path)), path).toBe(true);
    });
  it("lists every mark in the code", () => {
    const listed = new Set(directions.map(mark));
    const found = directions
      .flatMap((entry) => entry.marks)
      .flatMap((path) => [...read(path).matchAll(/owner-direction\([^)]*\): [^\n*]+/g)])
      .map((match) => match[0].trim().replace(/\.$/, ""));
    expect(found.filter((text) => !listed.has(text))).toEqual([]);
  });
});
