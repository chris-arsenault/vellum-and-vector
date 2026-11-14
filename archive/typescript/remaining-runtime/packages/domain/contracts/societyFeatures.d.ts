import type { AtlasFeature } from "./model";
import type { SocietyWorkKind } from "./society";
export declare const societyWorkLayers: Record<SocietyWorkKind, string>;
/** Legacy authored works remain editable; newly published works use their concrete kind. */
export declare function isSocietyWork(feature: Pick<AtlasFeature, "kind" | "attributes">): boolean;
