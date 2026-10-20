/** Weighted pool-adjacent-violators fit, with shared upstream/downstream interfaces. */
export function descendingGrade(
  values: number[],
  weights: number[],
  upstream = Infinity,
  downstream = -Infinity
) {
  const blocks: { first: number; last: number; sum: number; weight: number }[] = [];
  values.forEach((value, i) => {
    blocks.push({ first: i, last: i, sum: value * weights[i], weight: weights[i] });
    while (blocks.length > 1) {
      const b = blocks.at(-1)!,
        a = blocks.at(-2)!;
      if (a.sum / a.weight >= b.sum / b.weight) break;
      a.last = b.last;
      a.sum += b.sum;
      a.weight += b.weight;
      blocks.pop();
    }
  });
  const result = new Array<number>(values.length);
  for (const b of blocks) {
    const value = Math.max(downstream, Math.min(upstream, b.sum / b.weight));
    for (let i = b.first; i <= b.last; i++) result[i] = value;
  }
  return result;
}
