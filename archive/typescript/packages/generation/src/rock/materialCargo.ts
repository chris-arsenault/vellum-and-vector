import { FloatList, IntPairIndex } from "@atlas/domain";
import type { MaterialLayer } from "./rockLayerFields";

/** Detached triples: reservoir key, host constituent (zero means aggregate), charge per m³. */
export type MaterialCargo = Float64Array;
export const emptyCargo = new Float64Array(0);
/** Identity projection retains hosts and densities and joins coincident origin-host entries. */
export function mapCargoKeys(cargo: MaterialCargo, keyAt: (key: number) => number) {
  let changed = false;
  for (let at = 0; at < cargo.length; at += 3)
    if (keyAt(cargo[at]) !== cargo[at]) {
      changed = true;
      break;
    }
  if (!changed) return cargo;
  parcelMixture.clear();
  for (let at = 0; at < cargo.length; at += 3)
    parcelMixture.addEntry(keyAt(cargo[at]), cargo[at + 1], cargo[at + 2]);
  return parcelMixture.finish(1);
}
/** Dissolution spends this charge while unrelated cargo remains on the transported grains. */
export function withoutCargo(cargo: MaterialCargo | undefined, key: number) {
  return cargo?.filter((_value, i) => cargo[i - (i % 3)] !== key);
}
/** A change of reservoir keeps the same parcel and its constituent history. */
export function rekeyCargo(cargo: MaterialCargo | undefined, from: number, to: number, share = 1) {
  if (!cargo) return undefined;
  parcelMixture.clear();
  for (let at = 0; at < cargo.length; at += 3) {
    const fraction = cargo[at] === from ? Math.max(0, Math.min(1, share)) : 0;
    parcelMixture.addEntry(cargo[at], cargo[at + 1], cargo[at + 2] * (1 - fraction));
    if (fraction > 0) parcelMixture.addEntry(to, cargo[at + 1], cargo[at + 2] * fraction);
  }
  return parcelMixture.finish(1);
}
/** Unrepresented basement supplies ordinary rock, never an infinite charged inventory. */
export function finiteSlice(
  layer: MaterialLayer,
  depth: number,
  basement: boolean,
  offset = 0
): MaterialLayer {
  if (!basement || !layer.cargo || offset + depth <= layer.depth - 1) return { ...layer, depth };
  const cargo = layer.cargo.slice(),
    share = Math.max(0, Math.min(depth, layer.depth - 1 - offset)) / depth;
  if (share <= 0) return { ...layer, depth, cargo: undefined };
  for (let at = 2; at < cargo.length; at += 3) cargo[at] *= share;
  return { ...layer, depth, cargo };
}

export function sameCargo(a: MaterialCargo = emptyCargo, b: MaterialCargo = emptyCargo) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
  return true;
}

/** Small parcel-local accumulator; no cell-indexed objects or reservoir-per-layer allocation. */
export class CargoMixture {
  private readonly pairs = new IntPairIndex();
  private readonly amounts = new FloatList();
  clear() {
    this.pairs.clear();
    this.amounts.clear();
  }
  add(cargo: MaterialCargo | undefined, weight: number) {
    if (!cargo || weight <= 0) return;
    for (let at = 0; at < cargo.length; at += 3)
      this.addEntry(cargo[at], cargo[at + 1], cargo[at + 2] * weight);
  }
  addEntry(key: number, host: number, amount: number) {
    if (!(amount > 0)) return;
    const at = this.pairs.include(key, host);
    if (at === this.amounts.length) this.amounts.push(amount);
    else this.amounts.set(at, this.amounts.at(at) + amount);
  }
  finish(weight: number): MaterialCargo | undefined {
    if (this.pairs.length === 0 || weight <= 0) return undefined;
    const result = new Float64Array(this.pairs.length * 3);
    for (let i = 0; i < this.pairs.length; i++) {
      result[i * 3] = this.pairs.first(i);
      result[i * 3 + 1] = this.pairs.second(i);
      result[i * 3 + 2] = this.amounts.at(i) / weight;
    }
    return result;
  }
}
/** Synchronous parcel helpers expose no callbacks; their finished arrays are independent. */
const parcelMixture = new CargoMixture();
export function blendCargo(
  a: MaterialCargo | undefined,
  b: MaterialCargo | undefined,
  wa: number,
  wb: number
) {
  if ((!a && !b) || wa + wb <= 0) return undefined;
  parcelMixture.clear();
  parcelMixture.add(a, wa);
  parcelMixture.add(b, wb);
  return parcelMixture.finish(wa + wb);
}
/** Selective extraction takes only the charge on that constituent. Aggregate cargo stays mixed. */
export function partitionCargo(
  cargo: MaterialCargo | undefined,
  kind: number,
  hostShare: number,
  takenShare: number
) {
  if (!cargo) return {};
  const taken = new FloatList(),
    remaining = new FloatList();
  for (let at = 0; at < cargo.length; at += 3) {
    const share =
        cargo[at + 1] === kind ? takenShare / hostShare : cargo[at + 1] === 0 ? takenShare : 0,
      lost = cargo[at + 2] * share;
    if (lost > 0) {
      taken.push(cargo[at]);
      taken.push(cargo[at + 1]);
      taken.push(lost / takenShare);
    }
    if (takenShare < 1 && cargo[at + 2] > lost) {
      remaining.push(cargo[at]);
      remaining.push(cargo[at + 1]);
      remaining.push((cargo[at + 2] - lost) / (1 - takenShare));
    }
  }
  return {
    taken: taken.length ? taken.finish() : undefined,
    remaining: remaining.length ? remaining.finish() : undefined,
  };
}

/** Coarsening can lose a minor constituent identity; its charge then belongs to the aggregate. */
export function aggregateCargo(cargo: MaterialCargo | undefined, a: number, b: number) {
  if (!cargo || retainsHosts(cargo, a, b)) return cargo;
  parcelMixture.clear();
  for (let at = 0; at < cargo.length; at += 3) {
    const host = cargo[at + 1];
    parcelMixture.addEntry(cargo[at], host === a || host === b ? host : 0, cargo[at + 2]);
  }
  return parcelMixture.finish(1);
}
function retainsHosts(cargo: MaterialCargo, a: number, b: number) {
  for (let at = 1; at < cargo.length; at += 3)
    if (cargo[at] !== 0 && cargo[at] !== a && cargo[at] !== b) return false;
  return true;
}
