type Interval = [number, number];
const cubic = (a: number, b: number, da: number, db: number) => [a, a + da / 3, b - db / 3, b];
const elevate = (v: number[]) => [
  v[0],
  ...[1, 2, 3].map((i) => v[i] + (i / 4) * (v[i - 1] - v[i])),
  v[3],
];

/** The producer converts its Hermite patch to a quartic tensor Bernstein basis. */
export function prepareBernsteinPatch(c: Float64Array, correction: number) {
  const rows = [
    cubic(c[0], c[4], c[1], c[5]),
    cubic(c[2], c[6], c[3], c[7]),
    cubic(c[8], c[12], c[9], c[13]),
    cubic(c[10], c[14], c[11], c[15]),
  ];
  const elevated = Array.from({ length: 5 }, () => new Array<number>(4));
  for (let x = 0; x < 4; x++) {
    const column = elevate(cubic(rows[0][x], rows[2][x], rows[1][x], rows[3][x]));
    column.forEach((v, y) => (elevated[y][x] = v));
  }
  const result = Float64Array.from(elevated.flatMap(elevate));
  result[12] += (correction * 256) / 36;
  return result;
}
function evaluate(values: number[], t: number) {
  for (let n = values.length - 1; n > 0; n--)
    for (let i = 0; i < n; i++) values[i] += (values[i + 1] - values[i]) * t;
  return values[0];
}
export function bernsteinPatchValue(c: Float64Array, u: number, v: number) {
  return quartic(
    quartic(c[0], c[1], c[2], c[3], c[4], u),
    quartic(c[5], c[6], c[7], c[8], c[9], u),
    quartic(c[10], c[11], c[12], c[13], c[14], u),
    quartic(c[15], c[16], c[17], c[18], c[19], u),
    quartic(c[20], c[21], c[22], c[23], c[24], u),
    v
  );
}
function quartic(a: number, b: number, c: number, d: number, e: number, t: number) {
  a += (b - a) * t;
  b += (c - b) * t;
  c += (d - c) * t;
  d += (e - d) * t;
  a += (b - a) * t;
  b += (c - b) * t;
  c += (d - c) * t;
  a += (b - a) * t;
  b += (c - b) * t;
  return a + (b - a) * t;
}
function split(values: number[], t: number) {
  const left = [values[0]],
    right = [values.at(-1)!];
  for (let n = values.length - 1; n > 0; n--) {
    for (let i = 0; i < n; i++) values[i] += (values[i + 1] - values[i]) * t;
    left.push(values[0]);
    right.unshift(values[n - 1]);
  }
  return { left, right };
}
function restrict(values: number[], low: number, high: number): number[] {
  if (low > high) return restrict(values, high, low).reverse();
  if (low === high) return new Array<number>(values.length).fill(evaluate(values, low));
  const left = high === 1 ? values : split(values, high).left;
  return low === 0 ? left : split(left, low / high).right;
}
/** Restrict the tensor patch to a directed line. The diagonal of a degree 4x4
 * Bernstein patch is a degree-eight curve; no fitting or power-basis conversion. */
export function bernsteinPatchSegment(c: Float64Array, a: Interval, b: Interval) {
  const rows = Array.from({ length: 5 }, (_, y) =>
    restrict(Array.from(c.subarray(y * 5, y * 5 + 5)), a[0], b[0])
  );
  const columns = Array.from({ length: 5 }, (_, x) =>
    restrict(
      rows.map((row) => row[x]),
      a[1],
      b[1]
    )
  );
  const choose4 = [1, 4, 6, 4, 1],
    choose8 = [1, 8, 28, 56, 70, 56, 28, 8, 1];
  const controls = new Array<number>(9).fill(0);
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++)
      controls[i + j] += (columns[i][j] * choose4[i] * choose4[j]) / choose8[i + j];
  const slopes = controls.slice(1).map((v, i) => 8 * (v - controls[i]));
  return {
    range: [Math.min(...controls), Math.max(...controls)] as Interval,
    derivative: [Math.min(...slopes), Math.max(...slopes)] as Interval,
  };
}
export function bernsteinPatchInterval(
  c: Float64Array,
  box: [number, number, number, number],
  derivative?: 0 | 1
): Interval {
  let width = 5,
    height = 5;
  let rows = Array.from({ length: height }, (_, y) =>
    Array.from(c.subarray(y * width, (y + 1) * width))
  );
  if (derivative === 0) {
    rows = rows.map((row) => row.slice(1).map((v, i) => 4 * (v - row[i])));
    width--;
  }
  if (derivative === 1) {
    rows = rows.slice(1).map((row, y) => row.map((v, x) => 4 * (v - rows[y][x])));
    height--;
  }
  rows = rows.map((row) => restrict(row, box[0], box[2]));
  const controls: number[] = [];
  for (let x = 0; x < width; x++)
    controls.push(
      ...restrict(
        rows.map((row) => row[x]),
        box[1],
        box[3]
      )
    );
  return [Math.min(...controls), Math.max(...controls)];
}
