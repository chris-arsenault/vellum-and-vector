import { z } from "zod";
export declare const cartographicMarkSchema: z.ZodEnum<{
  auto: "auto";
  town: "town";
  castle: "castle";
  ruin: "ruin";
  tree: "tree";
  mountain: "mountain";
}>;
export declare const cartographicOverrideSchema: z.ZodObject<
  {
    hidden: z.ZodOptional<z.ZodBoolean>;
    illustrationHidden: z.ZodOptional<z.ZodBoolean>;
    labelHidden: z.ZodOptional<z.ZodBoolean>;
    symbol: z.ZodOptional<
      z.ZodEnum<{
        auto: "auto";
        town: "town";
        castle: "castle";
        ruin: "ruin";
        tree: "tree";
        mountain: "mountain";
      }>
    >;
    anchor: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    path: z.ZodOptional<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>>;
    offsetX: z.ZodOptional<z.ZodNumber>;
    offsetY: z.ZodOptional<z.ZodNumber>;
    rotation: z.ZodOptional<z.ZodNumber>;
    size: z.ZodOptional<z.ZodNumber>;
  },
  z.core.$strip
>;
export declare const cartographicPresentationSchema: z.ZodObject<
  {
    mode: z.ZodEnum<{
      drawn: "drawn";
      raster: "raster";
    }>;
    style: z.ZodEnum<{
      wash: "wash";
      ink: "ink";
    }>;
    subject: z.ZodEnum<{
      physical: "physical";
      political: "political";
      cultural: "cultural";
      infrastructure: "infrastructure";
    }>;
    terrain: z.ZodBoolean;
    clip: z.ZodBoolean;
    labels: z.ZodBoolean;
    density: z.ZodNumber;
    fields: z.ZodArray<z.ZodString>;
    overrides: z.ZodRecord<
      z.ZodString,
      z.ZodObject<
        {
          hidden: z.ZodOptional<z.ZodBoolean>;
          illustrationHidden: z.ZodOptional<z.ZodBoolean>;
          labelHidden: z.ZodOptional<z.ZodBoolean>;
          symbol: z.ZodOptional<
            z.ZodEnum<{
              auto: "auto";
              town: "town";
              castle: "castle";
              ruin: "ruin";
              tree: "tree";
              mountain: "mountain";
            }>
          >;
          anchor: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
          path: z.ZodOptional<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>>;
          offsetX: z.ZodOptional<z.ZodNumber>;
          offsetY: z.ZodOptional<z.ZodNumber>;
          rotation: z.ZodOptional<z.ZodNumber>;
          size: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    sheet: z.ZodObject<
      {
        title: z.ZodString;
        subtitle: z.ZodString;
        frame: z.ZodBoolean;
        legend: z.ZodBoolean;
        compass: z.ZodBoolean;
        scale: z.ZodBoolean;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export type CartographicPresentation = z.infer<typeof cartographicPresentationSchema>;
export type CartographicOverride = z.infer<typeof cartographicOverrideSchema>;
export type CartographicMark = z.infer<typeof cartographicMarkSchema>;
export declare function defaultCartographicPresentation(): CartographicPresentation;
