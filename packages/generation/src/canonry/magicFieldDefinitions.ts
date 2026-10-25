interface MagicFieldDefinition {
  unit: string;
  quantity: "intensive" | "extensive" | "category";
  initial: number;
  carried: boolean;
  publish: boolean;
}

const intensity = {
  unit: "relative-intensity",
  quantity: "intensive" as const,
  initial: 0,
  carried: false,
  publish: true,
};
const occurrence = {
  unit: "category",
  quantity: "category" as const,
  initial: -1,
  carried: true,
  publish: true,
};

/** Numerical meaning and lifetime are shared by every magic field adapter. */
export const magicFieldDefinitions = {
  intensity,
  history: { ...intensity, carried: true },
  firstEpoch: occurrence,
  stored: { ...intensity, carried: true },
  retained: { ...intensity, unit: "intensity-square-metre", quantity: "extensive" },
  coastalHistory: { ...intensity, carried: true },
  coastalFirstEpoch: occurrence,
  source: intensity,
  wake: intensity,
  rogue: intensity,
  // A conduit that carried its budget of Fire and sealed; travels with the crust.
  sealed: {
    unit: "category",
    quantity: "category" as const,
    initial: 0,
    carried: true,
    publish: true,
  },
  // The epoch a finite stock arrived in the cell (an impact's fall); travels with the crust.
  arrival: occurrence,
  // The share of a cell's held stock the last evaluation released as source.
  releasing: { ...intensity, unit: "ratio", publish: false },
  // Ground lowered so far by thawing charge, metres; bounded, and travels with the crust.
  subsided: { ...intensity, unit: "metre", carried: true },
  // Ground raised so far by a salt dome, metres; bounded, and travels with the crust.
  domed: { ...intensity, unit: "metre", carried: true },
  radii: { ...intensity, unit: "metre", publish: false },
} satisfies Record<string, MagicFieldDefinition>;

export type MagicChannel = keyof typeof magicFieldDefinitions;
export const magicChannels = Object.keys(magicFieldDefinitions) as MagicChannel[];
export const carriedMagicChannels = magicChannels.filter(
  (channel) => magicFieldDefinitions[channel].carried
);
export const publishedMagicChannels = magicChannels.filter(
  (channel) => magicFieldDefinitions[channel].publish
);

export const magicWorkspaceDefinitions = {
  heat: { quantity: "intensive" },
  coastal: { quantity: "intensive" },
  upwelling: { quantity: "intensive" },
  seaSurface: { quantity: "intensive" },
  fog: { quantity: "intensive" },
  naturalSurface: { unit: "category", quantity: "category" },
  finalSurface: { unit: "category", quantity: "category" },
} as const;
export const magicWorkspaceChannels = Object.keys(
  magicWorkspaceDefinitions
) as (keyof typeof magicWorkspaceDefinitions)[];
