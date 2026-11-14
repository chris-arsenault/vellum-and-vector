import { z } from "zod";
export const finite = z.number().finite();
export const frameSchema = z.object({
  origin: z.object({ x: finite, y: finite, z: finite }),
  rotation: finite,
  metresPerUnit: finite.positive(),
  floor: z.string().nullable(),
});
