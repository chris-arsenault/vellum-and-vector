import {
  communityPractices,
  languageKnowledge,
  population,
  type PopulationGroup,
  type World,
} from "@atlas/domain";
import { shareSegments, type Segment } from "./surfaceData";
import { entityName, practiceLabel } from "./settlementSurfaceData";

/**
 * A community's composition read across its population groups. The groups partition the
 * residents by people, culture and the exact set of traditions held, which is the right
 * unit for the model and the wrong unit for a reader: a capital drawn from a whole realm
 * holds dozens of groups, most of them under a percent. These helpers aggregate each
 * dimension over the groups, weighted by head count, and fold the group list itself.
 */

/** Residents by culture, heaviest first; a group without a culture counts under its people. */
export function cultureSegments(world: World, groups: PopulationGroup[]): Segment[] {
  const counts: Record<string, number> = {};
  for (const group of groups) {
    const id = group.culture ?? group.people;
    counts[id] = (counts[id] ?? 0) + group.count;
  }
  return shareSegments(counts, (id) => entityName(world, id));
}

/** The share of residents holding each tradition; a person may hold several, so shares overlap. */
export function traditionShares(world: World, groups: PopulationGroup[]): Segment[] {
  const total = population({ groups });
  if (total <= 0) return [];
  const counts: Record<string, number> = {};
  for (const group of groups)
    for (const id of group.religions) counts[id] = (counts[id] ?? 0) + group.count / total;
  return shareSegments(counts, (id) => entityName(world, id));
}

/** The share of residents who know each language; overlapping like traditions. */
export function knowledgeSegments(world: World, groups: PopulationGroup[]): Segment[] {
  return shareSegments(languageKnowledge(groups), (id) => entityName(world, id));
}

/** The residents' livelihoods and crafts, each group's shares weighted by its people. */
export function residentPracticeSegments(groups: PopulationGroup[]): Segment[] {
  return shareSegments(communityPractices(groups), practiceLabel);
}

/** One group as a table row: its position in the record, what it is, and its weight. */
export interface GroupRow {
  index: number;
  culture: string;
  traditions: string[];
  count: number;
  share: number;
}
/** The groups as rows, heaviest first, with their share of all residents. */
export function groupRows(world: World, groups: PopulationGroup[]): GroupRow[] {
  const total = Math.max(1, population({ groups }));
  return groups
    .map((group, index) => ({
      index,
      culture: group.culture ? entityName(world, group.culture) : group.people,
      traditions: group.religions.map((id) => entityName(world, id)),
      count: group.count,
      share: group.count / total,
    }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
}
/** Default share below which a group folds into the remainder row. */
export const minorGroupShare = 0.01;
/**
 * Split rows into those shown and those folded into one remainder. Rows under `minShare`
 * fold; a single such row stays shown, since one row folded into one row saves nothing.
 */
export function foldGroupRows(rows: GroupRow[], minShare = minorGroupShare) {
  const folded = rows.filter((row) => row.share < minShare);
  if (folded.length < 2) return { shown: rows, folded: [] as GroupRow[] };
  return { shown: rows.filter((row) => row.share >= minShare), folded };
}
