import { z } from "zod";
import { type IntentContext, type IntentRegistry } from "./intent";
import type { DomainSnapshot, ChangeSet } from "./operations";
import type { Area, AtlasFeature, World } from "./model";
export declare const featureEditSchema: z.ZodObject<
  {
    areaId: z.ZodUUID;
    feature: z.ZodObject<
      {
        id: z.ZodUUID;
        name: z.ZodString;
        kind: z.ZodString;
        layerId: z.ZodString;
        geometry: z.ZodType<
          import("geojson").Geometry,
          unknown,
          z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
        >;
        footprint: z.ZodOptional<
          z.ZodType<
            import("geojson").Geometry,
            unknown,
            z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
          >
        >;
        attributes: z.ZodCustom<
          Record<string, import("./schemas").Value>,
          Record<string, import("./schemas").Value>
        >;
        relations: z.ZodDefault<
          z.ZodArray<
            z.ZodObject<
              {
                targetId: z.ZodUUID;
                kind: z.ZodString;
              },
              z.core.$strip
            >
          >
        >;
        protected: z.ZodOptional<z.ZodBoolean>;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export type FeatureEdit = z.infer<typeof featureEditSchema>;
export declare function featureRequirements(
  data: FeatureEdit,
  context: IntentContext
): import("./operations").ReadRequirements;
export declare function featureEditContext(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot
): {
  area: Area;
  layer: import("./model").Layer;
  geometry: import("geojson").Geometry;
  previous: AtlasFeature;
};
export declare function evaluateFeature(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot,
  options?: {
    reconcile?: boolean;
    deferComposition?: boolean;
    reconcileOwnBoundary?: boolean;
  }
): ChangeSet;
export declare function validateFeatureComposition(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  ids: string[]
): string[];
export declare function validateDependentContracts(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  changes: ChangeSet,
  candidate?: World
): void;
export declare function registerFeatureIntents(registry: IntentRegistry): void;
