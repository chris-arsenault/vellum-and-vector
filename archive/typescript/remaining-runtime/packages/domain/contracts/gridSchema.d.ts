import { z } from "zod";
import { type ResourceType } from "./schemas";
import type { Grid } from "./grids";
export declare const gridSchema: z.ZodType<Grid>;
export declare const gridType: ResourceType<Grid>;
