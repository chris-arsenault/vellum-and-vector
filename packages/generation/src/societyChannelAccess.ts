import { gridPosition, type Band } from "@atlas/domain";
import type { GenerationState } from "./process";
import { nativePosition } from "./canonry/atlasWorkspace";

type ChannelPoint = readonly [number, number, number];
/** The live mesh also serves rounds before geographic extraction has run. */
function* channelPoints(state: GenerationState): Iterable<ChannelPoint> {
  const work = state.physical;
  if (work && (state.society?.cycle || !state.domain.world.drainage?.[state.domain.scope.areaId])) {
    yield* liveChannels(work);
  } else {
    yield* retainedChannels(state);
  }
}
function* liveChannels(work: NonNullable<GenerationState["physical"]>): Iterable<ChannelPoint> {
  for (let i = 0; i < work.map.mesh.count; i++) {
    if (work.map.RiverOrders.get(i) <= 0) continue;
    const p = nativePosition(work, i);
    yield [p.x, p.y, work.map.FlowAccumulation.get(i)];
  }
}
function* retainedChannels(state: GenerationState): Iterable<ChannelPoint> {
  for (const network of Object.values(state.domain.world.drainage ?? {})) {
    if (network.spaceId !== state.surface.scope.spaceId) continue;
    for (const reach of network.reaches)
      for (const [j, p] of reach.coordinates.entries())
        yield [p[0], p[1], reach.discharges[j] ?? 0];
  }
}
function channelBounds(state: GenerationState, size: number) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    count = 0;
  for (const [x, y] of channelPoints(state)) {
    x0 = Math.min(x0, Math.floor(x / size));
    y0 = Math.min(y0, Math.floor(y / size));
    x1 = Math.max(x1, Math.floor(x / size));
    y1 = Math.max(y1, Math.floor(y / size));
    count++;
  }
  return { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1, count };
}
/** Packed bucket links replace one object, tuple and Map entry per channel sample. */
class ChannelIndex {
  private columns: Band[];
  private heads: Band;
  constructor(
    private state: GenerationState,
    private size: number,
    private bounds: ReturnType<typeof channelBounds>
  ) {
    const allocate = (type: "float64" | "int32", length: number, name: string) =>
      state.surface.coverage.scratch(type, `society-channels:${name}`, length);
    this.heads = allocate("int32", bounds.width * bounds.height, "heads").fill(-1);
    this.columns = [
      allocate("int32", bounds.count, "next"),
      ...["x", "y", "flow"].map((name) => allocate("float64", bounds.count, name)),
    ];
    let at = 0;
    const [next, xs, ys, flows] = this.columns;
    for (const [x, y, flow] of channelPoints(state)) {
      const bucket = this.bucket(Math.floor(x / size), Math.floor(y / size));
      next.set(at, this.heads.get(bucket));
      this.heads.set(bucket, at);
      xs.set(at, x);
      ys.set(at, y);
      flows.set(at++, flow);
    }
  }
  private bucket(x: number, y: number) {
    const { x0, y0, width, height } = this.bounds;
    return x < x0 || y < y0 || x >= x0 + width || y >= y0 + height ? -1 : (y - y0) * width + x - x0;
  }
  access(x: number, y: number) {
    const [next, xs, ys, flows] = this.columns,
      column = Math.floor(x / this.size),
      row = Math.floor(y / this.size);
    let access = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.bucket(column + dx, row + dy);
        if (bucket < 0) continue;
        for (let i = this.heads.get(bucket); i >= 0; i = next.get(i))
          access = Math.max(
            access,
            Math.exp(-Math.hypot(xs.get(i) - x, ys.get(i) - y) / this.size) *
              (1 - Math.exp(-Math.max(0, flows.get(i))))
          );
      }
    return access;
  }
  close() {
    this.state.surface.coverage.releaseUnused([this.heads, ...this.columns], []);
  }
}
/** Sample every retained channel, including reaches omitted from visible cartography. */
export function channelAccess(state: GenerationState) {
  const grid = state.surface,
    result = grid.coverage.scratch("float64", "society-river-access", grid.active.length),
    size = Math.max(1000, grid.scope.resolution ?? 1000),
    bounds = channelBounds(state, size);
  result.retain();
  if (!bounds.count) return result;
  const channels = new ChannelIndex(state, size, bounds);
  try {
    for (let i = 0; i < result.length; i++) {
      const p = gridPosition(grid, i);
      result.set(i, channels.access(p.x, p.y));
    }
    return result;
  } finally {
    channels.close();
  }
}
