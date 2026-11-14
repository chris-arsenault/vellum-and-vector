import { humanLayers, humanRemains, MapScale } from "@atlas/domain";
import type { InspectionSection } from "@atlas/map";
import type { World } from "./types";
import type { CellRead, RockLayer } from "./cellLandFacts";
import { rockLayers, identityLayers, landUse, metres, percent, round } from "./cellLandFacts";

/** Resolve the same rock and people descriptions as cell inspection, on the publishing host. */
export function mapInspectionSections(
  world: World,
  read: CellRead,
  channels: ReadonlySet<string>,
  measure: number
): InspectionSection[] {
  return [...rockSections(world, read), ...peopleSections(world, read, channels, measure)];
}
function rockSections(world: World, read: CellRead): InspectionSection[] {
  const intact = [...rockLayers(world, read, "loose"), ...rockLayers(world, read, "land")];
  const valley = [...rockLayers(world, read, "cutLoose"), ...rockLayers(world, read, "cut")];
  if (!intact.length && !valley.length) return [];
  const cut = read("GroundCutShare");
  const sections: InspectionSection[] = [];
  if (cut > 0)
    sections.push({
      id: "valleys",
      title: "Valleys",
      records: [{ "Share of ground": percent(cut), Depth: metres(read("GroundCutDepth")) }],
    });
  if (intact.length)
    sections.push({
      id: "ground-column",
      title: cut > 0 ? "Under the uncut ground" : "Under this ground",
      records: intact.map(rockRecord),
    });
  if (cut > 0 && valley.length)
    sections.push({
      id: "valley-column",
      title: "Under the valley floors",
      records: valley.map(rockRecord),
    });
  return sections;
}
function rockRecord(layer: RockLayer) {
  return {
    "Layer, top first": layer.name,
    Thickness: metres(layer.thickness),
    Strength: round(layer.strength),
    Fractured: percent(layer.damage),
    Formed: layer.formed,
  };
}
function peopleSections(
  world: World,
  read: CellRead,
  channels: ReadonlySet<string>,
  measure: number
): InspectionSection[] {
  if (!channels.has(humanLayers.population)) return [];
  const density = read(humanLayers.population);
  if (density <= 0 && read(humanRemains.builtUp) <= 0)
    return [
      {
        id: "people",
        title: "People here",
        records: [{ Description: "Nobody lives on this cell and nothing built remains on it." }],
      },
    ];
  const sections: InspectionSection[] = [
    {
      id: "people",
      title: "People here",
      records: landUse(read, MapScale.areaUnits(measure, "m2", "km2")).map(([Fact, Value]) => ({
        Fact,
        Value,
      })),
    },
  ];
  const held = identityLayers(world, read);
  if (held.length)
    sections.push({
      id: "identity",
      title: "Who they are, newest layer first",
      records: held.map((layer) => ({
        Traditions: layer.traditions,
        "Share of people": density > 0 ? percent(Math.min(1, layer.people / density)) : "—",
        Age: `${round(layer.age)} years`,
        "Holds against change": percent(layer.hardness),
      })),
    });
  return sections;
}
