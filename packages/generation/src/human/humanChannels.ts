import {
  humanLayers,
  humanRemains,
  identityColumn,
  identityTraditions,
  type PhysicalFieldName,
} from "@atlas/domain";

/**
 * What each human band means on a map: its unit and bounds. Every value is per area of
 * ground, so maps publish the bands and child maps inherit them by these declarations alone.
 */
interface HumanChannel {
  name: PhysicalFieldName;
  unit: string;
  quantity?: "intensive" | "extensive" | "category";
  minimum?: number;
  maximum?: number;
  discrete?: boolean;
}
const share = (name: PhysicalFieldName): HumanChannel => ({
  name,
  unit: "ratio",
  minimum: 0,
  maximum: 1,
});
const density = (name: PhysicalFieldName, unit: string): HumanChannel => ({
  name,
  unit: `${unit}/square-kilometre`,
  minimum: 0,
});
const code = (name: PhysicalFieldName): HumanChannel => ({
  name,
  unit: "category",
  quantity: "category",
});
/**
 * A cell's human bands come from one donor together, so people are never split from the
 * identities they hold and land in use never adds up to more than the cell.
 */
const together = (channel: HumanChannel): HumanChannel => ({ ...channel, discrete: true });

export const humanChannels: HumanChannel[] = [
  density(humanLayers.population, "people"),
  share(humanLayers.farmland),
  share(humanLayers.pasture),
  share(humanLayers.builtUp),
  density(humanLayers.standing, "person-year"),
  share(humanRemains.builtUp),
  density(humanRemains.standing, "person-year"),
  share(humanRemains.cover),
  code(humanRemains.tongue),
  ...identityColumn.people.map((name) => density(name, "people")),
  ...identityColumn.hardness.map((name) => share(name)),
  ...identityColumn.age.map((name): HumanChannel => ({ name, unit: "year", minimum: 0 })),
  ...identityTraditions.flatMap((tradition) =>
    identityColumn.traditions[tradition].map((name) => code(name))
  ),
].map(together);
/** The features whose selection puts people on the map. */
export const humanFeatures = ["human.cultures", "human.politics", "built.layout"] as const;
