import { z } from "zod";
import type { AtlasFeature } from "./model";
export { populationGroupsSchema } from "./populationGroupsSchema";
export declare const societyWorkAttributesSchema: z.ZodObject<
  {
    workKind: z.ZodEnum<{
      pass: "pass";
      harbor: "harbor";
      ford: "ford";
      bridge: "bridge";
      mill: "mill";
      dam: "dam";
      weir: "weir";
      irrigation: "irrigation";
      clearance: "clearance";
      burning: "burning";
      hunting: "hunting";
      conservation: "conservation";
      tapping: "tapping";
      quarrying: "quarrying";
      "fire-forge": "fire-forge";
      "aurora-archive": "aurora-archive";
      "pressure-diving": "pressure-diving";
    }>;
    radius: z.ZodNumber;
    magnitude: z.ZodNumber;
  },
  z.core.$strip
>;
/** A work a creator draws or edits must say what it is, how far it reaches and how strong it is. */
export declare function checkAuthoredWork(feature: AtlasFeature): void;
/**
 * A creator who changes a settlement's groups or its population changes the other with it:
 * the record's resident totals are kept in step on the record itself.
 */
export declare function editMappedResidents(
  feature: AtlasFeature,
  before: Pick<AtlasFeature, "attributes">
): void;
