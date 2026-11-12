/**
 * Joining a map's reaches into its rivers. Drainage is cut at every confluence, so one river is
 * many reaches; a map draws a river once, as the reaches it holds inside the frame.
 */

/** What joining reads of one reach. */
export interface ReachOnMap {
  /** The reach this one runs into, by index, or null where it ends. */
  readonly downstream: number | null;
  /** Whether this map draws the reach: a finer map draws those that start inside its frame. */
  readonly inFrame: boolean;
  /** The river of the mapped course the reach lies on, or null where its course is no river. */
  readonly course: string | null;
  /** The rivers holding its cells, head to end, without the cell it ends on. */
  readonly held: readonly string[];
}
/** One river as the map draws it. */
export interface JoinedRiver {
  readonly riverId: string;
  /** Its reaches by index, head to end: one part, or one for each stretch where it leaves the frame. */
  readonly parts: readonly (readonly number[])[];
}

/**
 * The river a reach draws. A parent's river holds the water it runs through, so it takes the
 * reach from the first cell it holds; otherwise the reach is its own course's. A confluence cell
 * is held by whichever river reaches it first, which says nothing of the reach leaving it, so
 * another course's hold is not read.
 */
function riverOf(reach: ReachOnMap, continuing: ReadonlySet<string>) {
  if (!reach.inFrame) return null;
  return reach.held.find((id) => id === reach.course || continuing.has(id)) ?? reach.course;
}
/** How many reaches lie between a reach and the end of its water. */
function reachesBelow(reaches: readonly ReachOnMap[], from: number) {
  let count = 0;
  for (
    let i = reaches[from].downstream;
    i !== null && i !== from && count < reaches.length;
    i = reaches[i]?.downstream ?? null
  )
    count++;
  return count;
}
/** One river's reaches as unbroken stretches, the highest upstream first. */
function partsOf(
  reaches: readonly ReachOnMap[],
  rivers: readonly (string | null)[],
  members: readonly number[]
) {
  const riverId = rivers[members[0]],
    next = (i: number) => {
      const j = reaches[i].downstream;
      return j !== null && j !== i && rivers[j] === riverId ? j : null;
    },
    fed = new Set(members.map(next)),
    taken = new Set<number>();
  return members
    .filter((i) => !fed.has(i))
    .map((head) => {
      const part: number[] = [];
      for (let i: number | null = head; i !== null && !taken.has(i); i = next(i)) {
        taken.add(i);
        part.push(i);
      }
      return part;
    })
    .sort((a, b) => reachesBelow(reaches, b[0]) - reachesBelow(reaches, a[0]) || a[0] - b[0]);
}
/**
 * The rivers a map draws, each once: every reach of one river inside the frame, joined. A
 * tributary that is a river of its own stays its own. `continuing` names the parents' rivers.
 */
export function joinReaches(
  reaches: readonly ReachOnMap[],
  continuing: ReadonlySet<string> = new Set()
): JoinedRiver[] {
  const rivers = reaches.map((reach) => riverOf(reach, continuing)),
    joined = new Map<string, number[]>();
  rivers.forEach((id, i) => {
    if (id === null) return;
    const members = joined.get(id);
    if (members) members.push(i);
    else joined.set(id, [i]);
  });
  return [...joined].map(([riverId, members]) => ({
    riverId,
    parts: partsOf(reaches, rivers, members),
  }));
}
