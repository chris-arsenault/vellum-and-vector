/** Located-source effects retain their existing data vocabulary and numerical behavior. */
export const locatedMagicEffectDefinitions = {
  heat: { label: "Heat", physicalFeedback: true },
  cold: { label: "Cold", physicalFeedback: true },
  pressure: { label: "Coastal pressure", physicalFeedback: true },
  uplift: { label: "Uplift influence", physicalFeedback: false },
  erosionResistance: { label: "Erosion resistance", physicalFeedback: true },
  gravity: { label: "Gravity influence", physicalFeedback: false },
  fertility: { label: "Fertility influence", physicalFeedback: false },
  luminous: { label: "Luminous influence", physicalFeedback: false },
} as const;

export type LocatedMagicEffect = keyof typeof locatedMagicEffectDefinitions;
export const locatedMagicEffects = Object.keys(
  locatedMagicEffectDefinitions
) as LocatedMagicEffect[];
