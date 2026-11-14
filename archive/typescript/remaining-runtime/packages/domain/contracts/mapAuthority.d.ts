import type { DomainSnapshot } from "./operations";
import type { GridSurface } from "./grids";
import type { AtlasFeature, World } from "./model";
import { type FeatureWorkspace, type FeatureReader } from "./featureWorkspace";
import { type NetworkReader, type NetworkWorkspace } from "./networkWorkspace";
/** A child drawing belongs to that map and its descendants, never a sibling or parent. */
export declare function mappedField(grid: GridSurface, world: World, areaId?: string): GridSurface;
/** Shared identifiers connect the drawings; creative geometry is never an inverse simulation. */
export declare function proceduralSnapshot(
  source: DomainSnapshot,
  features?: FeatureReader
): DomainSnapshot;
export declare function proceduralFeature(feature: AtlasFeature): AtlasFeature | undefined;
export declare function restoreMappedEdits(
  candidate: DomainSnapshot,
  source: DomainSnapshot,
  stores?: {
    features?: FeatureWorkspace;
    sourceFeatures?: FeatureReader;
    networks?: NetworkWorkspace;
    sourceNetworks?: NetworkReader;
  }
): void;
