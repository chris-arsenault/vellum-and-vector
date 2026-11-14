import {
  builtinLayers,
  requireThat,
  fieldChannelName,
  type Layer,
  type World,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { resolveGenerationFeatures, type ResolvedFeatures } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { domainFeatureDefinitions } from "../domainFeatures";
import type { FieldPublicationDefinition, PublicationDefinition } from "../publication";
import { physicalChannels, physicalChannelOwnership, type PhysicalChannel } from "./atlasChannels";
import type { FieldChannelName } from "@atlas/domain";
import { configuredMagicPublications } from "./atlasMagicPublications";

function enabled(features: ResolvedFeatures, owner: string | readonly string[]): boolean {
  return typeof owner === "string"
    ? (features.selection[owner]?.enabled ?? false)
    : owner.some((feature) => enabled(features, feature));
}
function ownership(binding: PhysicalChannel) {
  const registrations = physicalChannelOwnership.filter(([, , channels]) =>
    channels.includes(binding.name)
  );
  requireThat(
    registrations.length === 1,
    "publication_binding",
    `Declare one native product owner for ${binding.name}.`
  );
  return registrations[0];
}
export function selectedAtlasChannels(features: ResolvedFeatures): PhysicalChannel[] {
  return physicalChannels.filter((binding) => enabled(features, ownership(binding)[0]));
}

function layer(id: string): Layer {
  const result = builtinLayers().find((candidate) => candidate.id === id);
  requireThat(result, "publication_layer", `Declare layer ${id}.`);
  return {
    ...result,
    representations:
      id === "rivers"
        ? [...new Set([...(result.representations ?? []), "field" as const])]
        : result.representations,
  };
}
function field(
  channel: FieldChannelName,
  unit: string,
  layerId: string,
  publish = true,
  owners: readonly string[] = [],
  quantity: "intensive" | "extensive" | "category" = unit === "category" ? "category" : "intensive"
): FieldPublicationDefinition {
  return {
    kind: "field",
    channel,
    unit,
    quantity,
    layer: layer(layerId),
    publish,
    owners,
  };
}

function nativePublications(features: ResolvedFeatures): PublicationDefinition[] {
  return physicalChannels.map((binding) => {
    const [owner, target] = ownership(binding);
    return field(
      binding.name,
      binding.unit,
      target,
      enabled(features, owner),
      typeof owner === "string" ? [owner] : owner,
      binding.quantity
    );
  });
}
export const derived: readonly [
  channel: FieldChannelName,
  unit: string,
  layer: string,
  owners: string[],
][] = [
  ["EffectiveSeaLevel", "native-length", "rivers", ["physical.foundation"]],
  ["BaseSeaLevel", "native-length", "climate", ["physical.foundation"]],
  ["Precipitation", "millimetre/year", "climate", ["physical.climate"]],
  [
    "TotalErosion",
    "native-length",
    "geology",
    ["physical.river-incision", "physical.glacial-sculpting", "physical.coastal-evolution"],
  ],
  ["CarbonateFraction", "ratio", "geology", ["physical.foundation"]],
  ["PhysicalMaterial", "category", "geology", ["physical.landforms"]],
  ["SurfaceMaterial", "category", "geology", ["physical.foundation"]],
  ["NaturalTemperature", "native-temperature", "climate", ["physical.climate"]],
  ["NaturalRockResistance", "rock-strength", "geology", ["physical.foundation"]],
  ["naturalSurface", "category", "geology", ["physical.landforms", "magic.configured"]],
  ["finalSurface", "category", "geology", ["physical.landforms", "magic.configured"]],
  ["secondSurface", "category", "geology", ["physical.landforms", "magic.configured"]],
  ["Heat", "celsius", "magic", ["magic.local"]],
  ["StoredHeat", "celsius", "magic", ["magic.local"]],
  ["CoastalPressure", "ratio", "magic", ["magic.local"]],
];

function configuredMagic(input: AtlasGenerationInput, features: ResolvedFeatures) {
  return configuredMagicPublications(input, features, { field, enabled });
}

function locatedMagic(world: World | undefined, features: ResolvedFeatures) {
  const definitions: PublicationDefinition[] = [];
  for (const source of world?.magic ?? []) {
    if (source.systemId) continue;
    const thermal = ["heat", "cold"].includes(source.effect),
      publish = enabled(features, "magic.local");
    definitions.push(
      field(`magic:${source.id}`, thermal ? "celsius" : "ratio", "magic", publish, ["magic.local"])
    );
    if (thermal)
      for (const channel of ["forcing", "stored"])
        definitions.push(
          field(`magic:${source.id}:${channel}`, "celsius", "magic", publish, ["magic.local"])
        );
  }
  return definitions;
}

/** The biome families the ecology layer publishes, by the feature kind of their outlining rule. */
const biomeFeatureKinds = [
  "ember",
  "thaw",
  "rime",
  "glow",
  "fog",
  "deepwood",
  "wending",
  "well",
  "barrow",
  "pan",
  "flat",
  "wetland",
  "forest",
  "grassland",
  "barren",
];
/** The kinds the catalogue reads from the shape of the ground and water, on the geology layer. */
const landformKinds = [
  "peak",
  "range",
  "valley",
  "cirque",
  "fjord",
  "moraine",
  "waterfall",
  "gorge",
  "pass",
  "ridge",
  "escarpment",
  "plateau",
  "dome",
  "spring",
  "riverMouth",
  "headland",
  "bay",
  "strait",
  "placer",
  "saltPan",
  "killingGround",
];
function geographicPublications(
  features: ResolvedFeatures,
  input: AtlasGenerationInput
): PublicationDefinition[] {
  const groups: readonly [owner: string, target: string, kinds: string[], network?: boolean][] = [
    ["physical.impacts", "geology", ["crater"]],
    ["physical.volcanism", "geology", ["volcano", "caldera"]],
    ["physical.landmarks", "geology", ["landmark"]],
    ["physical.landmarks", "magic", ["landmark"]],
    ["physical.fractures", "faults", ["fault"]],
    ["water.routing", "lakes", ["lake"]],
    ["ocean.geography", "oceans", ["ocean"]],
    ["physical.landforms", "geology", landformKinds],
    ["physical.river-networks", "rivers", ["river"], true],
    ["ecology.living", "ecology", biomeFeatureKinds],
    ["human.cultures", "cultures", ["culturalOrigin"]],
    ["human.cultures", "institutions", ["institution"]],
    ["human.politics", "sovereignty", ["sovereignty", "politicalRegion"]],
    ["human.politics", "control", ["control"]],
    ["human.politics", "administration", ["jurisdiction"]],
    ["human.politics", "claims", ["claim"]],
    ["built.layout", "settlements", ["settlement"]],
    ["built.layout", "ruins", ["settlement"]],
    ["built.layout", "waterworks", ["dam", "irrigation", "mill", "weir"]],
    ["built.layout", "transportSites", ["pass", "harbor", "ford", "bridge"]],
    ["built.layout", "landUse", ["clearance", "hunting", "conservation", "burning", "mine"]],
    [
      "built.layout",
      "magicPractices",
      [
        "fire-forge",
        "aurora-archive",
        "pressure-diving",
        "shrine",
        "tapping",
        "quarrying",
        "hearthRing",
        "readIce",
        "heldShore",
        "boundWood",
        "swornGround",
        "vowedGround",
      ],
    ],
    ["built.layout", "historicalEvents", ["societyEvent"]],
    ["built.layout", "roads", ["road", "lane"], true],
    ["built.layout", "structures", ["building", "room", "door", "furniture", "wall"]],
  ];
  const result: PublicationDefinition[] = groups.map(([owner, target, featureKinds, network]) => ({
    kind: "geography",
    layer: layer(target),
    featureKinds,
    network,
    publish: enabled(features, owner),
    owners: [owner],
  }));
  result.push({
    kind: "geography",
    layer: layer("magic"),
    featureKinds: [
      ...(input.settings?.magicSystems ?? []).flatMap((system) =>
        system.features.map((rule) => `${system.id}:${rule.id}`)
      ),
      ...(input.settings?.confluences ?? []).map((confluence) => `confluence:${confluence.id}`),
    ],
    publish: enabled(features, "magic.configured"),
    owners: ["magic.configured"],
  });
  return result;
}

function identityPublications(world: World | undefined, features: ResolvedFeatures) {
  const targets: Record<string, string> = {
    culture: "cultures",
    language: "languages",
    religion: "religions",
  };
  return Object.values(world?.entities ?? {}).flatMap((entity) => {
    const target = targets[entity.kind];
    if (!target) return [];
    const channels = [`${entity.kind}:${entity.id}`];
    if (entity.kind === "language") channels.push(`languageUse:${entity.id}`);
    return channels.map((channel) =>
      field(fieldChannelName(channel), "ratio", target, enabled(features, "human.cultures"), [
        "human.cultures",
      ])
    );
  });
}
/** Atlas modules declare concrete output bindings; generic publication knows no channel names. */
export function atlasPublicationDefinitions(
  input: AtlasGenerationInput,
  world?: World,
  owners?: readonly string[]
): PublicationDefinition[] {
  const features =
    input.resolvedFeatures ??
    resolveGenerationFeatures(
      [...physicalFeatureDefinitions, ...domainFeatureDefinitions],
      input.features,
      input.parameters,
      input.domains
    );
  const publications = [
    ...nativePublications(features),
    ...derived.map(([channel, unit, target, owners]) =>
      field(
        channel,
        unit,
        target,
        owners.some((owner) => enabled(features, owner)),
        owners
      )
    ),
    ...configuredMagic(input, features),
    ...locatedMagic(world, features),
    ...geographicPublications(features, input),
    ...identityPublications(world, features),
  ];
  // Society can change existing environmental products without rerunning their geological history.
  const human = ["human.cultures", "human.politics", "built.layout"].some((id) =>
    enabled(features, id)
  );
  if (human && world) enableInheritedEnvironment(publications, world);
  return owners
    ? publications.filter((definition) =>
        definition.owners?.some((owner) => owners.includes(owner))
      )
    : publications;
}
function enableInheritedEnvironment(publications: PublicationDefinition[], world: World) {
  for (const definition of publications) {
    if (
      definition.kind === "field" &&
      world.fields.some((f) => f.channels?.includes(definition.channel))
    )
      definition.publish = true;
    if (
      definition.kind === "geography" &&
      ["rivers", "lakes", "ecology"].includes(definition.layer.id) &&
      world.fields.some(
        (f) =>
          f.layerId === definition.layer.id ||
          (definition.layer.id === "lakes" && f.layerId === "rivers")
      )
    )
      definition.publish = true;
  }
}
