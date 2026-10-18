// Engine.Constants/KernelCodes.cs, Canonry 0f62584c.
export const Feature = {
  GeothermalVent: 1 << 0,
  PermanentSeaIce: 1 << 1,
  PermanentIceMargin: 1 << 2,
  FireCore: 1 << 3,
  MagmaChamber: 1 << 4,
  DeadGodLocus: 1 << 5,
  MantlePlume: 1 << 6,
  ImpactCenter: 1 << 7,
  VolcanicCone: 1 << 8,
  VolcanicCaldera: 1 << 9,
  LavaPlain: 1 << 10,
};
export const Landform = {
  Plain: 1,
  Slope: 2,
  Valley: 3,
  Basin: 4,
  Ridge: 5,
  Peak: 6,
  Pass: 7,
  Seabed: 8,
  UValley: 9,
  Cirque: 10,
  Fjord: 11,
  Moraine: 12,
  OutwashPlain: 13,
  ImpactBasin: 14,
  ImpactRim: 15,
  Gorge: 16,
  Waterfall: 17,
};
export const Water = { None: 0, Ocean: 1, Lake: 2 };
export const Boundary = { None: 0, Convergent: 1, Divergent: 2, Transform: 3 };
export const Margin = { Interior: 0, Passive: 1, Convergent: 2, Rifted: 3, Transform: 4 };
