/**
 * A human era binds to a physical epoch by id, or structurally to the epoch before the
 * present with this value, so the round follows the schedule whatever the epochs are named.
 */
export const beforePresentEpoch = "before-present";
export type SocietyWorkKind =
  | "dam"
  | "irrigation"
  | "pass"
  | "harbor"
  | "clearance"
  | "hunting"
  | "conservation"
  | "fire-forge"
  | "aurora-archive"
  | "pressure-diving"
  // Works of people who move with the wild inside a glacial epoch.
  | "tapping"
  | "burning"
  | "quarrying"
  | "weir"
  // Regional refinement's works at the crossings and falls its ways and channels make.
  | "ford"
  | "bridge"
  | "mill";
/**
 * How a work kind behaves at a profile whose mesh cannot hold it (ADR 0005). An intensive
 * work is a fraction per cell with meaning, so at World it spreads as field forcing over its
 * medium. A structural work is one thing or none, so at World it stands only where the mesh
 * resolves it. A practice is a located record that forces one cell at its seat at every
 * profile.
 */
export type SocietyWorkNature = "intensive" | "structural" | "practice";
/** One labelled declaration per work kind: its nature and the unit its amount carries. */
export const societyWorkNatures: Record<
  SocietyWorkKind,
  { nature: SocietyWorkNature; unit: string; carries: string }
> = {
  clearance: { nature: "intensive", unit: "fraction", carries: "cleared share of farmable land" },
  burning: { nature: "intensive", unit: "fraction", carries: "burnt share of wooded land" },
  hunting: { nature: "intensive", unit: "fraction", carries: "harvest pressure on herds" },
  conservation: { nature: "intensive", unit: "fraction", carries: "restoration pressure" },
  irrigation: {
    nature: "intensive",
    unit: "cubic-metre/second",
    carries: "flux diverted from the place's channels",
  },
  tapping: { nature: "intensive", unit: "fraction", carries: "conductance rise along veins" },
  quarrying: { nature: "intensive", unit: "fraction", carries: "stored charge removed" },
  dam: { nature: "structural", unit: "cubic-metre/second", carries: "regulated discharge" },
  harbor: { nature: "structural", unit: "people", carries: "maritime traffic served" },
  pass: { nature: "structural", unit: "people", carries: "route traffic across steep ground" },
  weir: { nature: "structural", unit: "metre", carries: "shore worked" },
  ford: { nature: "structural", unit: "people", carries: "crossing traffic at a channel" },
  bridge: { nature: "structural", unit: "people", carries: "crossing traffic over a river" },
  mill: { nature: "structural", unit: "cubic-metre/second", carries: "flow turned at a fall" },
  "fire-forge": { nature: "practice", unit: "celsius", carries: "heat budget at the seat" },
  "aurora-archive": { nature: "practice", unit: "crystal", carries: "crystals and charge" },
  "pressure-diving": { nature: "practice", unit: "charge", carries: "carried charge" },
};
