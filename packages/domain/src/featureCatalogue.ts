import type { AtlasFeature, LayerStyle, World } from "./model";
import { canonryMagicPresets } from "./magicPresets";

type Definition = [string, string, string, string, string];
export interface FeatureTypeStyle {
  footprints?: boolean;
  visible?: boolean;
  labels?: boolean;
  color?: string;
  opacity?: number;
}
// Kind, owning layer, label, presentation family and branch. Ownership stays unchanged.
export const featureDefinitions: Definition[] = [
  ["peak", "geology", "Peaks", "Terrain and geology", "Relief"],
  ["range", "geology", "Mountain ranges", "Terrain and geology", "Relief"],
  ["valley", "geology", "Valleys", "Terrain and geology", "Relief"],
  ["gorge", "geology", "Gorges", "Terrain and geology", "Relief"],
  ["hill", "geology", "Hills", "Terrain and geology", "Relief"],
  ["cirque", "geology", "Cirques", "Terrain and geology", "Glacial landforms"],
  ["moraine", "geology", "Moraine fields", "Terrain and geology", "Glacial landforms"],
  ["volcano", "geology", "Volcanoes", "Terrain and geology", "Volcanic and impact"],
  ["crater", "geology", "Craters", "Terrain and geology", "Volcanic and impact"],
  ["caldera", "geology", "Calderas", "Terrain and geology", "Volcanic and impact"],
  ["fault", "faults", "Fault traces", "Terrain and geology", "Tectonics"],
  ["waterfall", "geology", "Waterfalls", "Water and coasts", "Watercourses"],
  ["river", "rivers", "Rivers", "Water and coasts", "Watercourses"],
  ["lake", "lakes", "Lakes", "Water and coasts", "Water bodies"],
  ["ocean", "oceans", "Oceans and seas", "Water and coasts", "Water bodies"],
  ["fjord", "geology", "Fjords", "Water and coasts", "Water bodies"],
  ["forest", "ecology", "Forests", "Ecology", "Biomes"],
  ["grassland", "ecology", "Grasslands", "Ecology", "Biomes"],
  ["wetland", "ecology", "Wetlands", "Ecology", "Biomes"],
  ["barren", "ecology", "Barren land", "Ecology", "Biomes"],
  ["ember", "ecology", "Ember groves", "Ecology", "Magic-shaped landscapes"],
  ["thaw", "ecology", "Thaw meadows", "Ecology", "Magic-shaped landscapes"],
  ["rime", "ecology", "Rime forests", "Ecology", "Magic-shaped landscapes"],
  ["glow", "ecology", "Glow-lichen barrens", "Ecology", "Magic-shaped landscapes"],
  ["fog", "ecology", "Fog coasts", "Ecology", "Magic-shaped landscapes"],
  ["settlement", "settlements", "Settlements", "Settlements and sites", "Inhabited places"],
  ["settlement", "ruins", "Ruins and abandoned settlements", "Settlements and sites", "Ruins"],
  ["poi", "pois", "Places of interest", "Settlements and sites", "Named sites"],
  ["road", "roads", "Roads and routes", "Transport and water infrastructure", "Routes"],
  ["harbor", "transportSites", "Harbors", "Transport and water infrastructure", "Transport sites"],
  ["pass", "transportSites", "Passes", "Transport and water infrastructure", "Transport sites"],
  ["dam", "waterworks", "Dams", "Transport and water infrastructure", "Waterworks"],
  ["weir", "waterworks", "Weirs", "Transport and water infrastructure", "Waterworks"],
  ["irrigation", "waterworks", "Irrigation", "Transport and water infrastructure", "Waterworks"],
  ["clearance", "landUse", "Clearance", "Land use and extraction", "Land use"],
  ["burning", "landUse", "Burning", "Land use and extraction", "Land use"],
  ["hunting", "landUse", "Hunting", "Land use and extraction", "Land use"],
  ["conservation", "landUse", "Conservation", "Land use and extraction", "Land use"],
  ["tapping", "magicPractices", "Fire tapping", "Land use and extraction", "Extraction"],
  ["quarrying", "magicPractices", "Crystal quarrying", "Land use and extraction", "Extraction"],
  ["fire-forge", "magicPractices", "Fire forges", "Society and culture", "Magic practices"],
  ["aurora-archive", "magicPractices", "Aurora archives", "Society and culture", "Magic practices"],
  [
    "pressure-diving",
    "magicPractices",
    "Pressure diving sites",
    "Society and culture",
    "Magic practices",
  ],
  ["institution", "institutions", "Institutions", "Society and culture", "Communities"],
  ["culturalOrigin", "cultures", "Cultural communities", "Society and culture", "Communities"],
  ["languageCenter", "languages", "Language centers", "Society and culture", "Communities"],
  ["religiousCenter", "religions", "Religious centers", "Society and culture", "Communities"],
  ["sovereignty", "sovereignty", "Sovereignty", "Politics", "Territories"],
  ["jurisdiction", "administration", "Administration", "Politics", "Territories"],
  ["administration", "administration", "Authored administration", "Politics", "Territories"],
  ["claim", "claims", "Territorial claims", "Politics", "Territories"],
  ["control", "control", "Effective control", "Politics", "Territories"],
  ["societyEvent", "historicalEvents", "Events and disasters", "History", "Events"],
  ["building", "structures", "Buildings", "Structures and interiors", "Structures"],
  ["room", "structures", "Rooms", "Structures and interiors", "Spaces"],
  ["wall", "structures", "Walls", "Structures and interiors", "Components"],
  ["door", "structures", "Doors", "Structures and interiors", "Connections"],
  ["furniture", "structures", "Furnishings", "Structures and interiors", "Components"],
  ["template", "structures", "Templates", "Structures and interiors", "Structures"],
];
const definitions = new Map(featureDefinitions.map((d) => [`${d[1]}:${d[0]}`, d]));
const defaults = canonryMagicPresets();
const roles: Record<string, string> = {
  capital: "Capitals",
  regionalCapital: "Regional capitals",
  marketTown: "Market towns",
  settlement: "Other settlements",
};
export interface FeatureType {
  id: string;
  layerId: string;
  kind: string;
  label: string;
  path: string[];
}
export const featureGroupKey = (path: string[]) => JSON.stringify(path);
type Classification = Pick<AtlasFeature, "kind" | "layerId" | "attributes">;
export function describeFeature(world: World, feature: Classification): FeatureType {
  const magic = magicType(world, feature);
  if (magic) return magic;
  const d = definitions.get(`${feature.layerId}:${feature.kind}`);
  const layer = world.layers[feature.layerId];
  const path = d
    ? d.slice(3).concat(d[2])
    : ["Custom", layer?.name ?? feature.layerId, feature.kind];
  const subtype = featureSubtype(feature);
  if (subtype) path.push(subtype);
  return {
    id: JSON.stringify([feature.layerId, feature.kind, subtype]),
    layerId: feature.layerId,
    kind: feature.kind,
    label: path.at(-1)!,
    path,
  };
}
function featureSubtype(feature: Classification) {
  const a = feature.attributes;
  if (feature.kind === "settlement" && feature.layerId === "settlements")
    return roles[String(a.settlementRole ?? "settlement")] ?? String(a.settlementRole);
  if (feature.layerId === "ecology" && typeof a.biome === "string") return a.biome;
  if (feature.kind === "societyEvent" && typeof a.eventKind === "string") return a.eventKind;
  return "";
}
function magicType(world: World, feature: Classification): FeatureType | null {
  if (feature.layerId !== "magic") return null;
  const { systemId, system, ruleId, rule } = magicClassification(world, feature);
  const interaction = rule?.seeds.flat().some((c) => c.field.startsWith("system:"));
  const label = feature.kind === "magicSource" ? "Authored sources" : (rule?.name ?? ruleId);
  const path = ["Magic", interaction ? "Interactions" : (system?.name ?? systemId), label];
  return {
    id: JSON.stringify(["magic", systemId, ruleId]),
    layerId: "magic",
    kind: feature.kind,
    label,
    path,
  };
}
function magicClassification(world: World, feature: Classification) {
  const systemId = String(feature.attributes.system ?? feature.kind.split(":")[0]);
  const system = (world.magicSystems ?? defaults).find((s) => s.id === systemId);
  const ruleId = String(feature.attributes.rule ?? feature.kind.split(":")[1] ?? "source");
  const rule = system?.features.find((r) => r.id === ruleId);
  return { systemId, system, ruleId, rule };
}
export function availableFeatureTypes(world: World, features: AtlasFeature[], empty = false) {
  const types = new Map<string, FeatureType>();
  const add = (feature: Classification) => {
    const type = describeFeature(world, feature);
    types.set(type.id, type);
  };
  if (empty) {
    for (const [kind, layerId] of featureDefinitions)
      if (world.layers[layerId]) add({ kind, layerId, attributes: {} });
    for (const system of world.magicSystems ?? defaults)
      for (const rule of system.features)
        add({
          kind: `${system.id}:${rule.id}`,
          layerId: "magic",
          attributes: { system: system.id, rule: rule.id },
        });
  }
  features.forEach(add);
  return [...types.values()].sort((a, b) => a.path.join(" / ").localeCompare(b.path.join(" / ")));
}
export function typePresentation(type: FeatureType, style: LayerStyle) {
  const own: FeatureTypeStyle = style.types?.[type.id] ?? {};
  const grouped = type.path.some(
    (_, i) => style.groups?.[featureGroupKey(type.path.slice(0, i + 1))] === false
  );
  return { ...style, ...own, visible: style.visible && !grouped && own.visible !== false };
}
export function presentedFeatureStyle(world: World, feature: AtlasFeature, style: LayerStyle) {
  return typePresentation(describeFeature(world, feature), style);
}
