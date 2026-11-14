import { MapScale, FloatList, IntPairIndex, type Column } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { MagicInventory } from "../world/magicInventory";
import { materialLayer, readLayer, layerDepth, columnSize, finiteColumn } from "./rockColumn";
import { coverColumn, facetShare, columnThickness } from "./groundShares";
import { constructMaterial } from "./groundConstruction";
import { units } from "../world/math";
import type { FlowCause } from "../coupling/flows";
import type { MaterialLayer } from "./rockLayerFields";
import { writeCargo, hasCargo, cargoRevision, readCargoDensity } from "./groundCargo";
import { extractGround } from "./groundLedger";
import type { GroundExtraction } from "./groundExtraction";
import type { MaterialReceiver } from "./groundMaterial";
import { loadOf } from "./groundLoad";
import { cargoIdentity } from "./groundCargoIdentity";
export function cargoDensity(layer: Pick<MaterialLayer, "cargo">, key: number, host?: number) {
  let density = 0;
  const cargo = layer.cargo;
  if (cargo)
    for (let at = 0; at < cargo.length; at += 3)
      if (cargo[at] === key && (host === undefined || cargo[at + 1] === host))
        density += cargo[at + 2];
  return density;
}

/** Live inventory of one reservoir in actual material. Scalar writes can spend charge, never create a host. */
export class GroundInventory implements MagicInventory {
  private cached?: { cells: IntPairIndex; values: FloatList; revisions: FloatList };
  readonly key: number;
  readonly length: number;
  constructor(
    readonly map: PhysicalField,
    readonly name: string,
    releasedTo?: string
  ) {
    this.key = cargoIdentity(map, name, releasedTo);
    this.length = map.mesh.count;
  }
  get(cell: number) {
    if (!hasCargo(this.map, cell)) return 0;
    const cache = (this.cached ??= {
        cells: new IntPairIndex(),
        values: new FloatList(),
        revisions: new FloatList(),
      }),
      at = cache.cells.include(cell, 0),
      revision = cargoRevision(this.map, cell);
    if (at === cache.values.length) {
      cache.values.push(0);
      cache.revisions.push(-1);
    }
    if (cache.revisions.at(at) !== revision) {
      cache.values.set(at, this.reached(cell, Infinity));
      cache.revisions.set(at, revision);
    }
    return cache.values.at(at);
  }
  reached(cell: number, reach: number) {
    if (!hasCargo(this.map, cell)) return 0;
    let amount = 0;
    for (const facet of ["land", "cut"] as const) {
      const share = facetShare(this.map, cell, facet);
      if (share <= 0) continue;
      const cover = coverColumn(facet),
        under = reach - columnThickness(this.map, cell, cover);
      amount +=
        share *
        (reachedColumn(this.map, cell, cover, reach, this.key) +
          reachedColumn(this.map, cell, facet, under, this.key));
    }
    return amount * this.map.mesh.area(cell);
  }
  set(cell: number, wanted: number) {
    const held = this.get(cell);
    if (held <= 0) return;
    const ratio = Math.max(0, wanted) / held;
    this.visit(cell, (layer, slot, column) => {
      if (!layer.cargo || cargoDensity(layer, this.key) <= 0) return;
      const cargo = layer.cargo.slice();
      for (let at = 0; at < cargo.length; at += 3)
        if (cargo[at] === this.key) cargo[at + 2] *= ratio;
      writeCargo(this.map, cell, slot, column, cargo);
    });
  }
  add(cell: number, amount: number) {
    this.set(cell, this.get(cell) + amount);
  }
  /** Exchange charge with reached material only; buried intervals retain their own inventory. */
  release(cell: number, reach: number, fraction: (layer: MaterialLayer) => number) {
    if (!hasCargo(this.map, cell)) return 0;
    let released = 0;
    for (const facet of ["land", "cut"] as const) {
      const area = this.map.mesh.area(cell) * facetShare(this.map, cell, facet);
      if (area <= 0) continue;
      alterGround(this.map, cell, {
        depth: reach,
        facet,
        retainedOnly: true,
        transform: (layer) => {
          if (!layer.cargo || cargoDensity(layer, this.key) <= 0) return layer;
          const share = Math.max(0, Math.min(1, fraction(layer))),
            cargo = layer.cargo.slice();
          if (share <= 0) return layer;
          for (let at = 0; at < cargo.length; at += 3)
            if (cargo[at] === this.key) {
              released += cargo[at + 2] * share * MapScale.metres(layer.depth, "native") * area;
              cargo[at + 2] *= 1 - share;
            }
          return { ...layer, cargo };
        },
      });
    }
    return released;
  }
  transfer(cell: number, amount: number, target: GroundInventory) {
    const available = this.get(cell),
      moved = Math.min(available, Math.max(0, amount));
    if (moved <= 0) return 0;
    this.visit(cell, (layer, slot, column) =>
      writeCargo(
        this.map,
        cell,
        slot,
        column,
        rekeyCargo(layer.cargo, this.key, target.key, moved / available)
      )
    );
    return moved;
  }
  /** Physical extraction removes the carrier and returns its charge in the same receipt. */
  extract(
    cell: number,
    amount: number,
    access: Pick<GroundExtraction, "reach" | "surfaceOnly" | "looseOnly">,
    receive?: MaterialReceiver
  ) {
    let remaining = amount;
    const area = this.map.mesh.area(cell);
    extractGround(
      this.map,
      cell,
      {
        ...access,
        kind: (layer) =>
          [layer.kind, layer.secondaryKind].filter(
            (kind, i, kinds) =>
              kinds.indexOf(kind) === i &&
              (cargoDensity(layer, this.key, kind) > 0 || cargoDensity(layer, this.key, 0) > 0)
          ),
        amount: Infinity,
        select: (layer, areaShare, kind) => {
          const share =
              (layer.kind === kind ? 1 - layer.secondaryShare : 0) +
              (layer.secondaryKind === kind ? layer.secondaryShare : 0),
            density =
              cargoDensity(layer, this.key, kind) + cargoDensity(layer, this.key, 0) * share;
          return density > 0
            ? units((Math.max(0, remaining) * share) / (density * area * areaShare))
            : 0;
        },
      },
      "magic extraction",
      "load",
      (material) => {
        remaining -=
          cargoDensity(material, this.key) * MapScale.metres(material.depth, "native") * area;
        if (receive) receive(material);
        else
          loadOf(this.map).add(cell, {
            ...material,
            depth: MapScale.metres(material.depth, "native") * area,
          });
      }
    );
    return amount - remaining;
  }
  /** An actual admitted new body receives its cargo before any mixing or burial. */
  construct(cell: number, amount: number, depth: number, kind: number, cause: FlowCause) {
    if (amount <= 0 || depth <= 0) return;
    const density = amount / (MapScale.metres(depth, "native") * this.map.mesh.area(cell));
    constructMaterial(
      this.map,
      cell,
      materialLayer(
        kind,
        depth,
        {
          cargo: new Float64Array([this.key, kind, density]),
        },
        this.map.CompletedEpochCount
      ),
      cause,
      "space"
    );
  }
  /** New charge enters only the reached retained host selected by the source's material action. */
  charge(
    cell: number,
    amount: number,
    reach: number,
    hosts: readonly number[],
    from: "surface" | "rock" = "surface",
    start = 0
  ) {
    const area = this.map.mesh.area(cell);
    let volume = 0;
    this.visit(cell, (layer, _slot, column, share, top) => {
      if (from === "rock" && column !== "land" && column !== "cut") return;
      const offset =
        from === "rock"
          ? columnThickness(this.map, cell, coverColumn(column as "land" | "cut"))
          : 0;
      if (hosts.includes(layer.kind))
        volume +=
          MapScale.metres(
            Math.max(
              0,
              Math.min(top - offset + layer.depth, start + reach) - Math.max(top - offset, start)
            ),
            "native"
          ) *
          area *
          share;
    });
    if (volume <= 0 || amount <= 0) return 0;
    // Partial host intervals are split by the same Ground alteration operation used by physical reactions.
    alterGround(this.map, cell, {
      depth: reach,
      offset: start,
      from,
      retainedOnly: true,
      transform: (layer) => {
        if (!hosts.includes(layer.kind)) return layer;
        const extra = new Float64Array([this.key, layer.kind, amount / volume]);
        return {
          ...layer,
          cargo: blendCargo(layer.cargo, extra, 1, 1)?.map((value, i) =>
            i % 3 === 2 ? value * 2 : value
          ),
        };
      },
    });
    return amount;
  }
  private visit(
    cell: number,
    action: (layer: MaterialLayer, slot: number, column: Column, share: number, top: number) => void
  ) {
    for (const facet of ["land", "cut"] as const) {
      const share = facetShare(this.map, cell, facet);
      if (share <= 0) continue;
      let top = 0;
      for (const column of [coverColumn(facet), facet])
        for (let slot = 0; slot < columnSize(column); slot++) {
          const layer = readLayer(this.map, cell, slot, column);
          if (layer.depth <= 0) break;
          const basement =
              column === facet &&
              (slot + 1 === columnSize(column) ||
                layerDepth(this.map, cell, slot + 1, column) <= 0),
            finite = basement ? { ...layer, depth: Math.max(0, layer.depth - 1) } : layer;
          action(finite, slot, column, share, top);
          top += layer.depth;
        }
    }
  }
}

/** Reached charge per square metre; unbounded basement markers never carry inventory. */
function reachedColumn(
  map: PhysicalField,
  cell: number,
  column: Column,
  reach: number,
  key: number
) {
  let amount = 0,
    remaining = reach;
  for (let slot = 0; slot < columnSize(column) && remaining > 0; slot++) {
    const thickness = layerDepth(map, cell, slot, column);
    if (thickness <= 0) break;
    const basement =
        !finiteColumn(column) &&
        (slot + 1 === columnSize(column) || layerDepth(map, cell, slot + 1, column) <= 0),
      depth = Math.min(remaining, Math.max(0, thickness - Number(basement)));
    amount += MapScale.metres(depth, "native") * readCargoDensity(map, cell, slot, column, key);
    remaining -= thickness;
  }
  return amount;
}
import { alterGround } from "./groundAlteration";
import { blendCargo, rekeyCargo } from "./materialCargo";
