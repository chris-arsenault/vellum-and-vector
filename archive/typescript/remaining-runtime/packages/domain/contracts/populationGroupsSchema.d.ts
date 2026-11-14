import { z } from "zod";
/** The described residents stored on a map feature, independent of editing operations. */
export declare const populationGroupsSchema: z.ZodArray<
  z.ZodObject<
    {
      people: z.ZodString;
      culture: z.ZodNullable<z.ZodString>;
      languages: z.ZodArray<z.ZodString>;
      namingLanguage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
      languageShares: z.ZodOptional<
        z.ZodRecord<
          z.ZodString,
          z.ZodObject<
            {
              knowledge: z.ZodNumber;
              use: z.ZodNumber;
            },
            z.core.$strip
          >
        >
      >;
      religions: z.ZodArray<z.ZodString>;
      practices: z.ZodArray<z.ZodString>;
      practiceShares: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
      count: z.ZodNumber;
    },
    z.core.$strip
  >
>;
