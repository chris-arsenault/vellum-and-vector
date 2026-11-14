/** Members of every label as one CSR table: counting sort of a labels column.
 * Negative labels are unlabelled and omitted. Members keep ascending index order. */
export interface LabelGroups {
  offsets: Int32Array;
  members: Int32Array;
  readonly count: number;
  members_of(label: number): Int32Array;
}
export function groupByLabel(labels: ArrayLike<number>, labelCount: number): LabelGroups {
  const offsets = new Int32Array(labelCount + 1);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) offsets[labels[i] + 1]++;
  for (let g = 0; g < labelCount; g++) offsets[g + 1] += offsets[g];
  const members = new Int32Array(offsets[labelCount]),
    cursor = offsets.slice(0, labelCount);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label >= 0) members[cursor[label]++] = i;
  }
  return {
    offsets,
    members,
    count: labelCount,
    members_of(label) {
      return members.subarray(offsets[label], offsets[label + 1]);
    },
  };
}
