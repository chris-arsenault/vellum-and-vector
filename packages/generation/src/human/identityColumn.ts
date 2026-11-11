import { identitySlots } from "@atlas/domain";

/**
 * One layer of a cell's identity column: the people who hold it, how far it resists being
 * overlaid (0 to 1), its age in years, and the traditions it names as codes (0 is none).
 */
export interface IdentityLayer {
  people: number;
  hardness: number;
  age: number;
  tongue: number;
  faith: number;
  custom: number;
  allegiance: number;
}
/** What a layer names, without how many hold it. */
export type IdentityTraditions = Pick<IdentityLayer, "tongue" | "faith" | "custom" | "allegiance">;
/** A cell's column, newest layer first. Older layers lie under newer ones. */
export type IdentityColumn = IdentityLayer[];

const nothing: IdentityTraditions = { tongue: 0, faith: 0, custom: 0, allegiance: 0 };
/** Fewer people than this hold nothing worth a layer. */
const trace = 1e-6;
const sameTraditions = (a: IdentityTraditions, b: IdentityTraditions) =>
  a.tongue === b.tongue &&
  a.faith === b.faith &&
  a.custom === b.custom &&
  a.allegiance === b.allegiance;
/** Two holdings of the same traditions are one layer: its people add and its state is theirs. */
function join(into: IdentityLayer, from: IdentityLayer) {
  const people = into.people + from.people;
  if (people <= 0) return;
  into.hardness = (into.hardness * into.people + from.hardness * from.people) / people;
  into.age = (into.age * into.people + from.age * from.people) / people;
  into.people = people;
}
/** The column without its empty layers, and no deeper than a cell can hold. */
export function settleColumn(column: IdentityColumn) {
  for (let n = column.length - 1; n >= 0; n--) if (column[n].people <= trace) column.splice(n, 1);
  while (column.length > identitySlots) {
    // The thinnest layer is lost into the layer most like it: the one sharing the most
    // traditions, and of those the nearest, so a few people keep as much as they can.
    let thinnest = 0;
    for (let n = 1; n < column.length; n++)
      if (column[n].people < column[thinnest].people) thinnest = n;
    const [lost] = column.splice(thinnest, 1);
    let heir = 0;
    for (let n = 1; n < column.length; n++) {
      const more = alike(column[n], lost) - alike(column[heir], lost);
      if (more > 0 || (more === 0 && Math.abs(n - thinnest) < Math.abs(heir - thinnest))) heir = n;
    }
    join(column[heir], { ...lost, hardness: column[heir].hardness, age: column[heir].age });
  }
  return column;
}
/** How many traditions two layers share. */
const alike = (a: IdentityTraditions, b: IdentityTraditions) =>
  Number(a.tongue === b.tongue) +
  Number(a.faith === b.faith) +
  Number(a.custom === b.custom) +
  Number(a.allegiance === b.allegiance);
/**
 * A tradition is renamed for those who hold it: every layer naming `from` names `to`
 * instead, whoever its people are and however set. Nobody is asked; a people cut off simply
 * speaks what its tongue has become, and a dissolved allegiance is what it broke from.
 */
export function renameInColumn(
  column: IdentityColumn,
  field: keyof IdentityTraditions,
  from: number,
  to: number
) {
  const renamed = column
    .splice(0)
    .map((layer) => (layer[field] === from ? { ...layer, [field]: to } : layer));
  // Renamed layers may now name what another layer names; they join it where it lies.
  for (const layer of renamed) {
    const held = column.find((other) => sameTraditions(other, layer));
    if (held) join(held, layer);
    else column.push(layer);
  }
  return settleColumn(column);
}
/**
 * People arriving with what they already hold: they join the layer that names the same
 * traditions wherever it lies, or become the newest layer. Nobody already here changes.
 */
export function arriveInColumn(column: IdentityColumn, arriving: readonly IdentityLayer[]) {
  // Arrivals are laid oldest first so their own order survives on top.
  for (let n = arriving.length - 1; n >= 0; n--) {
    const layer = arriving[n];
    if (layer.people <= trace) continue;
    const held = column.find((other) => sameTraditions(other, layer));
    if (held) join(held, layer);
    else column.unshift({ ...layer });
  }
  return settleColumn(column);
}
/**
 * A new layer laid over the column: it reaches `people` of those here who do not already
 * hold what it names, and those of them not hardened against it take it up, keeping their
 * other traditions; what they now hold becomes the newest layers. `unheld` are the people here who
 * hold no layer yet; they take it up as readily as an unhardened layer. Returns how many
 * took it up.
 */
export function overlayColumn(
  column: IdentityColumn,
  changes: Partial<IdentityTraditions>,
  people: number,
  hardness = 0,
  unheld = 0
) {
  // Whoever takes the new layer up keeps the traditions it does not name.
  const changed = (layer: IdentityTraditions): IdentityTraditions => ({
      tongue: changes.tongue ?? layer.tongue,
      faith: changes.faith ?? layer.faith,
      custom: changes.custom ?? layer.custom,
      allegiance: changes.allegiance ?? layer.allegiance,
    }),
    giving = column.filter((layer) => !sameTraditions(layer, changed(layer))),
    without = Math.max(0, unheld);
  let open = without,
    asked = without;
  for (const layer of giving) {
    open += layer.people * (1 - layer.hardness);
    asked += layer.people;
  }
  // The call reaches `people` of those who could take it up; the hardened among them refuse.
  const taken = asked > 0 ? (Math.min(Math.max(0, people), asked) * open) / asked : 0;
  if (taken <= trace) return 0;
  const arriving: IdentityLayer[] = [
    { ...changed(nothing), people: (taken * without) / open, hardness, age: 0 },
  ];
  for (const layer of giving) {
    const moved = (taken * layer.people * (1 - layer.hardness)) / open;
    layer.people -= moved;
    // What they keep of who they were is as old and as set as it was.
    arriving.push({ ...changed(layer), people: moved, hardness: layer.hardness, age: layer.age });
  }
  arriveInColumn(column, arriving);
  return taken;
}
/** A share of every layer leaves the column, and is returned as layers of its own. */
export function partColumn(column: IdentityColumn, share: number): IdentityLayer[] {
  const leaving = Math.min(1, Math.max(0, share)),
    parted = column.map((layer) => ({ ...layer, people: layer.people * leaving }));
  for (const layer of column) layer.people *= 1 - leaving;
  settleColumn(column);
  return parted.filter((layer) => layer.people > trace);
}
/**
 * People leave the newest layers, from the top down, and fall back to what lies beneath: the
 * older layer is the surface again and holds them. With nothing beneath they hold no layer.
 */
export function reExposeColumn(column: IdentityColumn, people: number) {
  let owed = Math.max(0, people),
    fallen = 0,
    last = -1;
  for (let n = 0; n < column.length && owed > 0; n++) {
    const taken = Math.min(column[n].people, owed);
    column[n].people -= taken;
    owed -= taken;
    fallen += taken;
    last = n;
  }
  const beneath = column[last + 1];
  if (last >= 0 && beneath) beneath.people += fallen;
  return settleColumn(column);
}
/** The column scaled to hold `people` in all, keeping each layer's share. */
export function fitColumn(column: IdentityColumn, people: number) {
  let held = 0;
  for (const layer of column) held += layer.people;
  if (held <= trace) return settleColumn(column);
  const scale = Math.max(0, people) / held;
  for (const layer of column) layer.people *= scale;
  return settleColumn(column);
}
