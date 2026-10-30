import {
  fieldContour,
  regularContourSupport,
  fieldInterpolator,
  gridPosition,
  magicSurfaceCode,
  point,
  spatial,
  surfaceRuleSources,
  confluenceEffective,
  someSample,
  placeMinimumCells,
  type MagicFeatureRule,
  type Band,
} from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { putRefinementFeature } from "./features";
import {
  channel,
  regionalComponents,
  resolvesRegionalComponent,
  type RefinementState,
} from "./state";
import { magicShare } from "./magicConditions";
import { meetingShare } from "./meetings";

export function classifyRegionalMagic(state: RefinementState) {
  if (!state.input.domains.includes("magic")) return;
  const g = state.surface,
    systems = state.domain.world.magicSystems ?? [],
    meetings = state.domain.world.confluences ?? [],
    sources = surfaceRuleSources(systems, meetings),
    priority = g.coverage
      .scratch("float64", "regional:class-priority", g.active.length)
      .fill(-Infinity),
    held = g.coverage.scratch("float64", "regional:class-share", g.active.length),
    second = channel(state, "secondSurface", "category", -1);
  second.fill(-1);
  for (const system of systems)
    if (system.enabled)
      for (const rule of system.features) {
        const code = magicSurfaceCode(sources, system.id, rule.id)!;
        classifyRule(state, system.id, rule, code, priority, held);
      }
  const enabledMeetings = meetings.filter((m) => confluenceEffective(m, systems));
  for (const meeting of enabledMeetings) {
    const share = g.coverage.scratch("float64", `regional:meeting:${meeting.id}`, g.active.length);
    for (let i = 0; i < share.length; i++) {
      const coverage = meetingShare(state, meeting, i);
      share.set(i, coverage);
      paint(
        state,
        i,
        magicSurfaceCode(sources, "confluence", meeting.id)!,
        meeting.priority,
        coverage,
        priority,
        held
      );
    }
    publishClass(
      state,
      `confluence:${meeting.id}`,
      meeting.name,
      meeting.cartography ?? "area",
      share
    );
    g.coverage.release(share);
  }
  g.coverage.release(priority);
  g.coverage.release(held);
}
function classifyRule(
  state: RefinementState,
  owner: string,
  rule: MagicFeatureRule,
  code: number,
  priority: Band,
  held: Band
) {
  const g = state.surface,
    share = g.coverage.scratch("float64", `regional:class:${owner}:${rule.id}`, g.active.length);
  for (let i = 0; i < share.length; i++) {
    const value = magicShare(state, owner, rule, i);
    share.set(i, value);
    paint(state, i, code, rule.priority, value, priority, held);
  }
  publishClass(state, `${owner}:${rule.id}`, rule.name, rule.cartography ?? "area", share);
  g.coverage.release(share);
}
function paint(
  state: RefinementState,
  i: number,
  code: number,
  rank: number,
  share: number,
  priority: Band,
  held: Band
) {
  if (!share) return;
  const c = state.surface.channels;
  if (share > held.get(i) || (share === held.get(i) && rank > priority.get(i))) {
    if (held.get(i) > 0.2) c.secondSurface.set(i, c.finalSurface.get(i));
    c.finalSurface.set(i, code);
    held.set(i, share);
    priority.set(i, rank);
  } else if (share > 0.2) c.secondSurface.set(i, code);
}
function publishClass(
  state: RefinementState,
  key: string,
  label: string,
  cartography: NonNullable<MagicFeatureRule["cartography"]>,
  share: Band
) {
  if (!someSample(share, (v) => v > 0.5)) return;
  const g = state.surface;
  if (cartography === "site") {
    publishSites(state, key, label, share);
    return;
  }
  const eligible = g.coverage.scratch("float64", "regional:place-coverage", share.length);
  regionalComponents(
    g,
    (i) => share.get(i) > 0.5,
    (members) => {
      if (members.length < placeMinimumCells[cartography]) return;
      if (cartography === "area" && !resolvesRegionalComponent(g, members)) return;
      for (const i of members) eligible.set(i, share.get(i));
    }
  );
  const at = fieldInterpolator(
      {
        ...g,
        channels: { ...g.channels, regionalClass: eligible },
        units: { ...g.units, regionalClass: "ratio" },
      },
      "regionalClass"
    ),
    shape = fieldContour(
      g,
      (x, y) => at({ x, y, z: 0 }),
      regularContourSupport(g, (i) => eligible.get(i) > 0.5),
      0.5,
      (g.scope.resolution ?? 1000) / 4,
      state.contours
    );
  g.coverage.release(eligible);
  if (shape)
    putRefinementFeature(
      state,
      `magic:${key}`,
      key,
      "magic",
      shape,
      { rule: key.split(":").at(-1), placeType: label },
      label
    );
}
function publishSites(state: RefinementState, key: string, label: string, share: Band) {
  const g = state.surface,
    known = [...generationFeatures(state, { areaId: state.input.areaId })].filter(
      (f) => f.kind === key && f.geometry.type === "Point"
    );
  regionalComponents(
    g,
    (i) => share.get(i) > 0.5,
    (members) => {
      // Captured source places are retained separately. A new non-source site
      // must resolve a physical footprint, rather than naming a one-cell class.
      if (!resolvesRegionalComponent(g, members)) return;
      const i = members.reduce((best, cell) => (share.get(cell) > share.get(best) ? cell : best));
      const p = gridPosition(g, i);
      if (known.some((f) => spatial.distance(f.geometry, point(p)) < state.parentSpan)) return;
      putRefinementFeature(
        state,
        `site:${key}:${i}`,
        key,
        "magic",
        point(p),
        { rule: key.split(":").at(-1), placeType: label },
        label
      );
    }
  );
}
