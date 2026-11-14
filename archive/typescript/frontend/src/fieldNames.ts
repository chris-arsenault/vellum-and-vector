import {
  columnFields,
  columns,
  humanLayers,
  humanRemains,
  identityColumn,
  identityTraditions,
  loadFields,
  materialProperties,
  MapScale,
  seaLoadFields,
  type Column,
  type IdentityTradition,
  type MaterialProperty,
  type SurfaceCategory,
} from "@atlas/domain";
import { crafts, surfaceMaterialCategories } from "@atlas/generation";
import type { World } from "./types";

/** The traditions the world's entities name; a craft is named by its magic system. */
type NamedTradition = Exclude<IdentityTradition, "Craft">;
/** What a stored layer is called on the map, and where the overlay list files it. */
export interface FieldName {
  label: string;
  theme: "People" | "Rock and ground";
  branch: string;
  /** Offered without opening the full list. */
  common?: boolean;
  /** The classes its codes name: rock kinds, a tradition, or a craft. */
  classes?: "rock" | "craft" | NamedTradition;
}

/** Layers of a cell's identity, newest first. */
const layerTerms = ["latest layer", "second layer", "third layer", "oldest layer"];
const traditionTerms: Record<IdentityTradition, string> = {
  Tongue: "Tongue",
  Faith: "Faith",
  Custom: "Custom",
  Allegiance: "Realm",
  Craft: "Magic craft",
};
const columnTerms: Record<Column, string> = {
  land: "Rock",
  cut: "Rock under valley floors",
  loose: "Loose cover",
  cutLoose: "Loose cover on valley floors",
};
const propertyTerms: Record<MaterialProperty, string> = {
  kind: "kind",
  depth: "thickness",
  secondaryKind: "second rock",
  secondaryShare: "share of second rock",
  strength: "strength",
  damage: "fracturing",
  grainX: "grain, east",
  grainY: "grain, north",
  bedSlopeX: "bed slope, east",
  bedSlopeY: "bed slope, north",
  deposited: "epoch laid down",
  consolidation: "hardening",
  formedMin: "earliest epoch formed",
  formedMax: "latest epoch formed",
  altered: "epoch altered",
  mixed: "mixing",
};
const rockClasses = (property: MaterialProperty) =>
  property === "kind" || property === "secondaryKind" ? ("rock" as const) : undefined;

function peopleNames(): [string, FieldName][] {
  const land = (label: string, common = true): FieldName => ({
      label,
      theme: "People",
      branch: "People and land in use",
      common,
    }),
    ruin = (label: string, common = false): FieldName => ({
      label,
      theme: "People",
      branch: "Ruins",
      common,
    });
  return [
    [humanLayers.population, land("People")],
    [humanLayers.farmland, land("Farmland")],
    [humanLayers.pasture, land("Pasture")],
    [humanLayers.builtUp, land("Built-up ground")],
    [humanLayers.standing, land("Works and wealth", false)],
    [humanRemains.builtUp, ruin("Ruined ground", true)],
    [humanRemains.standing, ruin("Works left in ruins")],
    [humanRemains.cover, ruin("Ruins buried or drowned")],
    [humanRemains.tongue, { ...ruin("Tongue of the ruin builders"), classes: "Tongue" }],
  ];
}
function identityNames(): [string, FieldName][] {
  const named = (label: string, slot: number, extra: Partial<FieldName> = {}): FieldName => ({
    label: `${label} · ${layerTerms[slot]}`,
    theme: "People",
    branch: "Who the people are",
    ...extra,
  });
  return [
    ...identityTraditions.flatMap((tradition) =>
      identityColumn.traditions[tradition].map((name, slot): [string, FieldName] => [
        name,
        named(traditionTerms[tradition], slot, {
          common: slot === 0,
          classes: tradition === "Craft" ? "craft" : tradition,
        }),
      ])
    ),
    ...identityColumn.people.map((name, slot): [string, FieldName] => [
      name,
      named("People holding it", slot),
    ]),
    ...identityColumn.hardness.map((name, slot): [string, FieldName] => [
      name,
      named("Resistance to change", slot),
    ]),
    ...identityColumn.age.map((name, slot): [string, FieldName] => [name, named("Age", slot)]),
  ];
}
function columnNames(): [string, FieldName][] {
  return columns.flatMap((column) =>
    materialProperties.flatMap((property) =>
      columnFields[column][property].map((name, slot): [string, FieldName] => [
        name,
        {
          label: `${columnTerms[column]} · layer ${slot + 1}${slot ? "" : " (top)"} · ${propertyTerms[property]}`,
          theme: "Rock and ground",
          branch: columnTerms[column],
          common:
            slot === 0 && (property === "kind" || property === "depth") && !/cut/i.test(column),
          classes: rockClasses(property),
        },
      ])
    )
  );
}
function loadNames(): [string, FieldName][] {
  const loads = [
    [loadFields, "Sediment in the river"],
    [seaLoadFields, "Sediment in the sea"],
  ] as const;
  return loads.flatMap(([fields, branch]) =>
    Object.entries(fields).map(([property, name]): [string, FieldName] => [
      name,
      {
        label: `${branch} · ${propertyTerms[property as MaterialProperty] ?? property}`,
        theme: "Rock and ground",
        branch,
        classes: rockClasses(property as MaterialProperty),
      },
    ])
  );
}
const ground: [string, FieldName][] = (
  [
    ["RockKindCodes", "Rock at the surface", true, "rock"],
    ["RockResistance", "Rock strength at the surface", true],
    ["BedrockElevation", "Top of the bedrock"],
    ["CrustSupportElevation", "Height the crust floats at"],
    ["CrustThickness", "Crust thickness"],
    ["SurfaceRockLoad", "Rock load on the crust"],
    ["CrustContinentalFraction", "Continental share of the crust"],
    ["GroundCutShare", "Share of the cell cut into valleys", true],
    ["GroundCutDepth", "Depth of the valleys"],
    ["GroundCutCover", "Cover on the valley floors"],
  ] as const
).map(([name, label, common, classes]) => [
  name,
  { label, theme: "Rock and ground", branch: "", common: Boolean(common), classes },
]);

const names = new Map<string, FieldName>([
  ...peopleNames(),
  ...identityNames(),
  ...columnNames(),
  ...loadNames(),
  ...ground,
]);
/** The plain name, theme and classes of a people or ground layer; nothing for other fields. */
export const fieldName = (channel: string) => names.get(channel);

const none: SurfaceCategory = {
  code: 0,
  name: "None",
  color: "rgba(0,0,0,0)",
  bathymetric: false,
  tint: 1,
};
/** A steady colour for a code, spread round the wheel so neighbours in number differ. */
const codeColour = (code: number) =>
  `hsl(${Math.round((code * 137.508) % 360)} ${55 + (code % 3) * 12}% ${42 + (code % 4) * 7}%)`;
const classed = (code: number, name: string): SurfaceCategory => ({
  code,
  name,
  color: codeColour(code),
  bathymetric: false,
  tint: 1,
});
const traditionKinds: Record<NamedTradition, string> = {
  Tongue: "tongue",
  Faith: "faith",
  Custom: "custom",
  Allegiance: "allegiance",
};
const traditionCache = new WeakMap<World["entities"], Map<string, SurfaceCategory[]>>();
/** The traditions of one kind the world's entities name, by the code the land's layers use. */
function traditionClasses(world: World, tradition: NamedTradition) {
  let cached = traditionCache.get(world.entities);
  if (!cached) traditionCache.set(world.entities, (cached = new Map()));
  let classes = cached.get(tradition);
  if (!classes) {
    classes = [none];
    for (const entity of Object.values(world.entities)) {
      const code = Number(entity.attributes.traditionCode);
      if (code >= 1 && entity.attributes.traditionKind === traditionKinds[tradition])
        classes.push(classed(code, entity.name));
    }
    cached.set(tradition, classes);
  }
  return classes;
}
const craftClasses = (world: World) => [
  none,
  ...crafts.map((craft) =>
    classed(
      craft.code,
      `${world.magicSystems?.find((system) => system.id === craft.system)?.name ?? craft.system} · ${craft.name}`
    )
  ),
];
/** The named classes of a people or ground layer whose values are codes. */
export function fieldClasses(world: World, channel: string): SurfaceCategory[] | null {
  const classes = names.get(channel)?.classes;
  if (!classes) return null;
  if (classes === "rock") return surfaceMaterialCategories;
  return classes === "craft" ? craftClasses(world) : traditionClasses(world, classes);
}

/** How a stored unit reads on the map: the unit shown and what one stored step is worth. */
const shown: Record<string, { unit: string; factor: number }> = {
  "native-length": { unit: "m", factor: MapScale.metres(1, "native") },
  "per-mille": { unit: "%", factor: 0.1 },
  ratio: { unit: "%", factor: 100 },
  "deci-celsius": { unit: "°C", factor: 0.1 },
  "square-metre": { unit: "km²", factor: 1e-6 },
  "people/square-kilometre": { unit: "people per km²", factor: 1 },
  "person-year/square-kilometre": { unit: "person-years per km²", factor: 1 },
  "millimetre/year": { unit: "mm a year", factor: 1 },
  "cubic-metre/second": { unit: "m³ a second", factor: 1 },
  "cubic-metre/year": { unit: "m³ a year", factor: 1 },
  "cubic-metre": { unit: "m³", factor: 1 },
  "metre/second": { unit: "m a second", factor: 1 },
  metre: { unit: "m", factor: 1 },
  year: { unit: "years", factor: 1 },
  gradient: { unit: "rise over run", factor: 1 },
  category: { unit: "Classes", factor: 1 },
};
export const shownUnit = (unit: string) => shown[unit] ?? { unit, factor: 1 };
