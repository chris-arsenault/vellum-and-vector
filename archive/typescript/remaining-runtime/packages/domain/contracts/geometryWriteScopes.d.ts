import type { DomainSnapshot } from "./operations";
import type { World } from "./model";
export declare function validateGeometryWriteScopes(
  source: DomainSnapshot,
  candidate: World,
  features: string[]
): void;
