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
}
/** One river as the map draws it. */
export interface JoinedRiver {
  readonly riverId: string;
  /** Its reaches by index, head to end: one part, or one for each stretch where it leaves the frame. */
  readonly parts: readonly (readonly number[])[];
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
 * tributary that is a river of its own stays its own. Membership belongs to the water owner.
 */
export function joinReaches(reaches: readonly ReachOnMap[]): JoinedRiver[] {
  const rivers = reaches.map((reach) => (reach.inFrame ? reach.course : null)),
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
