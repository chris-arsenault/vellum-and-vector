import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serialize } from "node:v8";
import type { GenerationState } from "../../../packages/generation/src/process";
import type { MagicInventory } from "../../../packages/generation/src/world/magicInventory";
import { magicChannels } from "../../../packages/generation/src/world/magicFieldDefinitions";
import type { RunObservers } from "./harnessGeneration";

const copy = (values: Pick<MagicInventory, "length" | "get">) =>
  Float64Array.from({ length: values.length }, (_, cell) => values.get(cell));
const copies = (values: Record<string, MagicInventory>) =>
  Object.fromEntries(Object.entries(values).map(([key, band]) => [key, copy(band)]));

/** Read-only observations alongside physical snapshots; these are never restore inputs. */
function inspectMagic(state: GenerationState) {
  const work = state.physical,
    magic = work?.magic;
  if (!magic) return undefined;
  return {
    completedEpochs: work.map.CompletedEpochCount,
    fields: magic.fields.map((field) => ({
      definition: field.definition,
      located: field.located,
      doors: field.doors,
      lost: field.lost,
      suppliedEpoch: field.suppliedEpoch,
      fresh: copy(field.fresh),
      drawn: copy(field.drawn),
      channels: Object.fromEntries(magicChannels.map((name) => [name, copy(field[name])])),
      sources: copies(field.originSources),
      stocks: copies(field.stocks),
      coverage: copies(field.coverage),
    })),
    meetings: Object.fromEntries(
      Object.entries(magic.confluences.states).map(([id, meeting]) => [
        id,
        { definition: meeting.definition, coverage: copy(meeting.coverage) },
      ])
    ),
    wardRim: copy(magic.wardRim),
    wardLabel: copy(magic.wardLabel),
    rimLabel: copy(magic.rimLabel),
  };
}

/** Opt-in epoch and society observations for tracing a real history's material exchanges. */
export function recordMagicInspection(observers: RunObservers, out: string, map: string) {
  if (!process.env.HARNESS_MAGIC_INSPECTION) return;
  const inspect = observers.inspect;
  let sequence = 0;
  observers.inspect = (path, step, state) => {
    inspect?.(path, step, state);
    if (!["atlas.magic-history", "human.evolve", "atlas.names"].includes(step)) return;
    const magic = inspectMagic(state);
    if (!magic) return;
    writeFileSync(
      join(out, `${map}-magic-${sequence++}-${step}.bin`),
      serialize({ path, step, ...magic })
    );
  };
}
