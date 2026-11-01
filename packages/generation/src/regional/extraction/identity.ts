import { point, spatial, type AtlasFeature, type DrainageReach } from "@atlas/domain";
import {
  generationFeature,
  generationFeatures,
  removeGenerationFeature,
  writeGenerationFeature,
} from "../../generationFeatures";
import { courseReachShare } from "../causes/course";
import { courseCells, type CapturedCourse } from "../courses";
import { adjacency, neighborsOf, regionalSpan } from "../lattice";
import type { RegionalState } from "../state";

/**
 * Share of a captured course's cells a developed stem must run beside, within the course's
 * valley (the corridor the network was drawn into), to take its identity.
 */
const identityShare = 0.3;

/**
 * After the world has published the field's geography, carry what only a refinement knows:
 * which developed river is a captured course, which realized summit is a captured peak, and
 * which features are this map's own products (so a later run regenerates them and keeps the
 * captured geography).
 */
export function carryIdentities(state: RegionalState) {
  tagProducts(state);
  carryCourses(state);
  reanchorSummits(state);
}

/** A feature neither captured nor authored is this run's product. */
function tagProducts(state: RegionalState) {
  const areaId = state.regional.input.areaId,
    source = state.sourceFeatures,
    removed = state.regional.removedProducts;
  for (const f of generationFeatures(state, { areaId })) {
    if (f.state !== "generated" || f.protected) continue;
    const captured =
      source?.get(f.id) !== undefined &&
      !removed?.has(f.id) &&
      f.attributes.developedBy !== "regional";
    if (captured || f.attributes.developedBy === "regional") continue;
    writeGenerationFeature(state, {
      ...f,
      attributes: { ...f.attributes, developedBy: "regional" },
    });
  }
}

/** The developed stem that runs along most of a captured course is that river. */
function carryCourses(state: RegionalState) {
  const courses = state.regional.courses ?? [],
    reaches = state.domain.world.drainage?.[state.regional.input.areaId]?.reaches ?? [];
  if (!courses.length || !reaches.length) return;
  const reach = Math.max(regionalSpan(state), state.regional.parentSpan * courseReachShare),
    corridors = reaches.map((r) => corridor(state, courseCells(state, [r.coordinates]), reach)),
    taken = new Set<number>();
  for (const course of courses) {
    const best = bestReach(
      course,
      corridors,
      (index) => !taken.has(index) && reaches[index].featureIds.length > 0
    );
    if (best < 0) {
      keepCaptured(state, course);
      continue;
    }
    // The whole stem along the course is that river: the reach that runs beside most of it,
    // the trunk above it and the water below it, as far as they keep to the course.
    for (const index of stemAlong(reaches, best, course, corridors, taken)) {
      taken.add(index);
      takeIdentity(state, reaches[index].featureIds[0], course);
    }
  }
}
/** No developed stem stands for the course: the captured river stays on the map as captured. */
function keepCaptured(state: RegionalState, course: CapturedCourse) {
  if (!generationFeature(state, course.feature.id)) writeGenerationFeature(state, course.feature);
}
/** The reaches of one stem through `best`, upstream by the larger inflow and downstream, within the course. */
function stemAlong(
  reaches: DrainageReach[],
  best: number,
  course: CapturedCourse,
  corridors: Set<number>[],
  taken: Set<number>
) {
  const along = (index: number) =>
      !taken.has(index) &&
      reaches[index].featureIds.length > 0 &&
      course.cells.some((cell) => corridors[index].has(cell)),
    stem = [best];
  for (let down = reaches[best].downstream; down !== null && along(down) && !stem.includes(down);)
    down = reaches[stem[stem.push(down) - 1]].downstream;
  for (
    let up = largestInflow(reaches, best, along);
    up >= 0;
    up = largestInflow(reaches, up, along)
  )
    stem.push(up);
  return stem;
}
function largestInflow(reaches: DrainageReach[], into: number, along: (index: number) => boolean) {
  let best = -1,
    most = 0;
  for (const [index, reach] of reaches.entries()) {
    const discharge = ownDischarge(reach);
    if (reach.downstream === into && along(index) && discharge > most)
      [best, most] = [index, discharge];
  }
  return best;
}
/** A reach's discharge on its own last cell (its mouth cell is the confluence it shares). */
function ownDischarge(reach: DrainageReach) {
  const n = reach.discharges.length;
  return n > 1 ? reach.discharges[n - 2] : (reach.discharges[0] ?? 0);
}
/** The cells within `reach` of a reach's cells: the ground the developed stem runs along. */
function corridor(state: RegionalState, cells: Int32Array, reach: number) {
  const mesh = state.physical.map.mesh,
    limit = Math.ceil(reach / adjacency(state).step),
    steps = new Int32Array(mesh.count).fill(-1),
    queue: number[] = [],
    around = new Int32Array(mesh.stride);
  for (const cell of cells) {
    steps[cell] = 0;
    queue.push(cell);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (steps[i] >= limit) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] >= 0) continue;
      steps[j] = steps[i] + 1;
      queue.push(j);
    }
  }
  return new Set(queue);
}
/** The eligible reach whose corridor holds the most of the course, if it holds enough of it. */
function bestReach(
  course: CapturedCourse,
  corridors: Set<number>[],
  eligible: (index: number) => boolean
) {
  let best = -1,
    most = 0;
  for (const [index, cells] of corridors.entries()) {
    if (!eligible(index)) continue;
    let count = 0;
    for (const cell of course.cells) if (cells.has(cell)) count++;
    if (count > most) [best, most] = [index, count];
  }
  return most >= course.cells.length * identityShare ? best : -1;
}

/**
 * The developed river stands for the captured course from now on: it takes the name and
 * place identity, carries the course as evidence for the next refinement, and the coarse
 * line leaves the map.
 */
function takeIdentity(state: RegionalState, featureId: string, course: CapturedCourse) {
  const feature = generationFeature(state, featureId);
  if (!feature) return;
  const carried = course.carried ?? {
    sourceId: course.feature.id,
    geometry: course.feature.geometry,
    discharge: course.discharge,
    order: course.order,
  };
  feature.name = course.feature.name;
  feature.placeId = course.feature.placeId ?? carried.sourceId;
  feature.attributes = {
    ...feature.attributes,
    nameStatus: course.feature.attributes.nameStatus ?? "proper",
    namingCulture: course.feature.attributes.namingCulture,
    namingLanguage: course.feature.attributes.namingLanguage,
    // The name is the captured one; the naming pass leaves a feature named in its era alone.
    namedInEra: course.feature.attributes.namedInEra ?? "captured",
    capturedCourse: carried,
    developedBy: "regional",
  };
  writeGenerationFeature(state, feature);
  if (!course.carried && generationFeature(state, course.feature.id))
    removeGenerationFeature(state, course.feature.id);
}

/**
 * An inherited peak keeps its identity and moves to the most prominent realized summit of its
 * massif; the summit the world published there is the same place and leaves. The captured
 * position and prominence are written from the evidence read at context, not from the
 * feature: when the world's extraction finds a summit where the feature already stands it
 * rewrites the feature's attributes, and a later refinement must still read the summit from
 * where the parent had it.
 */
function reanchorSummits(state: RegionalState) {
  const reach = state.regional.parentSpan,
    areaId = state.regional.input.areaId,
    peaks = [...generationFeatures(state, { areaId })]
      .filter(
        (f) =>
          f.kind === "peak" &&
          f.geometry.type === "Point" &&
          f.attributes.developedBy === "regional"
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    taken = new Set<string>();
  for (const summit of state.regional.evidence?.summits ?? []) {
    const feature = generationFeature(state, summit.featureId);
    if (!feature || feature.geometry.type !== "Point") continue;
    const carried = { anchoredFrom: summit.captured, capturedProminence: summit.prominence },
      best = nearestProminent(peaks, summit.captured, reach, taken);
    if (best) {
      taken.add(best.id);
      moveSummit(state, feature, best, carried);
    } else
      writeGenerationFeature(state, {
        ...feature,
        attributes: { ...feature.attributes, ...carried },
      });
  }
}
function nearestProminent(
  peaks: AtlasFeature[],
  captured: number[],
  reach: number,
  taken: Set<string>
) {
  let best: AtlasFeature | undefined,
    bestRise = 0;
  for (const peak of peaks) {
    if (taken.has(peak.id)) continue;
    const rise = Number(peak.attributes.prominence ?? 0);
    if (
      rise > bestRise &&
      spatial.distance(peak.geometry, point({ x: captured[0], y: captured[1], z: 0 })) <= reach
    ) {
      best = peak;
      bestRise = rise;
    }
  }
  return best;
}
function moveSummit(
  state: RegionalState,
  feature: AtlasFeature,
  realized: AtlasFeature,
  carried: { anchoredFrom: [number, number]; capturedProminence: number }
) {
  feature.geometry = realized.geometry;
  feature.attributes = {
    ...feature.attributes,
    ...carried,
    prominence: realized.attributes.prominence,
    elevation: realized.attributes.elevation,
  };
  writeGenerationFeature(state, feature);
  removeGenerationFeature(state, realized.id);
}
