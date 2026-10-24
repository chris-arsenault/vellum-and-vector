import { builtinLayers, requireThat, type Layer, type World } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { resolveGenerationFeatures, type ResolvedFeatures } from "../features";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { domainFeatureDefinitions } from "../domainFeatures";
import type { FieldPublicationDefinition, PublicationDefinition } from "../publication";
import { atlasChannels, type ChannelBinding } from "./atlasChannels";
import { ecologyBindings } from "./ecologyState";
import { independentInteraction } from "./magicFeatures";
import {
  magicFieldDefinitions,
  publishedMagicChannels,
  type MagicChannel,
} from "./magicFieldDefinitions";

type Ownership = readonly [
  owner: string | readonly string[],
  layer: string,
  channels: readonly string[],
];
const nativeOwnership: Ownership[] = [
  ["physical.foundation", "elevation", ["elevation"]],
  [
    "physical.foundation",
    "geology",
    [
      "bedrock",
      "sediment",
      "rock",
      "continentalFraction",
      "province",
      "assembly",
      "suturePair",
      "sutureStrength",
      "margin",
      "crustAge",
    ],
  ],
  ["material.load-response", "geology", ["crustThickness", "crustSupport", "rockLoad"]],
  [
    "physical.tectonic-history",
    "geology",
    [
      "tectonicStrain",
      "crustMotionX",
      "crustMotionY",
      "tectonicBoundary",
      "boundaryPair",
      "tectonicHistory",
    ],
  ],
  [["physical.fractures", "physical.impacts", "physical.volcanism"], "geology", ["fracture"]],
  ["physical.geothermal", "geology", ["geothermal", "geothermalHistory"]],
  ["physical.impacts", "geology", ["impactExcavation", "impactRim", "impactEjecta"]],
  ["physical.volcanism", "geology", ["volcanicConstruction", "volcanicLastActiveEpoch"]],
  ["physical.river-incision", "geology", ["fluvialErosion"]],
  [
    [
      "material.fluvial-transport",
      "physical.glacial-sculpting",
      "physical.coastal-evolution",
      "physical.hillslopes",
    ],
    "geology",
    ["deposition"],
  ],
  ["physical.glacial-sculpting", "geology", ["glacialErosion", "glacialDeposition"]],
  ["physical.coastal-evolution", "geology", ["coastalErosion", "coastalForcingHistory"]],
  ["physical.landforms", "geology", ["landform", "slope", "physicalFeatures"]],
  [
    "physical.climate",
    "climate",
    ["temperature", "moisture", "windEast", "windNorth", "windSpeed", "rainfall", "snowfall"],
  ],
  ["water.routing", "rivers", ["runoff", "waterBody", "basin", "catchmentArea"]],
  ["ocean.geography", "rivers", ["water", "waterDepth", "oceanDistance"]],
  ["ocean.geography", "geology", ["bathymetry"]],
  [
    "physical.ocean-circulation",
    "rivers",
    ["oceanCurrent", "waveExposure", "seaSurfaceAnomaly", "upwelling"],
  ],
  [
    "physical.land-ice",
    "climate",
    [
      "ice",
      "maximumIce",
      "iceThickness",
      "maximumIceThickness",
      "maximumIceFlux",
      "maximumGroundedIceFlux",
      "groundedIce",
    ],
  ],
  ["physical.river-networks", "rivers", ["riverOrder", "riverChannel", "riverWidth", "riverDepth"]],
  ["physical.floodplains", "rivers", ["floodplain"]],
  ["physical.deltas", "rivers", ["delta"]],
  ["ecology.living", "ecology", ecologyBindings.map(([name]) => name)],
];

function enabled(features: ResolvedFeatures, owner: string | readonly string[]): boolean {
  return typeof owner === "string"
    ? (features.selection[owner]?.enabled ?? false)
    : owner.some((feature) => enabled(features, feature));
}
function ownership(binding: ChannelBinding) {
  const registrations = nativeOwnership.filter(([, , channels]) => channels.includes(binding.name));
  requireThat(
    registrations.length === 1,
    "publication_binding",
    `Declare one native product owner for ${binding.name}.`
  );
  return registrations[0];
}
export function selectedAtlasChannels(features: ResolvedFeatures): ChannelBinding[] {
  return atlasChannels.filter((binding) => enabled(features, ownership(binding)[0]));
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
  channel: string,
  unit: string,
  layerId: string,
  publish = true,
  owners: readonly string[] = []
): FieldPublicationDefinition {
  return {
    kind: "field",
    channel,
    unit,
    quantity: unit === "category" || channel === "waterLevel" ? "category" : "intensive",
    layer: layer(layerId),
    publish,
    owners,
  };
}

function nativePublications(features: ResolvedFeatures): PublicationDefinition[] {
  return atlasChannels.map((binding) => {
    const [owner, target] = ownership(binding);
    return field(
      binding.name,
      binding.unit,
      target,
      enabled(features, owner),
      typeof owner === "string" ? [owner] : owner
    );
  });
}
const derived: readonly [channel: string, unit: string, layer: string, owners: string[]][] = [
  ["flow", "cubic-metre/second", "rivers", ["water.routing"]],
  ["drainageElevation", "metre", "rivers", ["water.routing"]],
  ["waterLevel", "metre", "rivers", ["ocean.geography"]],
  ["seaLevel", "metre", "rivers", ["ocean.geography"]],
  ["seaDatum", "metre", "climate", ["ocean.geography"]],
  ["precipitation", "metre/year", "climate", ["physical.climate"]],
  [
    "erosion",
    "metre",
    "geology",
    ["physical.river-incision", "physical.glacial-sculpting", "physical.coastal-evolution"],
  ],
  ["carbonate", "ratio", "geology", ["physical.foundation"]],
  ["physicalMaterial", "category", "geology", ["physical.landforms"]],
  ["naturalTemperature", "celsius", "climate", ["physical.climate"]],
  ["naturalRock", "ratio", "geology", ["physical.foundation"]],
  ["naturalSurface", "category", "geology", ["physical.landforms", "magic.configured"]],
  ["finalSurface", "category", "geology", ["physical.landforms", "magic.configured"]],
  ["quickening", "ratio", "magic", ["magic.configured"]],
  ["stillness", "ratio", "magic", ["magic.configured"]],
  ["fog", "ratio", "magic", ["magic.configured"]],
  ["icePersistence", "ratio", "magic", ["magic.configured"]],
  ["heat", "celsius", "magic", ["magic.local"]],
  ["storedHeat", "celsius", "magic", ["magic.local"]],
  ["coastalPressure", "ratio", "magic", ["magic.local"]],
];

function configuredChannel(system: string, channel: MagicChannel, publish: boolean) {
  const metadata = magicFieldDefinitions[channel];
  const definition = field(`magic:${system}:${channel}`, metadata.unit, "magic", publish, [
    "magic.configured",
  ]);
  definition.quantity = metadata.quantity;
  return definition;
}

function configuredMagic(input: AtlasGenerationInput, features: ResolvedFeatures) {
  const definitions: PublicationDefinition[] = [];
  for (const system of input.settings?.magicSystems ?? []) {
    const publish = enabled(features, "magic.configured") && system.enabled;
    for (const channel of publishedMagicChannels) {
      definitions.push(configuredChannel(system.id, channel, publish));
    }
    for (const rule of system.features)
      definitions.push(
        field(
          `magic:${system.id}:feature:${rule.id}`,
          "category",
          "magic",
          enabled(features, "magic.configured") &&
            (system.enabled || independentInteraction(rule, system.id)),
          ["magic.configured"]
        )
      );
  }
  return definitions;
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

function geographicPublications(
  features: ResolvedFeatures,
  input: AtlasGenerationInput
): PublicationDefinition[] {
  const groups: readonly [owner: string, target: string, kinds: string[], network?: boolean][] = [
    ["physical.impacts", "geology", ["crater"]],
    ["physical.volcanism", "geology", ["volcano", "caldera"]],
    ["physical.fractures", "faults", ["fault"]],
    ["water.routing", "lakes", ["lake"]],
    ["ocean.geography", "oceans", ["ocean"]],
    [
      "physical.landforms",
      "geology",
      ["peak", "range", "valley", "cirque", "fjord", "moraine", "waterfall", "gorge"],
    ],
    ["physical.river-networks", "rivers", ["river"], true],
    [
      "ecology.living",
      "ecology",
      [
        "altered",
        "ember",
        "thaw",
        "rime",
        "glow",
        "fog",
        "wetland",
        "forest",
        "grassland",
        "barren",
      ],
    ],
    ["human.cultures", "cultures", ["culturalOrigin"]],
    ["human.cultures", "institutions", ["institution"]],
    ["human.politics", "sovereignty", ["sovereignty"]],
    ["human.politics", "control", ["control"]],
    ["human.politics", "administration", ["jurisdiction"]],
    ["human.politics", "claims", ["claim"]],
    ["built.layout", "settlements", ["settlement"]],
    ["built.layout", "ruins", ["settlement"]],
    ["built.layout", "waterworks", ["dam", "irrigation"]],
    ["built.layout", "transportSites", ["pass", "harbor"]],
    ["built.layout", "landUse", ["clearance", "hunting", "conservation"]],
    ["built.layout", "magicPractices", ["fire-forge", "aurora-archive", "pressure-diving"]],
    ["built.layout", "historicalEvents", ["societyEvent"]],
    ["built.layout", "roads", ["road"], true],
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
    featureKinds: (input.settings?.magicSystems ?? []).flatMap((system) =>
      system.features.map((rule) => `${system.id}:${rule.id}`)
    ),
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
      field(channel, "ratio", target, enabled(features, "human.cultures"), ["human.cultures"])
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
      input.processes,
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
