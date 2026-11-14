/** Located-source effects retain their existing data vocabulary and numerical behavior. */
export declare const locatedMagicEffectDefinitions: {
  readonly heat: {
    readonly label: "Heat";
    readonly physicalFeedback: true;
  };
  readonly cold: {
    readonly label: "Cold";
    readonly physicalFeedback: true;
  };
  readonly pressure: {
    readonly label: "Coastal pressure";
    readonly physicalFeedback: true;
  };
  readonly uplift: {
    readonly label: "Uplift influence";
    readonly physicalFeedback: false;
  };
  readonly erosionResistance: {
    readonly label: "Erosion resistance";
    readonly physicalFeedback: true;
  };
  readonly gravity: {
    readonly label: "Gravity influence";
    readonly physicalFeedback: false;
  };
  readonly fertility: {
    readonly label: "Fertility influence";
    readonly physicalFeedback: false;
  };
  readonly luminous: {
    readonly label: "Luminous influence";
    readonly physicalFeedback: false;
  };
};
export type LocatedMagicEffect = keyof typeof locatedMagicEffectDefinitions;
export declare const locatedMagicEffects: LocatedMagicEffect[];
