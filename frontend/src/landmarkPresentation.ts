/** Labels and units for already resolved landmark records. Generation owns their measures. */
interface Presentation {
  id: string;
  label: string;
  parameters: { key: string; label: string; unit: string; advisory?: boolean }[];
}
const landmarks: Presentation[] = [
  {
    id: "volcanic-mountain",
    label: "Volcanic mountain",
    parameters: [
      {
        key: "summit",
        label: "Summit elevation",
        unit: "m",
      },
      {
        key: "prominence",
        label: "Prominence",
        unit: "m",
      },
      {
        key: "baseRadius",
        label: "Base radius",
        unit: "km",
      },
    ],
  },
  {
    id: "resistant-mountain",
    label: "Resistant-core mountain",
    parameters: [
      {
        key: "summit",
        label: "Summit elevation",
        unit: "m",
      },
      {
        key: "prominence",
        label: "Prominence",
        unit: "m",
      },
      {
        key: "baseRadius",
        label: "Base radius",
        unit: "km",
      },
    ],
  },
  {
    id: "canyon",
    label: "Canyon",
    parameters: [
      {
        key: "depth",
        label: "Depth below rim",
        unit: "m",
      },
      {
        key: "rimWidth",
        label: "Rim-to-rim width",
        unit: "km",
      },
      {
        key: "captureDistance",
        label: "River capture distance",
        unit: "km",
      },
    ],
  },
  {
    id: "dome-ring",
    label: "Eroded dome",
    parameters: [
      {
        key: "diameter",
        label: "Diameter",
        unit: "km",
      },
      {
        key: "ringCount",
        label: "Ring count",
        unit: "rings",
      },
      {
        key: "ringRelief",
        label: "Ring relief",
        unit: "m",
      },
    ],
  },
  {
    id: "impact-ring",
    label: "Impact structure",
    parameters: [
      {
        key: "diameter",
        label: "Diameter",
        unit: "km",
      },
      {
        key: "rimHeight",
        label: "Rim height",
        unit: "m",
      },
      {
        key: "floorDepth",
        label: "Floor depth below rim",
        unit: "m",
      },
    ],
  },
  {
    id: "escarpment",
    label: "Escarpment or rift edge",
    parameters: [
      {
        key: "throw",
        label: "Throw",
        unit: "m",
      },
      {
        key: "scarpWidth",
        label: "Scarp width",
        unit: "km",
      },
    ],
  },
  {
    id: "falls",
    label: "Great falls",
    parameters: [
      {
        key: "drop",
        label: "Drop",
        unit: "m",
      },
      {
        key: "discharge",
        label: "Desired discharge",
        unit: "m³/s",
        advisory: true,
      },
      {
        key: "captureDistance",
        label: "River capture distance",
        unit: "km",
      },
    ],
  },
  {
    id: "fire-wellspring",
    label: "Great wellspring",
    parameters: [
      {
        key: "intensity",
        label: "Fire at the source",
        unit: "/1000",
      },
      {
        key: "reach",
        label: "Source reach",
        unit: "km",
      },
    ],
  },
  {
    id: "aurora-vault",
    label: "Great vault",
    parameters: [
      {
        key: "intensity",
        label: "Charge at the source",
        unit: "/1000",
      },
      {
        key: "reach",
        label: "Source reach",
        unit: "km",
      },
    ],
  },
  {
    id: "pressure-locus",
    label: "Deep locus",
    parameters: [
      {
        key: "intensity",
        label: "Pressure at the source",
        unit: "/1000",
      },
      {
        key: "reach",
        label: "Source reach",
        unit: "km",
      },
    ],
  },
  {
    id: "greenwood-heart",
    label: "Heartwood",
    parameters: [
      {
        key: "intensity",
        label: "Sap at the source",
        unit: "/1000",
      },
      {
        key: "reach",
        label: "Source reach",
        unit: "km",
      },
    ],
  },
  {
    id: "salt-pan",
    label: "Great salt pan",
    parameters: [
      {
        key: "intensity",
        label: "Salting at the source",
        unit: "/1000",
      },
      {
        key: "reach",
        label: "Source reach",
        unit: "km",
      },
    ],
  },
];
export const landmarkKind = (id: string) => landmarks.find((kind) => kind.id === id);
