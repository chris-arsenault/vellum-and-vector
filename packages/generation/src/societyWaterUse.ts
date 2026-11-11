import { MapScale, type SocietyWork, type FieldChannelName } from "@atlas/domain";
import type { GenerationState } from "./process";
import { workSamples } from "./societyWorks";
import type { PhysicalField } from "./world/field";
import { respond } from "./coupling/answers";
import { defineCommand } from "./processOperation";
import { societyValue } from "./societySupport";
import { mapScale } from "./worldSignificance";

/** Soil water depth per diverted flow; exposure is folded into this inverse area. */
export const soilShare = MapScale.measure(3.2e11, -2);
export function irrigateSoil(
  state: GenerationState,
  i: number,
  amount: number,
  edit: (name: FieldChannelName, value: number) => void
) {
  const available = societyValue(state, "FlowAccumulation", i),
    diverted = Math.min(available * 0.2, amount);
  edit("FlowAccumulation", available - diverted);
  edit(
    "SoilWater",
    societyValue(state, "SoilWater", i) + diverted * mapScale(state).resolveMeasure(soilShare)
  );
}

// hpc-exempt: one typed demand field per map, owned by its current society works.
const demandWithdrawals = new WeakMap<PhysicalField, Float64Array>();
respond({
  key: "waterWithdrawal",
  by: "irrigation demands",
  reads: [],
  add: (map, cell) => demandWithdrawals.get(map)?.[cell] ?? 0,
});

/** Anchor river works to the retained channel, including channels omitted from the map. */
export function anchorRiverWork(state: GenerationState, work: SocietyWork) {
  const network = state.domain.world.drainage?.[state.domain.scope.areaId];
  const origin = work.position;
  let distance = work.radius * 2;
  for (const reach of network?.reaches ?? [])
    for (const [x, y] of reach.coordinates) {
      const d = Math.hypot(x - origin.x, y - origin.y);
      if (d >= distance) continue;
      distance = d;
      work.position = { x, y, z: 0 };
    }
}

/**
 * Annual diversion is a maintained flux supplied to shared water routing. A World
 * demand diverts its share from every channel cell of its unit, as the intensive forcing it is.
 * A located work is the irrigation entry's place, which declares its own diversion.
 */
export const irrigateChannels = defineCommand("human.irrigation-demand", "work", irrigate, []);
function irrigate(state: GenerationState) {
  const physical = state.physical!;
  const works = state.society!.region.works.filter((w) => w.kind === "irrigation" && w.demand);
  const map = physical.map,
    withdrawals = demandWithdrawals.get(map) ?? new Float64Array(map.mesh.count);
  withdrawals.fill(0);
  demandWithdrawals.set(map, withdrawals);
  for (const work of works) {
    let total = 0;
    for (const { i, fraction: share } of workSamples(state, work)) {
      const cell = physical.samples.get(i);
      if (cell === undefined || cell < 0) continue;
      const diverted = Math.max(0, work.magnitude * work.condition * share);
      total += diverted;
      withdrawals[cell] += diverted;
    }
    work.causes = [
      `Requests ${total.toFixed(3)} cubic metres per second; shared routing limits withdrawal to available flow.`,
    ];
  }
}
