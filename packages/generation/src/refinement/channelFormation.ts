import { spacing, type RefinementState } from "./state";

/** Cross-slope concavity must exceed unresolved ground roughness, in metres per metre. */
const convergenceGradient = 0.001;

/** Sheet runoff becomes a channel where terrain gathers it; that course continues downhill. */
export function concentratedDrainage(state: RefinementState) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    gathered = g.coverage.scratch("uint8", "regional:concentrated-runoff", g.active.length),
    [dx, dy] = spacing(g),
    tolerance = Math.max(1, Math.min(dx, dy) * convergenceGradient);
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j < 0) continue;
    const reach = Math.max(2, Math.round(state.parentSpan / (4 * Math.max(dx, dy))));
    if (crossSlopeConcavity(state, i, j, reach) > tolerance) gathered.set(i, 1);
    if (gathered.get(i)) gathered.set(j, 1);
  }
  return gathered;
}

function crossSlopeConcavity(state: RefinementState, i: number, j: number, reach: number) {
  const g = state.surface,
    x = i % g.width,
    y = Math.floor(i / g.width),
    alongX = ((j % g.width) - x) * reach,
    alongY = (Math.floor(j / g.width) - y) * reach,
    leftX = x - alongY,
    rightX = x + alongY,
    leftY = y + alongX,
    rightY = y - alongX;
  if (
    Math.min(leftX, rightX, leftY, rightY) < 0 ||
    Math.max(leftX, rightX) >= g.width ||
    Math.max(leftY, rightY) >= g.height
  )
    return 0;
  const h = g.channels.elevation;
  return (h.get(leftY * g.width + leftX) + h.get(rightY * g.width + rightX)) / 2 - h.get(i);
}
