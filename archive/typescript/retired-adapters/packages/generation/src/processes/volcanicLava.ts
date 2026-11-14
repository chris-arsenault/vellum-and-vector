import { CellQueue, MapScale, type Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { workingArray, releaseWorking } from "../world/physicalNumerics";
import { meshDeltaX } from "../world/mesh";
import { Feature } from "../world/codes";
import { clamp } from "../world/math";
import { groundOf } from "../rock/ground";
import { constructMaterial } from "../rock/groundLedger";
import { materialLayer } from "../rock/rockColumn";
import { rockCatalogue } from "../rock/rockCatalogue";
import { pondLevel } from "../rock/groundDeposition";
import { lavaOffer, lavaYieldGradient, mobileLavaShare } from "./lavaRouting";

interface Eruption {
  source: number;
  volume: number;
  pending: number;
  radius: number;
}
/**
 * A connected, coarse lava pulse. Mobile head and cooling are process work; only owner emplacement
 * becomes ground. Facet shares have no subcell edge positions, so routing resolves cell adjacency.
 */
export class VolcanicLava {
  private readonly ground;
  private readonly mobile: Band;
  private readonly heat: Band;
  private readonly queued: Band;
  private readonly queue = new CellQueue();
  private readonly neighbors: Int32Array;
  private readonly offers: Float64Array;
  private readonly lengths: Float64Array;
  constructor(
    private readonly map: PhysicalField,
    private readonly context: PhysicalContext
  ) {
    this.ground = groundOf(map);
    this.mobile = workingArray(map, "float64", "lava:mobile");
    this.heat = workingArray(map, "float64", "lava:heat");
    this.queued = workingArray(map, "uint8", "lava:queued");
    this.neighbors = new Int32Array(map.mesh.stride);
    this.offers = new Float64Array(map.mesh.stride);
    this.lengths = new Float64Array(map.mesh.stride);
  }
  /** Fresh supply is in cubic metres. Unemplaced supply retries locally; its thermal history is
   * unresolved, so it has no inherited mobility or formed-rock age before owner admission. */
  erupt(source: number, freshVolume: number): Eruption {
    const result: Eruption = { source, volume: 0, pending: 0, radius: 0 };
    if (source < 0 || freshVolume <= 0) return result;
    const stored =
      MapScale.metres(this.map.VolcanicMeltSupply.get(source), "native") *
      this.map.mesh.area(source);
    this.map.VolcanicMeltSupply.set(source, 0);
    this.solidify(source, stored, result);
    this.add(source, freshVolume, this.context.Profile.LavaCoolingDistance);
    for (let cell = this.queue.shift(); cell >= 0; cell = this.queue.shift()) {
      this.queued.set(cell, 0);
      this.advance(cell, result);
    }
    return result;
  }
  release() {
    releaseWorking(this.map, this.mobile, this.heat, this.queued);
  }
  private add(cell: number, volume: number, mobility: number) {
    if (volume <= 0) return;
    this.mobile.add(cell, volume);
    this.heat.add(cell, volume * mobility);
    if (this.queued.get(cell)) return;
    this.queued.set(cell, 1);
    this.queue.push(cell);
  }
  private level(cell: number, volume: number) {
    return pondLevel(
      MapScale.metres(this.ground.surface(cell, "land"), "native"),
      this.ground.share(cell, "land"),
      MapScale.metres(this.ground.surface(cell, "cut"), "native"),
      this.ground.share(cell, "cut"),
      volume / this.map.mesh.area(cell)
    );
  }
  private destinations(cell: number, volume: number, mobility: number) {
    const mesh = this.map.mesh,
      head = this.level(cell, volume),
      yieldGradient = lavaYieldGradient(
        this.context.Profile.LavaYieldHeight,
        volume / mesh.area(cell)
      );
    let count = 0,
      offered = 0,
      shortest = Infinity;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const neighbor = mesh.neighbor(cell, edge),
        distance = mesh.edgeLength(cell, edge);
      if (neighbor < 0 || distance <= 0 || distance >= mobility) continue;
      const amount = lavaOffer(
        head,
        this.level(neighbor, this.mobile.get(neighbor)),
        distance,
        mesh.area(cell),
        mesh.area(neighbor),
        yieldGradient
      );
      if (amount <= 0) continue;
      this.neighbors[count] = neighbor;
      this.offers[count] = amount;
      this.lengths[count++] = distance;
      offered += amount;
      shortest = Math.min(shortest, distance);
    }
    return { count, offered, shortest };
  }
  private advance(cell: number, result: Eruption) {
    const volume = this.mobile.get(cell);
    if (volume <= 0) return;
    const mobility = this.heat.get(cell) / volume,
      { count, offered, shortest } = this.destinations(cell, volume, mobility),
      // Each crossing consumes part of the pulse's remaining thermal mobility.
      movable = count ? volume * mobileLavaShare(shortest, mobility) : 0,
      scale = offered > 0 ? Math.min(1, movable / offered) : 0;
    this.mobile.set(cell, 0);
    this.heat.set(cell, 0);
    let moved = 0;
    for (let n = 0; n < count; n++) {
      const amount = this.offers[n] * scale;
      moved += amount;
      this.add(this.neighbors[n], amount, mobility - this.lengths[n]);
    }
    this.solidify(cell, Math.max(0, volume - moved), result);
  }
  private solidify(cell: number, volume: number, result: Eruption) {
    if (volume <= 0) return;
    const level = this.level(cell, volume),
      material = materialLayer(rockCatalogue.basalt.code, 0, {}, this.map.CompletedEpochCount);
    let accepted = 0;
    for (const facet of ["land", "cut"] as const) {
      if (this.ground.share(cell, facet) <= 0) continue;
      const depth = Math.max(
        0,
        MapScale.inUnits(level, "native") - this.ground.surface(cell, facet)
      );
      if (depth <= 0) continue;
      accepted += constructMaterial(
        this.map,
        cell,
        { ...material, depth },
        "volcanoes",
        "melt",
        facet
      );
    }
    const landed = MapScale.metres(accepted, "native") * this.map.mesh.area(cell),
      pending = Math.max(0, volume - landed);
    this.map.VolcanicMeltSupply.add(
      cell,
      MapScale.inUnits(pending / this.map.mesh.area(cell), "native")
    );
    result.pending += pending;
    result.volume += landed;
    if (landed <= 0) return;
    this.mark(cell, accepted, result);
  }
  private mark(cell: number, accepted: number, result: Eruption) {
    const map = this.map,
      activity = clamp(MapScale.metres(accepted, "native") / map.scale.length(0.00000025), 0, 1000),
      distance = Math.hypot(
        meshDeltaX(map.mesh, map.mesh.x(cell) - map.mesh.x(result.source)),
        map.mesh.y(cell) - map.mesh.y(result.source)
      );
    result.radius = Math.max(result.radius, distance + map.scale.cells(0.5));
    map.VolcanicConstructionHistory.add(cell, accepted);
    map.VolcanicActivity.set(cell, Math.max(map.VolcanicActivity.get(cell), activity));
    map.VolcanicLastActiveEpoch.set(cell, Math.max(0, this.context.EpochIndex));
    map.FractureConductance.set(cell, Math.max(map.FractureConductance.get(cell), activity * 0.7));
    map.FeatureFlags.set(
      cell,
      map.FeatureFlags.get(cell) |
        Feature.LavaPlain |
        (cell === result.source ? Feature.VolcanicCone : 0)
    );
  }
}
