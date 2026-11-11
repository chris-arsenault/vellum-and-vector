import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { MapScale, humanLayers, type Band } from "@atlas/domain";
import "../../../packages/generation/src/coupling/responders";
import { defaultHumanEras } from "../../../packages/generation/src/generationSettings";
import { advanceHumanLand } from "../../../packages/generation/src/human/landPass";
import {
  passesFor,
  settledPass,
  type PassFacts,
} from "../../../packages/generation/src/human/passFacts";
import { runOperation } from "../../../packages/generation/src/processOperation";
import { atlasEpoch } from "../../../packages/generation/src/world/atlasProfile";
import { ask } from "../../../packages/generation/src/coupling/answers";
import {
  physicalContext,
  type PhysicalContext,
} from "../../../packages/generation/src/world/context";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { harnessRoot } from "./harnessWorkspace";
import { drawCells, drawShade } from "./reliefSystems";
import { openResumeLand, readResumeSource } from "./resumePoint";

/**
 * People's settled eras lived on a saved land, in seconds, with nothing generated:
 * `HARNESS_RESUME=short HARNESS_AFTER=Present pnpm --dir frontend harness people`.
 * The land is a resume point (`HARNESS_RESUME_POINTS`), opened as it stood after the named
 * epoch with whatever people its epochs left on it. The eras are the app's default eras, or
 * `HARNESS_PEOPLE_YEARS=300,500` for others. `HARNESS_PEOPLE_OFF=gather` (or `feed`,
 * `harden`, comma-separated) runs the same eras with that operation removed, which is how a
 * mechanism is shown to make what it claims. Writes pictures of each layer and a summary
 * under `.artifacts/harness/people/<name>`; `HARNESS_OUT` names the run.
 */
const label = process.env.HARNESS_RESUME ?? "short",
  after = (process.env.HARNESS_AFTER ?? "Present").split("/").filter(Boolean),
  removed = new Set((process.env.HARNESS_PEOPLE_OFF ?? "").split(",").filter(Boolean)),
  out = join(
    harnessRoot,
    "people",
    process.env.HARNESS_OUT ?? (removed.size ? `no-${[...removed].join("-")}` : "all")
  );

const km2 = (map: PhysicalField, cell: number) =>
  MapScale.areaUnits(map.mesh.area(cell), "m2", "km2");
const land = (map: PhysicalField, cell: number) =>
  map.mesh.membership(cell) === 1 && map.WaterKindCodes.get(cell) === 0;
/** The facts of a settled pass with the removed operations switched off. */
function facts(years: number, mobility: number): PassFacts {
  const full = settledPass(years, mobility);
  return {
    ...full,
    mobility: removed.has("gather") ? 0 : full.mobility,
    farms: !removed.has("feed"),
    builds: !removed.has("harden"),
  };
}
function eras() {
  const years = process.env.HARNESS_PEOPLE_YEARS?.split(",").map(Number);
  return years
    ? years.map((span) => ({ years: span, mobility: 1 }))
    : defaultHumanEras().filter((era) => era.physicalEpoch === null);
}
/** One layer, white where there is none and darker the more there is, on a square-root scale. */
function draw(map: PhysicalField, name: string, band: Band) {
  const held: number[] = [];
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (land(map, cell) && band.get(cell) > 0) held.push(band.get(cell));
  held.sort((a, b) => a - b);
  const most = held[Math.floor(held.length * 0.995)] ?? 0;
  drawCells(map, out, `${name}.png`, (cell) => {
    if (!land(map, cell)) return [170, 185, 205];
    const level = most > 0 ? Math.sqrt(Math.min(1, band.get(cell) / most)) : 0,
      grey = Math.round(255 * (1 - level));
    return [grey, grey, grey];
  });
  return most;
}
/** What the land holds, in numbers a reader can check against the pictures. */
function summary(map: PhysicalField, context: PhysicalContext) {
  const people = map[humanLayers.population],
    feeds = ask(map, "support", context),
    cells: { cell: number; density: number }[] = [];
  let beyond = 0,
    placesBeyond = 0,
    total = 0,
    inhabited = 0,
    landKm2 = 0,
    farmedKm2 = 0,
    grazedKm2 = 0,
    builtKm2 = 0,
    ruinedKm2 = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!land(map, cell)) continue;
    const area = km2(map, cell);
    landKm2 += area;
    total += people.get(cell) * area;
    farmedKm2 += map.Farmland.get(cell) * area;
    grazedKm2 += map.Pasture.get(cell) * area;
    builtKm2 += map.BuiltUp.get(cell) * area;
    ruinedKm2 += map.RuinedBuiltUp.get(cell) * area;
    if (people.get(cell) > 0) inhabited++;
    if (people.get(cell) > 1.05 * feeds.get(cell)) {
      placesBeyond++;
      beyond += (people.get(cell) - feeds.get(cell)) * area;
    }
    cells.push({ cell, density: people.get(cell) });
  }
  cells.sort((a, b) => b.density - a.density);
  const share = (top: number) =>
    cells.slice(0, top).reduce((sum, { cell, density }) => sum + density * km2(map, cell), 0) /
    Math.max(1, total);
  return {
    people: Math.round(total),
    landKm2: Math.round(landKm2),
    inhabitedCells: inhabited,
    landCells: cells.length,
    meanPerKm2: total / landKm2,
    medianPerKm2: cells[Math.floor(cells.length / 2)]?.density ?? 0,
    densestPerKm2: cells[0]?.density ?? 0,
    shareInDensestCell: share(1),
    shareInDensestHundredth: share(Math.max(1, Math.ceil(cells.length / 100))),
    shareInDensestTenth: share(Math.ceil(cells.length / 10)),
    farmedShare: farmedKm2 / landKm2,
    grazedShare: grazedKm2 / landKm2,
    builtKm2,
    ruinedKm2,
    densest: cells.slice(0, 12).map(({ cell, density }) => ({
      x: Math.round(map.mesh.x(cell)),
      y: Math.round(map.mesh.y(cell)),
      perKm2: Math.round(density),
      people: Math.round(density * km2(map, cell)),
      built: map.BuiltUp.get(cell),
      farmed: map.Farmland.get(cell),
      river: map.RiverOrders.get(cell),
      metres: Math.round(MapScale.metres(map.Elevation.get(cell), "native")),
      // What its own land feeds as it is used, per square kilometre.
      landFeeds: Math.round(feeds.get(cell)),
    })),
    // People living beyond what their own cell's land feeds: those fed from elsewhere.
    fedFromElsewhere: Math.round(beyond),
    cellsFedFromElsewhere: placesBeyond,
  };
}

it("lives the settled eras on a saved land", () => {
  mkdirSync(out, { recursive: true });
  const started = performance.now(),
    { map, profile } = openResumeLand(label, after),
    settings = readResumeSource(label).draft.recipe.settings,
    last = settings.epochs.length - 1,
    context = physicalContext(
      readResumeSource(label).draft.recipe.seed,
      0,
      profile,
      atlasEpoch(settings.epochs[last], map.scale),
      last,
      settings.epochs.length
    ),
    report: Record<string, unknown> = {
      land: { label, after },
      removed: [...removed],
      before: summary(map, context),
    };
  for (const [index, era] of eras().entries()) {
    const passes = passesFor(era.years);
    for (let pass = 0; pass < passes; pass++)
      runOperation(map, advanceHumanLand, {
        map,
        context,
        facts: facts(era.years / passes, era.mobility),
      });
    report[`era-${index + 1}`] = summary(map, context);
  }
  report.seconds = (performance.now() - started) / 1000;
  report.scaleTop = {
    population: draw(map, "population", map[humanLayers.population]),
    farmland: draw(map, "farmland", map.Farmland),
    pasture: draw(map, "pasture", map.Pasture),
    built: draw(map, "built", map.BuiltUp),
    ruins: draw(map, "ruins", map.RuinedBuiltUp),
    ways: draw(map, "ways", map.WalkedRoute),
  };
  drawShade(map, out, "shade.png");
  writeFileSync(join(out, "summary.json"), JSON.stringify(report, null, 1));
  process.stdout.write(`\npeople: ${out}\n`);
}, 600_000);
