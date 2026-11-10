// Fire's geothermal cores: heat maxima under land, spaced by the field's density, and the
// spent ore of sealed conduits exhumed where erosion has exposed it.
import { meshDeltaX } from "./mesh";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { clamp } from "./math";
import type { WorldCandidate } from "./worldSources";
import type { PhysicalField } from "./field";
import { hashUnit } from "./noise";
import { MultiKeyHeap, SmallIntSet, type MagicOrigin } from "@atlas/domain";
import { exposure, siteStrength } from "./magicStocks";
import { stockGroundHosts } from "../rock/rockMagicStock";
import type { LocateContext, SupplyContext } from "./magicSources";
import { GroundInventory } from "../rock/groundInventory";
import { alterGround } from "../rock/groundAlteration";
import { magicMaterial } from "../rock/rockMagic";
import { rockCatalogue } from "../rock/rockCatalogue";
import { units } from "./math";

function isHeatMaximum(map: PhysicalField, start: number, radius: number) {
  const { mesh, HeatSourceDensity: density } = map,
    here = density.get(start);
  for (let edge = 0; edge < mesh.degree(start); edge++) {
    const j = mesh.neighbor(start, edge);
    if (j >= 0 && density.get(j) > here) return false;
  }
  const queue = [start],
    visited = new SmallIntSet();
  visited.add(start);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (density.get(i) > here) return false;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0 || !visited.add(j)) continue;
      if (
        Math.hypot(meshDeltaX(mesh, mesh.x(j) - mesh.x(start)), mesh.y(j) - mesh.y(start)) <= radius
      )
        queue.push(j);
    }
  }
  return true;
}

export function geothermalSources(
  state: GenerationState,
  field: MagicField,
  seed: number,
  context?: LocateContext
) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  if (context) exhumedSpent(map, field, context.origin);
  if (context && context.activity <= 0) return;
  const candidates = geothermalCandidates(state, field, seed);
  const selected: (WorldCandidate & { i: number })[] = [];
  for (const source of candidates) {
    const i = source.i;
    const spacing =
      p.sourceSpacing + ((1000 - map.HeatSourceDensity.get(i)) * map.scale.length(0.0025)) / 150;
    if (
      selected.some(
        (j) => Math.hypot(meshDeltaX(map.mesh, source.x - j.x), source.y - j.y) < spacing
      )
    )
      continue;
    selected.push(source);
  }
  for (const source of selected) {
    const i = source.i,
      strength = clamp(
        (720 + Math.trunc(map.HeatSourceDensity.get(i) / 3)) * (context?.activity ?? 1),
        1,
        1000
      );
    field.source.set(i, strength);
    field.located.push({
      origin: "",
      id: `geothermal:${seed}:${source.id}`,
      x: source.x,
      y: source.y,
      radius: p.sourceSpacing,
      strength,
    });
  }
}
/**
 * Old mountains are Fire country: the spent ore of sealed conduits, carried with the crust
 * and buried, feeds the source again at reduced strength where erosion has exposed it. Ore
 * washed thin into the valleys below stays ore and is no source.
 */
function exhumedSpent(map: PhysicalField, field: MagicField, origin: MagicOrigin) {
  const spent = field.stocks[`${origin.id}/spent`],
    p = field.definition.parameters;
  if (!spent) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const ore = spent.get(i);
    if (ore <= 0 || map.WaterKindCodes.get(i) === 1) continue;
    const strength = siteStrength(
      ((spent instanceof GroundInventory
        ? spent.reached(i, units(p.buryDepth))
        : exposure(map, i, p.buryDepth, stockGroundHosts(field.definition.id, "spent")) * ore) *
        p.exhumedRelease) /
        map.mesh.area(i)
    );
    if (strength > 0) field.source.set(i, Math.max(field.source.get(i), strength));
  }
}
function* geothermalCandidates(state: GenerationState, field: MagicField, seed: number) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  const radius = p.sourceSpacing / 2;
  const maximum = map.coverage.reduce(
    map.HeatSourceDensity,
    (peak, value) => Math.max(peak, value),
    0
  );
  // Hottest first, then the higher seeded priority, then the lower cell.
  const candidates = new MultiKeyHeap(["desc", "desc"]);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const density = map.HeatSourceDensity.get(i);
    if (density < p.sourceThreshold) continue;
    // Fire rises through fractures in the crust under land; the sea floor belongs to
    // Pressure, and its heat shows as vents through the geothermal field, not as cores.
    if (map.WaterKindCodes.get(i) === 1) continue;
    // A conduit that sealed after carrying its budget no longer feeds a core, unless new
    // strain across it has cracked the seal: then it reopens with part of its budget left.
    if (field.sealed.get(i) > 0) continue;
    if (density !== maximum && !isHeatMaximum(map, i, radius)) continue;
    const x = map.mesh.x(i),
      y = map.mesh.y(i);
    const priority = hashUnit(seed, Math.floor(x / radius), Math.floor(y / radius));
    candidates.push(i, density, priority);
  }
  for (let i = candidates.pop(); i >= 0; i = candidates.pop()) {
    const priority = candidates.key(1);
    yield {
      i,
      id: Math.round(priority * 2147483647),
      x: map.mesh.x(i),
      y: map.mesh.y(i),
      priority,
    };
  }
}
export function reopenConduits(
  state: GenerationState,
  field: MagicField,
  seed: number,
  context: SupplyContext
) {
  const { activity, origin } = context;
  if (activity <= 0) return;
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    if (field.sealed.get(i) <= 0 || map.TectonicStrain.get(i) < p.reopenStrain) continue;
    field.sealed.set(i, 0);
    field.history.set(i, Math.min(field.history.get(i), p.conduitBudget * (1 - p.reopenShare)));
  }
  // New conduit supply mineralizes a finite interval before adding charge to that body.
  field.source.fill(0);
  field.located = [];
  geothermalSources(state, field, seed, context);
  const held = field.stocks[`${origin.id}/held`];
  if (!(held instanceof GroundInventory)) return;
  for (const source of field.located) {
    const cell = map.mesh.cellAt(source.x, source.y);
    if (cell < 0) continue;
    const depth = units((map.scale.length(0.00015) * source.strength) / 1000);
    alterGround(map, cell, {
      depth,
      from: "rock",
      transform: (layer) => magicMaterial(layer, rockCatalogue.veinrock, map.CompletedEpochCount),
    });
    held.charge(
      cell,
      source.strength * map.mesh.area(cell),
      depth,
      [rockCatalogue.veinrock.code],
      "rock"
    );
  }
}
