import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serialize } from "node:v8";
import type { GenerationState } from "../../../packages/generation/src/process";
import type { MagicInventory } from "../../../packages/generation/src/world/magicInventory";
import { magicChannels } from "../../../packages/generation/src/world/magicFieldDefinitions";
import type { RunObservers } from "./harnessGeneration";
import { drawMaterials } from "./materialPicture";
import { processProbeBands } from "./processProbe";

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
    if (step === "atlas.names" && process.env.HARNESS_MATERIAL_CANDIDATES && state.physical)
      drawMaterials(state.physical.map, out, map);
    const magic = inspectMagic(state);
    if (!magic) return;
    writeFileSync(
      join(out, `${map}-magic-${sequence++}-${step}.bin`),
      serialize({ path, step, ...magic })
    );
  };
}

/** Selected operation boundaries for comparing current geography and retained evidence. */
export function recordFieldInspection(observers: RunObservers, out: string, name: string) {
  const selected = new Set((process.env.HARNESS_FIELD_INSPECTION ?? "").split(",").filter(Boolean));
  if (!selected.size) return;
  const bands = processProbeBands(process.env.HARNESS_PROCESS_BANDS ?? ""),
    inspect = observers.inspect;
  let sequence = 0;
  observers.inspect = (path, step, state) => {
    inspect?.(path, step, state);
    const map = state.physical?.map;
    if (!map || !selected.has(step)) return;
    writeFileSync(
      join(out, `${name}-fields-${sequence++}-${step}.bin`),
      serialize({
        path,
        step,
        x: Float64Array.from(
          { length: map.mesh.count },
          (_, i) => map.mesh.x(i) + map.mesh.origin[0]
        ),
        y: Float64Array.from(
          { length: map.mesh.count },
          (_, i) => map.mesh.y(i) + map.mesh.origin[1]
        ),
        membership: Uint8Array.from({ length: map.mesh.count }, (_, i) => map.mesh.membership(i)),
        fields: Object.fromEntries(bands.map((band) => [band, copy(map[band])])),
      })
    );
  };
}
