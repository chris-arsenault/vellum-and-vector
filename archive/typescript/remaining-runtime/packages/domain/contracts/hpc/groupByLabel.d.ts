/** Members of every label as one CSR table: counting sort of a labels column.
 * Negative labels are unlabelled and omitted. Members keep ascending index order. */
export interface LabelGroups {
  offsets: Int32Array;
  members: Int32Array;
  readonly count: number;
  members_of(label: number): Int32Array;
}
export declare function groupByLabel(labels: ArrayLike<number>, labelCount: number): LabelGroups;
