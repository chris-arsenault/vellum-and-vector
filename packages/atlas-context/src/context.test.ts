import { describe, expect, it, vi } from "vitest";
import type { MapEditing, MapLibrary, MapReader, MapNavigation } from "@atlas/map";
import type { GenerationService } from "./generation";
import { createAtlasContext, type ContextServices } from "./context";

// Supplied service identities: these tests observe host initialization, not map I/O.
const suppliedServices = async (): Promise<ContextServices<{ seed: number }>> => ({
  maps: {} as MapReader,
  navigation: {} as MapNavigation,
  editing: {} as MapEditing,
  library: {} as MapLibrary,
  generation: {} as GenerationService<{ seed: number }>,
  contexts: {} as ContextServices<{ seed: number }>["contexts"],
  dispose: async () => {},
});

describe("one pure atlas host", () => {
  it.each(["browser", "backend"] as const)("initializes only %s", async (mode) => {
    const factories = { browser: vi.fn(suppliedServices), backend: vi.fn(suppliedServices) };
    const context = await createAtlasContext(mode, factories);
    expect(context.mode).toBe(mode);
    expect(factories[mode]).toHaveBeenCalledOnce();
    expect(factories[mode === "browser" ? "backend" : "browser"]).not.toHaveBeenCalled();
  });

  it("reports backend failure without creating a local map or generator", async () => {
    const factories = {
      browser: vi.fn(suppliedServices),
      backend: vi.fn().mockRejectedValue(new Error("LAN unavailable")),
    };
    await expect(createAtlasContext("backend", factories)).rejects.toThrow("LAN unavailable");
    expect(factories.browser).not.toHaveBeenCalled();
  });
});
