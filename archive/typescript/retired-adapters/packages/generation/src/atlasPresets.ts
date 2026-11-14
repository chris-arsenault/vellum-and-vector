import { rainfallRegimes, type AtlasParameters } from "./atlasParameters";

export const atlasPresets: Record<string, { label: string; parameters: Partial<AtlasParameters> }> =
  {
    balanced: { label: "Mixed continents", parameters: {} },
    islands: { label: "Island world", parameters: { continents: 12, landFraction: 0.25 } },
    continental: { label: "Broad continents", parameters: { continents: 2, landFraction: 0.7 } },
    cold: { label: "Cold world", parameters: { temperature: -5 } },
    arid: { label: "Arid world", parameters: { rainfall: rainfallRegimes.dry.rainfall } },
    wet: { label: "Wet world", parameters: { rainfall: rainfallRegimes.wet.rainfall } },
    canonry: {
      label: "Ice Remembers · cold magical world",
      parameters: {
        continents: 5,
        provinces: 30,
        landFraction: 0.53,
        temperature: -17.5,
        impacts: 7,
      },
    },
  };
