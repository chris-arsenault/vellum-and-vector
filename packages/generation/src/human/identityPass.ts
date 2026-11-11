import { humanLayers } from "@atlas/domain";
import type { GenerationState } from "../process";
import { defineCommand, runOperation } from "../processOperation";
import { ask } from "../coupling/answers";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { meshDeltaX } from "../world/mesh";
import { reachedBy } from "./hinterlands";
import { leadingAll, type Leading, type TraditionField } from "./identityReads";
import { sunderIdentities } from "./identitySunder";
import { habitable, km2 } from "./landWork";
import { hardenIdentity, inheritIdentity, overlayIdentity } from "./layerOperations";
import type { Passage } from "./reach";
import { foundTradition, knownTraditions, type TraditionKind } from "./traditions";

/**
 * Identity on the land. Founding peoples begin at separate origins and their traditions are
 * taken up along the going from each. After that, in every era, the born hold what their
 * parents hold; neighbours take up one another's tongue, faith and custom in proportion to
 * how many of them there are and how easy the going between them is; a people cut off from
 * the heart of its tradition by more travel than a tongue survives begins a daughter of it;
 * and what people hold ages and sets. Nothing here keeps who holds what: the column does.
 */
export interface IdentityEra {
  state: GenerationState;
  map: PhysicalField;
  /** How the land is asked its shared questions in this era. */
  context: PhysicalContext;
  /** The cost of a step between neighbours, and every step's passage at the era's range. */
  step: (from: number, to: number) => number;
  going: Passage;
  era: string;
  years: number;
  /** How readily this era's people take up their neighbours' ways. */
  mobility: number;
  /** How many founding peoples the map begins with. */
  founders: number;
}
/** The traditions people take up from their neighbours. */
const shared: TraditionField[] = ["tongue", "faith", "custom"];
/** The share of a cell that takes up a neighbouring tradition in a century of full contact. */
const contact = 0.15;
/** Years over which an identity sets as hard as its place can hold it. */
const settling = 300;

const people = (map: PhysicalField, cell: number) => map[humanLayers.population].get(cell);
const count = (map: PhysicalField, cell: number) => people(map, cell) * km2(map, cell);
const place = (map: PhysicalField, cell: number) => ({
  x: map.mesh.origin[0] + map.mesh.x(cell),
  y: map.mesh.origin[1] + map.mesh.y(cell),
});
const apart = (map: PhysicalField, a: number, b: number) =>
  Math.hypot(meshDeltaX(map.mesh, map.mesh.x(a) - map.mesh.x(b)), map.mesh.y(a) - map.mesh.y(b));
const codes = (values: Int32Array) => ({ get: (cell: number) => values[cell] });

/** The most peopled cells of the map, each well apart from the others. */
function origins(map: PhysicalField, wanted: number) {
  const lived: number[] = [];
  let land = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!habitable(map, cell)) continue;
    land += map.mesh.area(cell);
    if (people(map, cell) > 0) lived.push(cell);
  }
  lived.sort((a, b) => count(map, b) - count(map, a) || a - b);
  const spacing = Math.sqrt(land / Math.max(1, wanted)) / 2,
    chosen: number[] = [];
  for (const cell of lived) {
    if (chosen.length >= wanted) break;
    if (chosen.every((other) => apart(map, cell, other) >= spacing)) chosen.push(cell);
  }
  return chosen;
}
/** The nearest of the given cells to a cell, by the straight distance between them. */
function nearest(map: PhysicalField, cell: number, among: readonly number[]) {
  let best = 0;
  for (let index = 1; index < among.length; index++)
    if (apart(map, cell, among[index]) < apart(map, cell, among[best])) best = index;
  return best;
}
/** Where nobody holds any tradition yet, founding peoples begin and their ways are taken up. */
export const foundIdentities = defineCommand(
  "human.identity.found",
  "initialize",
  ({ state, map, step, era, founders }: IdentityEra) => {
    if (knownTraditions(state).some((tradition) => tradition.kind !== "allegiance")) return;
    const began = origins(map, founders);
    if (!began.length) return;
    const found = (kind: TraditionKind, cell: number, tongue?: number) =>
        foundTradition(state, {
          kind,
          key: `origin:${cell}`,
          origin: place(map, cell),
          era,
          tongue,
        }),
      peoples = began.map((cell) => {
        const tongue = found("tongue", cell);
        return {
          tongue,
          faith: found("faith", cell, tongue),
          custom: found("custom", cell, tongue),
        };
      }),
      reached = reachedBy(map, began, step, Infinity),
      taken = {
        tongue: new Int32Array(map.mesh.count),
        faith: new Int32Array(map.mesh.count),
        custom: new Int32Array(map.mesh.count),
      };
    for (let cell = 0; cell < map.mesh.count; cell++) {
      if (!(people(map, cell) > 0)) continue;
      // An island no going reaches takes the ways of the nearest origin over the water.
      const from = peoples[reached[cell] >= 0 ? reached[cell] : nearest(map, cell, began)];
      for (const field of shared)
        taken[field as keyof typeof taken][cell] = from[field as keyof typeof from];
    }
    runOperation(map, overlayIdentity, {
      map,
      traditions: {
        tongue: codes(taken.tongue),
        faith: codes(taken.faith),
        custom: codes(taken.custom),
      },
      people: map[humanLayers.population],
      hardness: 0,
    });
  },
  []
);
/** One neighbouring tradition a cell feels, and how many of its people take it up. */
interface Contact {
  code: number;
  taking: number;
}
/**
 * For one tradition: every differing tradition each cell's neighbours lead with, and who
 * takes each up. A cell feels all of them at once, each in proportion to the people who
 * press it and the going from them, against its own numbers.
 */
function felt(map: PhysicalField, going: Passage, leading: Leading, rate: number) {
  const mesh = map.mesh,
    contacts: Contact[][] = [];
  for (let cell = 0; cell < mesh.count; cell++) {
    const own = count(map, cell);
    if (!(own > 0)) continue;
    // hpc-exempt: at most one entry per neighbour of the cell.
    const pressing = new Map<number, number>();
    let all = 0;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const next = mesh.neighbor(cell, edge);
      if (next < 0 || !leading.code[next] || leading.code[next] === leading.code[cell]) continue;
      const press =
        leading.people[next] *
        km2(map, next) *
        going.passed.get(cell * going.stride + edge) *
        going.stride;
      pressing.set(leading.code[next], (pressing.get(leading.code[next]) ?? 0) + press);
      all += press;
    }
    if (!(all > 0)) continue;
    contacts[cell] = [...pressing]
      .sort(([a], [b]) => a - b)
      .map(([code, press]) => ({ code, taking: (people(map, cell) * rate * press) / (all + own) }));
  }
  return contacts;
}
/** Neighbours take up one another's tongue, faith and custom, from every side at once. */
export const shareIdentities = defineCommand(
  "human.identity.contact",
  "elapsed",
  ({ map, going, years, mobility, context }: IdentityEra) => {
    const rate = Math.min(1, contact * mobility * (years / 100)),
      // What a people already holds gives way to its neighbours' as fast as it is forgotten.
      fading = ask(map, "forgetting", context),
      leading = leadingAll(map),
      // Every tradition's contact is read before any is taken up.
      taken = shared.map((field) => ({ field, contacts: felt(map, going, leading[field], rate) }));
    for (const { field, contacts } of taken) {
      const most = contacts.reduce((depth, list) => Math.max(depth, list?.length ?? 0), 0);
      // A cell's contacts are laid one tradition at a time; each round is the next of them.
      for (let round = 0; round < most; round++)
        runOperation(map, overlayIdentity, {
          map,
          traditions: { [field]: { get: (cell: number) => contacts[cell]?.[round]?.code ?? 0 } },
          people: {
            get: (cell: number) => (contacts[cell]?.[round]?.taking ?? 0) * fading.get(cell),
          },
          hardness: 0,
        });
    }
  },
  []
);
/** One era of identity: founding if nobody holds any, then inheritance, contact, and setting. */
export const liveIdentities = defineCommand(
  "human.identity.era",
  "elapsed",
  (era: IdentityEra) => {
    const { map, years } = era;
    runOperation(map, foundIdentities, era);
    runOperation(map, inheritIdentity, { map });
    runOperation(map, shareIdentities, era);
    runOperation(map, sunderIdentities, era);
    runOperation(map, hardenIdentity, { map, years, settling });
  },
  []
);
