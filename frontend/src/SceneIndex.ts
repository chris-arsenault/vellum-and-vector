import {
  areaSpace,
  presentAtlasFeature,
  featureIntersects,
  requireThat,
  spatial,
  rectangle,
  profiles,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import GeoJSON from "ol/format/GeoJSON.js";
import VectorSource from "ol/source/Vector.js";
import type Feature from "ol/Feature.js";
import type { AtlasFeature, World } from "./types";
import { authoredInputFeatures } from "./magicFeatures";

interface RecordEntry {
  signature: string;
  feature: AtlasFeature | null;
  indexed: Feature | null;
}
const format = new GeoJSON();
function areaContext(world: World) {
  return JSON.stringify([
    world.reference,
    Object.values(world.areas).map((a) => ({
      id: a.id,
      parentId: a.parentId,
      profile: a.profile,
      context: a.context,
      frame: a.frame,
      footprint: a.footprint,
      spaceId: a.spaceId,
    })),
  ]);
}
function presentFeature(world: World, raw: AtlasFeature, areaId: string) {
  return presentAtlasFeature(world, raw, areaId);
}
function signatures(world: World) {
  const cache = new Map<string, string>(),
    visiting = new Set<string>();
  const signature = (feature: AtlasFeature): string => {
    const previous = cache.get(feature.id);
    if (previous) return previous;
    requireThat(
      !visiting.has(feature.id),
      "binding_cycle",
      "Following relationships must be acyclic."
    );
    visiting.add(feature.id);
    const dependencies = feature.relations
      .filter((r) => r.kind === "follows")
      .map((r) => {
        const target = world.features[r.targetId];
        requireThat(
          target,
          "missing_binding",
          "A following relationship needs its source feature."
        );
        return signature(target);
      });
    const key = JSON.stringify([feature, dependencies]);
    visiting.delete(feature.id);
    cache.set(feature.id, key);
    return key;
  };
  return signature;
}
/** Composed geography is indexed once per revision; viewport queries reuse it. */
export class SceneIndex {
  private records = new Map<string, RecordEntry>();
  private source = new VectorSource({ wrapX: false });
  private world: World | null = null;
  private revision = -1;
  private context = "";
  private all: AtlasFeature[] = [];
  private magic: AtlasFeature[] = [];
  private footprint: Geometry | null = null;
  constructor(private areaId: string) {}
  update(world: World) {
    if (this.world === world && this.revision === world.version) return;
    const context = areaContext(world);
    if (context !== this.context) {
      this.records.clear();
      this.source.clear();
      this.context = context;
    }
    this.world = world;
    this.revision = world.version;
    this.footprint = world.areas[this.areaId].footprint;
    const signature = signatures(world),
      space = areaSpace(world, this.areaId);
    const wanted = new Set<string>(),
      landmarks = new Set(world.landmarks.map((landmark) => landmark.id));
    for (const feature of Object.values(world.features)) {
      if (!this.presentable(world, feature, space, landmarks)) continue;
      wanted.add(feature.id);
      this.updateFeature(world, feature, signature(feature));
    }
    for (const [id, record] of this.records)
      if (!wanted.has(id)) {
        if (record.indexed) this.source.removeFeature(record.indexed);
        this.records.delete(id);
      }
    this.all = [...this.records.values()].flatMap((r) => (r.feature ? [r.feature] : []));
    this.magic = authoredInputFeatures(world, this.areaId, this.footprint);
    this.all.push(...this.magic);
  }
  /** Features of this space at or above this profile; a landmark's realization is read with its record. */
  private presentable(world: World, feature: AtlasFeature, space: string, landmarks: Set<string>) {
    if (landmarks.has(feature.id) || areaSpace(world, feature.areaId) !== space) return false;
    return (
      profiles.indexOf(world.areas[feature.areaId].profile) <=
      profiles.indexOf(world.areas[this.areaId].profile)
    );
  }
  private updateFeature(world: World, raw: AtlasFeature, signature: string) {
    const previous = this.records.get(raw.id);
    if (previous?.signature === signature) return;
    if (previous?.indexed) this.source.removeFeature(previous.indexed);
    const feature = presentFeature(world, raw, this.areaId);
    const indexed = feature
      ? (format.readFeature({
          type: "Feature",
          id: feature.id,
          geometry: feature.footprint
            ? { type: "GeometryCollection", geometries: [feature.geometry, feature.footprint] }
            : feature.geometry,
          properties: { presented: feature },
        }) as Feature)
      : null;
    if (indexed) this.source.addFeature(indexed);
    this.records.set(raw.id, { signature, feature, indexed });
  }
  read(extent?: number[]) {
    if (!extent) return this.all;
    const box = rectangle(extent as [number, number, number, number]);
    const covered = spatial.covers(this.footprint!, box);
    const footprint = covered ? box : spatial.intersection(this.footprint!, box);
    if (!footprint) return [];
    const result = this.source
      .getFeaturesInExtent(extent)
      .filter(
        (f) =>
          f.getGeometry()!.intersectsExtent(extent) &&
          (covered || featureIntersects(f.get("presented"), footprint))
      )
      .map((f) => f.get("presented") as AtlasFeature);
    return [...result, ...this.magic.filter((f) => spatial.intersects(f.geometry, footprint))];
  }
}
