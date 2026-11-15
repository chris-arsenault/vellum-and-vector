import { Encoder } from "cbor-x";
import { afterEach, expect, it, vi } from "vitest";
import { HttpGeneration } from "./httpGeneration";

afterEach(() => vi.unstubAllGlobals());

it("decodes native uint64 configuration values as numbers for recipe review", async () => {
  // Native CBOR encodes this default density as uint64, despite it fitting JS Number.
  const response = new Encoder({ useRecords: false }).encode({
    saltMaterialDensity: 8_000_000_000n,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(response))));
  const generation = new HttpGeneration<{ saltMaterialDensity: number }>("http://atlas/");
  const configuration = await generation.configuration({ mapId: "map", revision: "revision" });

  expect(configuration.saltMaterialDensity).toBe(8_000_000_000);
  expect(JSON.stringify(configuration)).toBe('{"saltMaterialDensity":8000000000}');
});
