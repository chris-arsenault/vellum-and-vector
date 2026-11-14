/**
 * What a river's step is like decides what it does to the ground around it. Rock and the river's
 * own size weigh each form, and chance picks among them. Arithmetic only: nothing reads the map.
 */
export type FallForm = "plunge" | "cataract" | "cascade" | "ribbon" | "chute";

/** What bears on a fall's form, each in [0, 1]. */
export interface FallReadings {
  hardness: number;
  fracture: number;
  /** How tall it is among falls. */
  tall: number;
  /** How much water it carries among falls. */
  broad: number;
}
/** The chance any form has, whatever the ground. */
const anyForm = 0.04;
const weights: Record<FallForm, (r: FallReadings) => number> = {
  // Hard rock over what wears faster: the water leaves the lip and falls clear.
  plunge: (r) => r.hardness * (1 - r.fracture) * (0.3 + r.tall),
  // A great river going over a broad ledge.
  cataract: (r) => r.broad * (0.4 + r.hardness),
  // Broken rock: the water works down it in many small falls among fallen blocks.
  cascade: (r) => (0.2 + r.fracture) * (1 - r.tall) * (1 - 0.5 * r.broad),
  // Little water from high up, thin against a cliff.
  ribbon: (r) => r.tall * (1 - r.broad),
  // Water forced through a slot it has sawn in hard rock.
  chute: (r) => r.hardness * (1 - r.broad) * (1 - r.tall),
};
const forms = Object.keys(weights) as FallForm[];

/** The form a fall takes: each form by its weight on these readings, `roll` in [0, 1) choosing. */
export function fallForm(readings: FallReadings, roll: number): FallForm {
  const each = forms.map((form) => anyForm + Math.max(0, weights[form](readings))),
    total = each.reduce((sum, weight) => sum + weight, 0);
  let left = roll * total;
  for (let i = 0; i < forms.length; i++) {
    left -= each[i];
    if (left < 0) return forms[i];
  }
  return forms[forms.length - 1];
}

/** What a form does to the ground around it. */
export interface FallShape {
  /**
   * How high the banks stand above the pool, as shares of the drop, from the lip downstream. One
   * is level with the lip: a river in a cut. The list's length is how far it has worn back.
   */
  readonly banks: readonly number[];
  /** Fallen rock on the bed below the lip, as a share of the drop. */
  readonly debris: number;
  /** Whether the water keeps the bed below it clean. */
  readonly scoured: boolean;
  /** Whether the lip is a broad ledge rather than a notch. */
  readonly broadLip: boolean;
}
export const fallShapes: Readonly<Record<FallForm, FallShape>> = {
  plunge: { banks: [1, 0.9, 0.6, 0.3], debris: 0, scoured: true, broadLip: false },
  cataract: { banks: [0, 0.5, 0.25], debris: 0, scoured: true, broadLip: true },
  cascade: { banks: [0.6, 0.4, 0.2], debris: 0.05, scoured: false, broadLip: false },
  ribbon: { banks: [1, 1], debris: 0, scoured: false, broadLip: false },
  chute: { banks: [1, 0.8, 0.4], debris: 0, scoured: true, broadLip: false },
};
