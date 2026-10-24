import { createRNG, generateOne, type Culture } from "@atlas/name-forge";
import { spatial, type Position, type World } from "@atlas/domain";
import type { Geometry } from "geojson";
import { atlasNamingCultures, atlasNamingModels, type AtlasNamingKind } from "./namingCultures";

export const namingVersion = "atlas-nameforge-2";
export interface AtlasNameRequest {
  key: string;
  kind: AtlasNamingKind;
  subkind?: string;
  position: Pick<Position, "x" | "y">;
  culture?: string;
  language?: string | null;
  era?: string;
  term?: string;
}
/** Five seeded geographic naming traditions also work before society generation is enabled. */
export function geographicNamingCulture(world: World, p: Pick<Position, "x" | "y">): Culture {
  const [w, s, e, n] = spatial.bounds(world.reference.domain);
  // Vocabulary revisions do not move the five initial language regions.
  const rng = createRNG(`atlas-nameforge-1:${world.seed}:culture-origins`);
  const origins = atlasNamingCultures.map((culture) => ({
    culture,
    x: w + rng() * (e - w),
    y: s + rng() * (n - s),
  }));
  return origins.sort(
    (a, b) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(p.x - b.x, p.y - b.y)
  )[0].culture;
}
export function namingCulture(
  world: World,
  p: Pick<Position, "x" | "y">,
  cultureId?: string
): Culture {
  const entity = cultureId ? world.entities[cultureId] : null;
  const configured = atlasNamingCultures.find(
    (c) => c.id === (entity?.attributes.namingCulture ?? cultureId)
  );
  return configured ?? geographicNamingCulture(world, p);
}
export function atlasName(world: World, request: AtlasNameRequest) {
  const culture = namingCulture(world, request.position, request.language ?? request.culture);
  const name = generateOne(
    culture,
    {
      kind: request.kind,
      subtype: request.subkind,
      seed: JSON.stringify([
        namingVersion,
        world.seed,
        request.key,
        request.kind,
        request.subkind ?? null,
        culture.id,
        request.language ?? null,
      ]),
      context: { geographicTerm: request.term ?? request.subkind ?? request.kind },
    },
    { models: atlasNamingModels, markov: { minLength: 5, maxLength: 14 } }
  );
  return {
    name,
    namingCulture: culture.id,
    namingKind: request.kind,
    namingSubkind: request.subkind ?? null,
    namingVersion,
    namingLanguage: request.language ?? null,
    namedInEra: request.era ?? null,
  };
}
export function nameMetadata(named: ReturnType<typeof atlasName>) {
  const { namingCulture, namingKind, namingSubkind, namingVersion, namingLanguage, namedInEra } =
    named;
  return { namingCulture, namingKind, namingSubkind, namingVersion, namingLanguage, namedInEra };
}
const landformTerms: Record<string, string> = {
  peak: "Peak",
  cirque: "Cirque",
  fjord: "Fjord",
  moraine: "Moraine",
  waterfall: "Falls",
  range: "Range",
  valley: "Valley",
  gorge: "Gorge",
  crater: "Crater",
  volcano: "Volcano",
  caldera: "Caldera",
  fault: "Fault",
};
const biomeFamilies = new Set([
  "forest",
  "grassland",
  "wetland",
  "barren",
  "altered",
  "ember",
  "thaw",
  "rime",
  "glow",
  "fog",
]);

/** Adapt current GIS ecological family kinds to NameForge's biome kind + classified subkind. */
export function nameGeographicFeature(
  world: World,
  key: string,
  kind: string,
  geometry: Geometry,
  attributes: Record<string, unknown>,
  source: Pick<AtlasNameRequest, "language" | "era"> = {}
) {
  const [w, s, e, n] = spatial.bounds(geometry),
    position = { x: (w + e) / 2, y: (s + n) / 2 };
  if (biomeFamilies.has(kind) && typeof attributes.biome === "string")
    return atlasName(world, { key, kind: "biome", subkind: attributes.biome, position, ...source });
  if (landformTerms[kind])
    return atlasName(world, {
      key,
      kind: "landform",
      subkind: kind,
      term: landformTerms[kind],
      position,
      ...source,
    });
  if (["river", "lake", "ocean"].includes(kind))
    return atlasName(world, { key, kind: kind as "river" | "lake" | "ocean", position, ...source });
  if (typeof attributes.rule === "string" && typeof attributes.placeType === "string")
    return atlasName(world, {
      key,
      kind: "magic",
      subkind: attributes.rule,
      term: attributes.placeType,
      position,
      ...source,
    });
  return null;
}
