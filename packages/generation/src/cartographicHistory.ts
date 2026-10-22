import { z } from "zod";
import { defaultEcologyEpoch, type EcologyEpoch, type Epoch } from "@atlas/domain";

const curve = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);
export const terrainHistorySchema = z
  .object({
    tectonics: curve,
    ice: curve,
    glaciated: z.boolean(),
  })
  .strict();
export type TerrainHistory = z.infer<typeof terrainHistorySchema>;

/** Three anchors on the existing clock; never insert, rename or remove epochs. */
function at(values: readonly number[], index: number, count: number) {
  if (count === 1) return values[2];
  const position = (index * 2) / (count - 1),
    left = Math.min(1, Math.floor(position));
  return values[left] + (values[left + 1] - values[left]) * (position - left);
}

export function terrainEpochs(
  epochs: Epoch[],
  history: z.infer<typeof terrainHistorySchema>,
  temperature: number
): Epoch[] {
  return epochs.map((epoch, index) => {
    const cold = at([0, 1, 0], index, epochs.length);
    return {
      ...epoch,
      duration: history.glaciated && index === epochs.length - 1 ? 200 : 1000,
      tectonics: at(history.tectonics, index, epochs.length),
      ice: at(history.ice, index, epochs.length),
      temperature: 15 + (history.glaciated ? (-12 - temperature) * cold : 0),
      seaLevel: history.glaciated ? -60 * cold : 0,
    };
  });
}

export function landscapeEpoch(
  base: EcologyEpoch,
  landscape: EcologyEpoch | undefined,
  glaciated: boolean,
  index: number,
  count: number
): EcologyEpoch {
  const cold = glaciated ? at([0, 1, 0], index, count) : 0;
  const present = glaciated && index === count - 1;
  const modifiers: Partial<EcologyEpoch> = {
    rainfall: 1 - 0.2 * cold,
    productivity: present ? 1.2 : 1 - 0.6 * cold,
    fire: 1 - 0.8 * cold,
    migration: present ? 1.5 : 1 - 0.5 * cold,
    recovery: present ? 1.5 : 1 - 0.5 * cold,
  };
  const result = { ...defaultEcologyEpoch, ...base };
  for (const key of Object.keys(result) as (keyof EcologyEpoch)[])
    result[key] *=
      (landscape ? landscape[key] / defaultEcologyEpoch[key] : 1) * (modifiers[key] ?? 1);
  return result;
}
