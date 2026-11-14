import { z } from "zod";
import { type MagicSystem } from "./magicSystems";
/**
 * What a meeting does to the ground where it holds, scaled by its coverage in the cell.
 * Each field is a process on an existing physical channel, never a blend of the parents.
 */
export declare const confluenceEffectsSchema: z.ZodObject<
  {
    fractureConductance: z.ZodDefault<z.ZodNumber>;
    rockResistance: z.ZodDefault<z.ZodNumber>;
    relief: z.ZodDefault<z.ZodNumber>;
    soilRemoval: z.ZodDefault<z.ZodNumber>;
    coastalForcing: z.ZodDefault<z.ZodNumber>;
    fog: z.ZodDefault<z.ZodNumber>;
    iceMelt: z.ZodDefault<z.ZodNumber>;
    debris: z.ZodDefault<z.ZodNumber>;
    toxicity: z.ZodDefault<z.ZodNumber>;
  },
  z.core.$strip
>;
export declare const confluenceHazardSchema: z.ZodObject<
  {
    kind: z.ZodString;
    rate: z.ZodNumber;
    severity: z.ZodNumber;
    radius: z.ZodNumber;
    cause: z.ZodString;
  },
  z.core.$strip
>;
/**
 * A meeting of two or more systems as a process of its own: where its conditions hold and
 * every parent reaches the coverage floor, it takes coverage from the parents in proportion
 * to the strain between them and acts on the physical fields with its own effects.
 */
export declare const magicConfluenceSchema: z.ZodObject<
  {
    lengthUnits: z.ZodDefault<z.ZodLiteral<"relative">>;
    id: z.ZodString;
    name: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    systems: z.ZodArray<z.ZodString>;
    floor: z.ZodDefault<z.ZodNumber>;
    strainScale: z.ZodDefault<z.ZodNumber>;
    priority: z.ZodDefault<z.ZodNumber>;
    cartography: z.ZodOptional<
      z.ZodEnum<{
        area: "area";
        site: "site";
        course: "course";
      }>
    >;
    seeds: z.ZodArray<
      z.ZodArray<
        z.ZodObject<
          {
            field: z.ZodString;
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
            values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            salt: z.ZodOptional<z.ZodNumber>;
            index: z.ZodOptional<z.ZodNumber>;
          },
          z.core.$strip
        >
      >
    >;
    retains: z.ZodOptional<
      z.ZodArray<
        z.ZodArray<
          z.ZodObject<
            {
              field: z.ZodString;
              min: z.ZodOptional<z.ZodNumber>;
              max: z.ZodOptional<z.ZodNumber>;
              values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
              salt: z.ZodOptional<z.ZodNumber>;
              index: z.ZodOptional<z.ZodNumber>;
            },
            z.core.$strip
          >
        >
      >
    >;
    effects: z.ZodPrefault<
      z.ZodObject<
        {
          fractureConductance: z.ZodDefault<z.ZodNumber>;
          rockResistance: z.ZodDefault<z.ZodNumber>;
          relief: z.ZodDefault<z.ZodNumber>;
          soilRemoval: z.ZodDefault<z.ZodNumber>;
          coastalForcing: z.ZodDefault<z.ZodNumber>;
          fog: z.ZodDefault<z.ZodNumber>;
          iceMelt: z.ZodDefault<z.ZodNumber>;
          debris: z.ZodDefault<z.ZodNumber>;
          toxicity: z.ZodDefault<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    groundMaterial: z.ZodOptional<
      z.ZodEnum<{
        sinter: "sinter";
        crushstone: "crushstone";
        rootstone: "rootstone";
        rimerot: "rimerot";
        tufa: "tufa";
        saltGlass: "saltGlass";
        tornstone: "tornstone";
        saltbed: "saltbed";
      }>
    >;
    hazard: z.ZodOptional<
      z.ZodObject<
        {
          kind: z.ZodString;
          rate: z.ZodNumber;
          severity: z.ZodNumber;
          radius: z.ZodNumber;
          cause: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type MagicConfluence = z.infer<typeof magicConfluenceSchema>;
export type ConfluenceEffects = z.infer<typeof confluenceEffectsSchema>;
/**
 * Conditions a confluence may read: systems' intensities and physical fields only, never a
 * channel of its own. A confluence that names a system the world lacks is allowed and simply
 * never holds, so the preset meetings travel with any system list.
 */
export declare function validateMagicConfluences(
  confluences: MagicConfluence[],
  systems: MagicSystem[]
): void;
/** Whether every system a confluence reads is present and enabled. */
export declare function confluenceEffective(
  confluence: Pick<MagicConfluence, "enabled" | "systems">,
  systems: Pick<MagicSystem, "id" | "enabled">[]
): boolean;
/**
 * The bible's three meetings among Fire, Aurora and Pressure. Ids keep the names the
 * surface palette and saved maps already know (war, steam, breach).
 */
export declare function canonryConfluencePresets(): MagicConfluence[];
