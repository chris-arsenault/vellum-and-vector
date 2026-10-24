import {
  communityPractices,
  isLivelihood,
  languageKnowledge,
  magicPracticeChannels,
  population,
  type PracticeShares,
  type SocietyPolity,
  type SocietyRegion,
} from "@atlas/domain";

/**
 * A polity's character is read at publication from the communities it holds: the practices
 * of their people weighted by population, and the languages a tenth or more of those people
 * know. It is a summary of what the polity is, derived after the fact; nothing reads it back
 * into behaviour, which follows the communities' own shares and languages.
 */
export interface PolityCharacter {
  practices: PracticeShares;
  /** Languages known by at least a tenth of the people held. */
  languages: number;
  communities: number;
  people: number;
}
export function polityCharacter(region: SocietyRegion, polity: SocietyPolity): PolityCharacter {
  const politics = region.politics;
  const held = region.communities.filter((c) =>
    politics
      ? (politics.control[c.id] ?? politics.sovereignty[c.id]) === polity.id
      : c.id === polity.seat
  );
  const groups = held.flatMap((c) => c.groups),
    people = held.reduce((sum, c) => sum + population(c), 0);
  const practices = Object.fromEntries(
    Object.entries(communityPractices(groups)).map(([id, share]) => [id, Number(share.toFixed(4))])
  );
  const languages = Object.values(languageKnowledge(groups)).filter((k) => k >= 0.1).length;
  return { practices, languages, communities: held.length, people };
}
/**
 * The word a polity's name ends in follows its character: a magic practice a third of its
 * people keep, else a livelihood half of them live by, else the breadth of its languages.
 */
const magicTerms: Record<(typeof magicPracticeChannels)[number], string> = {
  "fire-forge": "Hold",
  "aurora-archive": "Conclave",
  "pressure-diving": "Covenant",
};
const livelihoodTerms: Record<string, string> = {
  fishing: "League",
  farming: "Commonwealth",
  grazing: "Horde",
  gathering: "Confederacy",
};
export function polityTerm(character: PolityCharacter) {
  const { practices } = character;
  const magic = magicPracticeChannels
    .filter((id) => (practices[id] ?? 0) >= 1 / 3)
    .sort((a, b) => practices[b] - practices[a] || a.localeCompare(b))[0];
  if (magic) return magicTerms[magic];
  const livelihood = Object.entries(practices)
    .filter(([id, share]) => isLivelihood(id) && share >= 0.5)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0];
  if (livelihood) return livelihoodTerms[livelihood];
  return character.languages >= 3 ? "Concord" : "Commonwealth";
}
