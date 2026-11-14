import { z } from "zod";
import { isLivelihood } from "./societyPractices";

/** The described residents stored on a map feature, independent of editing operations. */
export const populationGroupsSchema = z.array(
  z
    .object({
      people: z.string().min(1),
      culture: z.string().nullable(),
      languages: z.array(z.string()),
      namingLanguage: z.string().nullable().optional(),
      languageShares: z
        .record(
          z.string().min(1),
          z.object({
            knowledge: z.number().finite().min(0).max(1),
            use: z.number().finite().min(0).max(1),
          })
        )
        .optional(),
      religions: z.array(z.string()),
      practices: z.array(z.string()),
      practiceShares: z.record(z.string().min(1), z.number().finite().min(0).max(1)).optional(),
      count: z.number().finite().nonnegative(),
    })
    .refine(
      (group) =>
        !group.practiceShares ||
        (Object.keys(group.practiceShares).every((id) => group.practices.includes(id)) &&
          group.practices.every((id) => Object.hasOwn(group.practiceShares!, id)) &&
          Object.entries(group.practiceShares)
            .filter(([id]) => isLivelihood(id))
            .reduce((sum, [, share]) => sum + share, 0) <=
            1 + 1e-12),
      {
        message:
          "Practice shares must cover the listed practices; livelihood shares cannot total more than 100%.",
        path: ["practiceShares"],
      }
    )
    .refine((group) => !group.namingLanguage || group.languages.includes(group.namingLanguage), {
      message: "The naming language must be one of the group's known languages.",
      path: ["namingLanguage"],
    })
    .refine(
      (group) =>
        !group.languageShares ||
        (Object.entries(group.languageShares).every(
          ([id, share]) => group.languages.includes(id) && share.use <= share.knowledge + 1e-12
        ) &&
          group.languages.every((id) => Object.hasOwn(group.languageShares!, id)) &&
          Object.values(group.languageShares).reduce((sum, share) => sum + share.use, 0) <=
            1 + 1e-12),
      {
        message:
          "Language shares must cover the listed languages; naming use cannot exceed knowledge or total 100%.",
        path: ["languageShares"],
      }
    )
);
