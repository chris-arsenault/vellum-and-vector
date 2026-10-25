import {
  confluenceEffective,
  systemStockKeys,
  type MagicConfluence,
  type MagicSystem,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { ResolvedFeatures } from "../features";
import type { FieldPublicationDefinition, PublicationDefinition } from "../publication";
import { independentInteraction } from "./magicFeatures";
import {
  magicFieldDefinitions,
  publishedMagicChannels,
  type MagicChannel,
} from "./magicFieldDefinitions";

/** The publication helpers the atlas module lends out, so these definitions match its own. */
export interface PublicationTools {
  field(
    channel: string,
    unit: string,
    layerId: string,
    publish?: boolean,
    owners?: readonly string[]
  ): FieldPublicationDefinition;
  enabled(features: ResolvedFeatures, owner: string): boolean;
}
const owners = ["magic.configured"];

/**
 * Every channel the configured magic systems publish: each system's fields, coverage, stocks
 * and classes, the strain between systems, and each meeting's members and coverage.
 */
export function configuredMagicPublications(
  input: AtlasGenerationInput,
  features: ResolvedFeatures,
  tools: PublicationTools
): PublicationDefinition[] {
  const configured = tools.enabled(features, "magic.configured"),
    systems = input.settings?.magicSystems ?? [];
  return [
    ...systems.flatMap((system) => systemPublications(system, configured, tools)),
    tools.field("magic:strain", "ratio", "magic", configured, owners),
    ...(input.settings?.confluences ?? []).flatMap((confluence) =>
      confluencePublications(
        confluence,
        configured && confluenceEffective(confluence, systems),
        tools
      )
    ),
  ];
}
function configuredChannel(
  system: string,
  channel: MagicChannel,
  publish: boolean,
  tools: PublicationTools
) {
  const metadata = magicFieldDefinitions[channel];
  const definition = tools.field(
    `magic:${system}:${channel}`,
    metadata.unit,
    "magic",
    publish,
    owners
  );
  definition.quantity = metadata.quantity;
  return definition;
}
function systemPublications(
  system: MagicSystem,
  configured: boolean,
  tools: PublicationTools
): PublicationDefinition[] {
  const publish = configured && system.enabled;
  return [
    ...publishedMagicChannels.map((channel) =>
      configuredChannel(system.id, channel, publish, tools)
    ),
    tools.field(`magic:${system.id}:coverage`, "ratio", "magic", publish, owners),
    ...[...systemStockKeys(system)].map((key) => {
      const stock = tools.field(
        `magic:${system.id}:stock:${key}`,
        "intensity-square-metre",
        "magic",
        publish,
        owners
      );
      stock.quantity = "extensive";
      return stock;
    }),
    ...system.features.flatMap((rule) => {
      const active = configured && (system.enabled || independentInteraction(rule, system.id));
      return [
        tools.field(`magic:${system.id}:feature:${rule.id}`, "category", "magic", active, owners),
        tools.field(`magic:${system.id}:coverage:${rule.id}`, "ratio", "magic", active, owners),
      ];
    }),
  ];
}
function confluencePublications(
  confluence: MagicConfluence,
  active: boolean,
  tools: PublicationTools
) {
  return [
    tools.field(`magic:confluence:${confluence.id}:members`, "category", "magic", active, owners),
    tools.field(`magic:confluence:${confluence.id}:coverage`, "ratio", "magic", active, owners),
  ];
}
