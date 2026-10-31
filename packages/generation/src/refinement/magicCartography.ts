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
  type MagicSystem,
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
  for (const system of systems) classifySystem(state, system, sources, priority, held);
  const enabledMeetings = meetings.filter((m) => confluenceEffective(m, systems));
  for (const meeting of enabledMeetings) {
    const share = channel(state, `magic:confluence:${meeting.id}:coverage`, "ratio"),
      members = channel(state, `magic:confluence:${meeting.id}:members`, "category");
    for (let i = 0; i < share.length; i++) {
      const coverage = meetingShare(state, meeting, i);
      share.set(i, coverage);
      members.set(i, Number(coverage > 0));
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
  }
  g.coverage.release(priority);
  g.coverage.release(held);
}
function classifySystem(
  state: RefinementState,
  system: MagicSystem,
  sources: ReturnType<typeof surfaceRuleSources>,
  priority: Band,
  held: Band
) {
  channel(state, `magic:${system.id}:coverage`, "ratio").fill(0);
  for (const rule of system.features) {
    if (!system.enabled || system.strength === 0) {
      channel(state, `magic:${system.id}:coverage:${rule.id}`, "ratio").fill(0);
      channel(state, `magic:${system.id}:feature:${rule.id}`, "category").fill(0);
    } else {
      classifyRule(
        state,
        system.id,
        rule,
        magicSurfaceCode(sources, system.id, rule.id)!,
        priority,
        held
      );
    }
  }
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
    share = channel(state, `magic:${owner}:coverage:${rule.id}`, "ratio"),
    members = channel(state, `magic:${owner}:feature:${rule.id}`, "category"),
    total = g.channels[`magic:${owner}:coverage`];
  for (let i = 0; i < share.length; i++) {
    const value = magicShare(state, owner, rule, i);
    share.set(i, value);
    members.set(i, Number(value > 0));
    total.set(i, Math.max(total.get(i), value));
    paint(state, i, code, rule.priority, value, priority, held);
  }
  publishClass(state, `${owner}:${rule.id}`, rule.name, rule.cartography ?? "area", share);
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
