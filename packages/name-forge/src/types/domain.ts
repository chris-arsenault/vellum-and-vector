import type { z } from "zod";
import type {
  PhonologyProfileSchema,
  MorphologyProfileSchema,
  StyleRulesSchema,
  NamingDomainSchema,
} from "./schema.js";

export type PhonologyProfile = z.infer<typeof PhonologyProfileSchema>;
export type MorphologyProfile = z.infer<typeof MorphologyProfileSchema>;
export type StyleRules = z.infer<typeof StyleRulesSchema>;
export type NamingDomain = z.infer<typeof NamingDomainSchema>;
