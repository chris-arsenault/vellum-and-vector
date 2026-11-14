import type { Epoch, EcologyEpoch } from "@atlas/context";
import { defaultEcologyEpoch } from "./generationPresentation";

const present: Omit<Epoch, "ecology"> = {
  id: "Present",
  tectonics: 0.4,
  hydrology: 1,
  ice: 0,
  coasts: 1,
  temperature: 15,
  seaLevel: 0,
  lengthUnits: "relative",
};
const histories: Record<string, (Omit<Epoch, "ecology"> & { ecology?: Partial<EcologyEpoch> })[]> =
  {
    young: [{ ...present, id: "Formation", tectonics: 1 }],
    temperate: [{ ...present, id: "Formation", tectonics: 1 }, present],
    glacial: [
      { ...present, id: "Formation", tectonics: 1 },
      { ...present, id: "Cold age", tectonics: 0.7, ice: 1, temperature: -3, seaLevel: -0.00001 },
      present,
    ],
    cycles: [
      { ...present, id: "Formation", tectonics: 1, volcanism: 1.5, impacts: 2 },
      { ...present, id: "First ice age", ice: 1, temperature: -15, seaLevel: -0.000025 },
      { ...present, id: "Interglacial", ice: 0.2, temperature: 18 },
      { ...present, id: "Second ice age", ice: 1, temperature: -10, seaLevel: -0.0000175 },
      present,
    ],
    canonry: [
      {
        ...present,
        id: "Crust assembly",
        tectonics: 1,
        hydrology: 0.18,
        ice: 0.1,
        coasts: 0.12,
        temperature: 29.5,
        seaLevel: 0.00000875,
        magicActivity: { fire: 0.65, aurora: 0.16, pressure: 0.32 },
      },
      {
        ...present,
        id: "Orogeny and wet erosion",
        tectonics: 0.85,
        ice: 0.09,
        coasts: 0.58,
        temperature: 38,
        seaLevel: 0.000005,
        magicActivity: { fire: 0.9, aurora: 0.38, pressure: 0.56 },
      },
      {
        ...present,
        id: "Glacial maximum",
        tectonics: 0.36,
        hydrology: 0.62,
        ice: 1,
        coasts: 0.76,
        temperature: 1,
        seaLevel: -0.00001125,
        magicActivity: { fire: 0.72, aurora: 1, pressure: 0.76 },
      },
      {
        ...present,
        id: "Retreat and present",
        tectonics: 0.22,
        hydrology: 0.86,
        ice: 0.46,
        temperature: 21.5,
        magicActivity: { fire: 1, aurora: 0.76, pressure: 1 },
      },
    ],
    ecological: [
      {
        ...present,
        id: "Wet expansion",
        temperature: 22,
        ecology: { rainfall: 1.4, seasonality: 0.15, fire: 0.3 },
      },
      {
        ...present,
        id: "Dry fire age",
        temperature: 27,
        ecology: { rainfall: 0.35, seasonality: 0.9, fire: 3 },
      },
      {
        ...present,
        id: "Cold retreat",
        temperature: -8,
        ice: 0.8,
        ecology: { rainfall: 0.7, seasonality: 0.65, migration: 1.5 },
      },
      {
        ...present,
        id: "Refugial recovery",
        temperature: 18,
        ecology: { rainfall: 1.1, seasonality: 0.3, recovery: 1.5 },
      },
    ],
  };
export function HistoryPreset({ change }: { change: (epochs: Epoch[]) => void }) {
  return (
    <label>
      History starting point
      <select
        defaultValue="current"
        onChange={(event) =>
          change(
            structuredClone(histories[event.target.value]).map((epoch) => ({
              ...epoch,
              ecology: { ...defaultEcologyEpoch(), ...epoch.ecology },
            }))
          )
        }
      >
        <option value="current" disabled>
          Current history
        </option>
        <option value="young">Young, active landscape</option>
        <option value="temperate">Temperate history</option>
        <option value="glacial">Glacial past, temperate present</option>
        <option value="cycles">Bombardment & repeated ice ages</option>
        <option value="canonry">Ice Remembers · four epochs</option>
        <option value="ecological">Ecological cycles · wet, dry, cold and recovery</option>
      </select>
    </label>
  );
}
