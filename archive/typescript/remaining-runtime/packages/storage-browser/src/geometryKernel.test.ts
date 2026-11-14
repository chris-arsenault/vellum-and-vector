import { expect, it } from "vitest";
import { GeometryKernel } from "./geometryKernel";

it("retains explicit zero height and directed line order through binary storage", async () => {
  const kernel = await GeometryKernel.create();
  try {
    const geometry = {
      type: "LineString" as const,
      coordinates: [
        [3000, 2000, 0],
        [1000, 1000, 7],
      ],
    };
    const encoded = kernel.encode(geometry, 0.000001);
    expect(kernel.decode(encoded.bytes)).toEqual(geometry);
    expect(encoded.bounds).toEqual([1000, 1000, 3000, 2000]);
  } finally {
    kernel.close();
  }
});
