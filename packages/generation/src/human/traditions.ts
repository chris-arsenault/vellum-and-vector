import { semanticId, type Entity } from "@atlas/domain";
import { atlasName, nameMetadata, namingCulture } from "../atlasNaming";
import type { GenerationState } from "../process";
import { runMemory } from "../runMemory";

/**
 * The traditions the identity column names. The column holds a code per tradition; this is
 * the run's memory of what each code is: a tongue, a faith, a custom or an allegiance, the
 * named entity the world knows it by, the tradition it came from, and where it began. A
 * tradition is never the source of who holds it; the column is.
 */
export type TraditionKind = "tongue" | "faith" | "custom" | "allegiance";
export interface Tradition {
  readonly code: number;
  readonly kind: TraditionKind;
  /** The world entity that names it. */
  readonly entity: string;
  /** The tradition it derived from, by code. */
  readonly parent?: number;
  readonly founded: string;
  /** Where it began, in map coordinates. */
  readonly origin: { x: number; y: number };
  /** For an allegiance: the known place that is its seat. */
  seat?: string;
  /** The era it ended in: a realm that lost its last seat. Nobody takes it up afterwards. */
  ended?: string;
}
/** What the world calls each kind of tradition. */
const entityKind: Record<TraditionKind, string> = {
  tongue: "language",
  faith: "religion",
  custom: "culture",
  allegiance: "polity",
};
interface Traditions {
  known: Tradition[];
}
const traditions = (state: GenerationState) =>
  runMemory<Traditions>(state, "human.traditions", () => ({ known: [] }));
export const knownTraditions = (state: GenerationState): readonly Tradition[] =>
  traditions(state).known;
/** A code's tradition; codes start at one, so a column's zero names none. */
export const traditionOf = (state: GenerationState, code: number): Tradition | undefined =>
  traditions(state).known[code - 1];
export const entityOf = (state: GenerationState, code: number): Entity | undefined => {
  const tradition = traditionOf(state, code);
  return tradition && state.domain.world.entities[tradition.entity];
};

export interface Founding {
  kind: TraditionKind;
  /** What tells this founding from every other of its kind, for a stable identity. */
  key: string;
  origin: { x: number; y: number };
  era: string;
  parent?: number;
  /** The tongue its name is given in, by code; the ground's own naming where there is none. */
  tongue?: number;
}
/** The name a new tradition goes by, in the tongue of those who found it. */
function named(state: GenerationState, id: string, founding: Founding) {
  const world = state.domain.world,
    language = founding.tongue ? traditionOf(state, founding.tongue)?.entity : undefined;
  if (founding.kind === "allegiance")
    return atlasName(world, {
      key: id,
      kind: "polity",
      subkind: "commonwealth",
      term: "Commonwealth",
      position: founding.origin,
      language,
      era: founding.era,
    });
  return atlasName(world, {
    key: id,
    kind: "culture",
    position: founding.origin,
    language,
    era: founding.era,
  });
}
const suffix: Record<TraditionKind, string> = {
  tongue: " tongue",
  faith: " rite",
  custom: "",
  allegiance: "",
};
/** A new tradition and the entity the world knows it by. Returns its code. */
export function foundTradition(state: GenerationState, founding: Founding) {
  const memory = traditions(state),
    world = state.domain.world,
    id = semanticId(world.id, entityKind[founding.kind], founding.key),
    parent = founding.parent ? traditionOf(state, founding.parent) : undefined,
    name = named(state, id, founding),
    // A tradition names things as its parent did, or as the ground it began on does.
    naming =
      (parent && world.entities[parent.entity]?.attributes.namingCulture) ??
      namingCulture(world, founding.origin).id;
  world.entities[id] ??= {
    id,
    kind: entityKind[founding.kind],
    name: `${name.name}${suffix[founding.kind]}`,
    state: "generated",
    attributes: {
      ...nameMetadata(name),
      namingCulture: naming,
      center: { ...founding.origin, z: 0 },
    },
    relations: parent ? [{ targetId: parent.entity, kind: "derivedFrom" }] : [],
  };
  const code = memory.known.length + 1;
  // The entity says which code the land's layers name it by, so a map made of this one,
  // which inherits the layers and not this run's memory, can tell who its people are.
  world.entities[id].attributes = {
    ...world.entities[id].attributes,
    traditionCode: code,
    traditionKind: founding.kind,
    founded: founding.era,
  };
  memory.known.push({
    code,
    kind: founding.kind,
    entity: id,
    parent: founding.parent,
    founded: founding.era,
    origin: founding.origin,
  });
  return code;
}
const kinds: readonly TraditionKind[] = ["tongue", "faith", "custom", "allegiance"];
/**
 * A map made of another inherits its people's layers, which name traditions by code. The
 * world's entities say which code is which: this reads them back as the run's memory, once,
 * where the run holds none.
 */
export function restoreTraditions(state: GenerationState) {
  const memory = traditions(state);
  if (memory.known.length) return;
  for (const entity of Object.values(state.domain.world.entities)) {
    const code = Number(entity.attributes.traditionCode),
      kind = kinds.find((one) => one === entity.attributes.traditionKind);
    if (Number.isInteger(code) && code >= 1 && kind)
      memory.known[code - 1] = { code, kind, entity: entity.id, ...begun(entity) };
  }
  // A code whose entity the world no longer holds names a tradition nobody can name.
  for (let n = 0; n < memory.known.length; n++)
    memory.known[n] ??= {
      code: n + 1,
      kind: "custom",
      entity: "",
      founded: "",
      origin: { x: 0, y: 0 },
      ended: "forgotten",
    };
}
/** When and where an entity says its tradition began. */
function begun(entity: Entity) {
  const center = entity.attributes.center as { x: number; y: number } | undefined;
  return {
    founded: String(entity.attributes.founded ?? ""),
    origin: { x: center?.x ?? 0, y: center?.y ?? 0 },
  };
}
