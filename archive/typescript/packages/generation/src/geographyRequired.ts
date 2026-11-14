import { requireThat, type DomainSnapshot } from "@atlas/domain";

/**
 * Land, climate and water generate on every map: a world's geology always runs, and a child
 * map refines the terrain it inherits. Only a building interior has no terrain to generate.
 * This is the one place that reads whether the physical domain was requested.
 */
export function requireGeography(
  source: DomainSnapshot,
  input: { areaId: string; domains: readonly string[] }
) {
  requireThat(
    input.domains.includes("physical") || source.world.areas[input.areaId]?.profile === "interior",
    "generation_domains",
    "Land, climate and water always generate; magic and people are the selectable domains."
  );
}
