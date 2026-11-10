import { MapScale } from "@atlas/domain";
import type { GenerationState } from "./process";
import { GroundInventory } from "./rock/groundInventory";
import { cargoIdentities } from "./rock/groundCargoIdentity";
import { deposit } from "./rock/groundLedger";
import { rekeyCargo, withoutCargo } from "./rock/materialCargo";
import { magicFieldForRole, type MagicRole } from "./societyMagicAccess";
import { originStocks, stockKey, withOrigin } from "./world/magicState";
import type { PhysicalField } from "./world/field";
import type { MaterialLayer } from "./rock/rockColumn";

// hpc-exempt: inventory handles per community and reservoir; material itself remains in Ground.
const inventories = new WeakMap<PhysicalField, Map<string, GroundInventory>>();
// hpc-exempt: custody handles indexed by community/system metadata, not by lattice cell.
const custody = new WeakMap<
  PhysicalField,
  { seen: number; groups: Map<string, GroundInventory[]> }
>();
function inventory(map: PhysicalField, name: string, releasedTo?: string) {
  let held = inventories.get(map);
  if (!held) inventories.set(map, (held = new Map()));
  let value = held.get(name);
  if (!value) held.set(name, (value = new GroundInventory(map, name, releasedTo)));
  return value;
}
const prefix = (community: string) => `society/${encodeURIComponent(community)}/`;
function land(map: PhysicalField, source: number, target: number, parcel: MaterialLayer) {
  const depth = (parcel.depth * map.mesh.area(source)) / map.mesh.area(target);
  deposit(map, target, depth, "human carriage", "load", { ...parcel, depth });
}
/** Worked solid stock rests in actual loose packages at the community, with origin and age intact. */
export function gatherSolid(
  state: GenerationState,
  role: MagicRole,
  reservoir: string,
  community: string,
  sample: number,
  amount: number,
  surfaceOnly = false
) {
  const field = magicFieldForRole(state, role),
    work = state.physical;
  if (!field || !work) return 0;
  const cell = work.samples.get(sample),
    map = work.map;
  let remaining = amount;
  for (const origin of field.definition.origins)
    for (const stock of originStocks(origin)) {
      if (stock.reservoir !== reservoir || remaining <= 0) continue;
      const source = field.stocks[stockKey(origin, stock)];
      if (!(source instanceof GroundInventory)) continue;
      const target = inventory(map, prefix(community) + source.name, source.name),
        parcels: MaterialLayer[] = [];
      remaining -= withOrigin(field, origin, () =>
        source.extract(
          cell,
          remaining,
          { reach: MapScale.native(field.definition.parameters.buryDepth), surfaceOnly },
          (parcel) =>
            parcels.push({ ...parcel, cargo: rekeyCargo(parcel.cargo, source.key, target.key) })
        )
      );
      for (const parcel of parcels) land(map, cell, cell, parcel);
    }
  return amount - remaining;
}
function carried(map: PhysicalField, community: string, system: string) {
  let index = custody.get(map);
  if (!index) custody.set(map, (index = { seen: 0, groups: new Map() }));
  const names = cargoIdentities(map);
  for (; index.seen < names.length; index.seen++) {
    const name = names[index.seen];
    if (!name.startsWith("society/")) continue;
    const group = name.slice(0, name.indexOf(":")),
      held = index.groups.get(group) ?? [];
    if (!held.length) index.groups.set(group, held);
    held.push(inventory(map, name));
  }
  return index.groups.get(prefix(community) + system) ?? [];
}
/** The practice ledger displays the present parcel inventory; it cannot replenish missing grains. */
export function carriedSolid(
  state: GenerationState,
  role: MagicRole,
  community: string,
  sample: number
) {
  const field = magicFieldForRole(state, role),
    work = state.physical;
  if (!field || !work) return 0;
  const cell = work.samples.get(sample);
  return carried(work.map, community, field.definition.id).reduce(
    (total, stock) => total + stock.get(cell),
    0
  );
}
/** Release unconsumed parcels back into their original reservoir, or crack charge from actual cores. */
export function useSolid(
  state: GenerationState,
  role: MagicRole,
  community: string,
  sample: number,
  amount: number,
  consume = false
) {
  const field = magicFieldForRole(state, role),
    work = state.physical;
  if (!field || !work) return 0;
  const cell = work.samples.get(sample),
    map = work.map;
  let remaining = amount;
  for (const source of carried(map, community, field.definition.id)) {
    const original = inventory(map, source.name.slice(prefix(community).length)),
      parcels: MaterialLayer[] = [];
    remaining -= source.extract(
      cell,
      remaining,
      { reach: MapScale.native(field.definition.parameters.buryDepth) },
      (parcel) =>
        parcels.push({
          ...parcel,
          cargo: consume
            ? withoutCargo(parcel.cargo, source.key)
            : rekeyCargo(parcel.cargo, source.key, original.key),
        })
    );
    for (const parcel of parcels) land(map, cell, cell, parcel);
  }
  return amount - remaining;
}
/** Trade moves the original grains between seats; the practice ledger only reports delivered charge. */
export function tradeSolid(
  state: GenerationState,
  role: MagicRole,
  from: string,
  to: string,
  sourceSample: number,
  targetSample: number,
  amount: number
) {
  const work = state.physical,
    field = magicFieldForRole(state, role);
  if (!work || !field || amount <= 0) return 0;
  const map = work.map,
    sourceCell = work.samples.get(sourceSample),
    targetCell = work.samples.get(targetSample);
  let remaining = amount;
  for (const source of carried(map, from, field.definition.id)) {
    const original = source.name.slice(prefix(from).length),
      target = inventory(map, prefix(to) + original, original),
      parcels: MaterialLayer[] = [];
    remaining -= source.extract(
      sourceCell,
      remaining,
      { reach: MapScale.native(field.definition.parameters.buryDepth) },
      (parcel) =>
        parcels.push({ ...parcel, cargo: rekeyCargo(parcel.cargo, source.key, target.key) })
    );
    for (const parcel of parcels) land(map, sourceCell, targetCell, parcel);
  }
  return amount - remaining;
}
