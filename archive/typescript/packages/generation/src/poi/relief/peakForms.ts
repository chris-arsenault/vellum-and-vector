/**
 * What a peak is made of decides what it looks like. Rock, ice and weather weigh each form, and
 * chance picks among them, so hard rock usually stands as a crag and sometimes does not. Every
 * form here is arithmetic on a place's own readings: nothing reads the map.
 */
export type PeakForm = "horn" | "crag" | "scarred" | "dome" | "shattered" | "table";

/** What bears on a peak's form, each in [0, 1]. */
export interface PeakReadings {
  hardness: number;
  fracture: number;
  ice: number;
  cold: number;
  wet: number;
  steep: number;
  bedded: number;
}
/** The chance any form has, whatever the ground: rock does not read its own geology. */
const anyForm = 0.04;
const formWeights: Record<PeakForm, (r: PeakReadings) => number> = {
  // Ice cuts hard rock into faces on all sides.
  horn: (r) => r.ice * (0.4 + r.hardness),
  // Weather takes the soft rock from around a hard core, along its joints.
  crag: (r) => r.hardness * (1 - r.ice) * (0.3 + r.fracture),
  // Snow loads a steep top, and what comes down takes one side with it.
  scarred: (r) => r.steep * Math.max(r.cold, r.ice) * (0.4 + r.wet),
  // Massive unjointed rock sheds in curved sheets.
  dome: (r) => r.hardness * (1 - r.fracture) * (1 - r.steep),
  // Weak or broken rock falls into its own debris.
  shattered: (r) => (1 - r.hardness) * (0.3 + r.fracture),
  // Flat beds capped by what resists leave a level top.
  table: (r) => r.bedded * (1 - r.ice) * (1 - 0.5 * r.wet),
};
const forms = Object.keys(formWeights) as PeakForm[];

/** The form a peak takes: each form by its weight on these readings, `roll` in [0, 1) choosing. */
export function peakForm(readings: PeakReadings, roll: number): PeakForm {
  const weights = forms.map((form) => anyForm + Math.max(0, formWeights[form](readings))),
    total = weights.reduce((sum, weight) => sum + weight, 0);
  let left = roll * total;
  for (let i = 0; i < forms.length; i++) {
    left -= weights[i];
    if (left < 0) return forms[i];
  }
  return forms[forms.length - 1];
}

/** What a form does at one spot, as shares of the peak's size. */
export interface PeakShape {
  /** Ground raised or, below zero, cut away. */
  ground: number;
  /** Fallen rock lying on the ground. */
  debris: number;
  /** Whether nothing grows here. */
  bare: boolean;
}
/** A spot around a peak: its distance as a share of the peak's reach, and bearing in radians. */
export interface PeakSpot {
  reach: number;
  bearing: number;
  /** The bearing the peak's chosen face looks along. */
  face: number;
}
type Shaper = (spot: PeakSpot) => PeakShape;
const hold = (ground: number, debris: number, bare: boolean): PeakShape => ({
  ground,
  debris,
  bare,
});
const shapers: Record<PeakForm, Shaper> = {
  // Three faces meeting at a point: sharp at the top, hollowed between the arêtes.
  horn({ reach, bearing, face }) {
    const faces = 0.75 + 0.25 * Math.cos(3 * (bearing - face));
    return hold((1 - reach) ** 2 * faces, 0, reach < 0.6);
  },
  // A stump standing out of its own talus.
  crag({ reach }) {
    if (reach < 0.25) return hold(1, 0, true);
    if (reach < 0.45) return hold(1 - (reach - 0.25) / 0.2, 0, true);
    return hold(0, reach < 0.8 ? 0.12 : 0, false);
  },
  // One side cut raw and heaped at its foot; the other side keeps its long slope.
  scarred({ reach, bearing, face }) {
    const facing = Math.cos(bearing - face);
    if (facing <= 0 || reach < 0.15) return hold(0.35 * (1 - reach), 0, reach < 0.15);
    if (reach < 0.6) return hold(-0.6 * facing, 0, true);
    return hold(0, 0.35 * facing, false);
  },
  // A rounded swell with no break in it.
  dome: ({ reach }) => hold(0.6 * Math.sqrt(1 - reach * reach), 0, reach < 0.4),
  // Its shoulders fall away into a skirt of debris, and the top stays a heap.
  shattered: ({ reach }) =>
    hold(-0.3 * Math.sin(Math.PI * reach), reach > 0.5 ? 0.5 * (1 - reach) * 2 : 0, reach < 0.5),
  // A nearly level cap, a cliff around it, and ground worn back beneath the cliff.
  table({ reach }) {
    if (reach < 0.5) return hold(0.5 + 0.04 * (1 - reach), 0, true);
    if (reach < 0.7) return hold(0.5 * (1 - (reach - 0.5) / 0.2), 0, true);
    return hold(-0.15 * (1 - reach) * (1 / 0.3), 0, false);
  },
};
/** What a form does at a spot within its reach, and nothing beyond it. */
export const peakShape = (form: PeakForm, spot: PeakSpot): PeakShape =>
  spot.reach >= 1 ? hold(0, 0, false) : shapers[form](spot);
