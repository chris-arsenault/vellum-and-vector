import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias:
      mode === "workspace" || mode === "browser"
        ? ["./rasterLayers", "./drawnMap"].map((find) => ({
            find,
            replacement: fileURLToPath(new URL("./tests/scenarioRendering.ts", import.meta.url)),
          }))
        : [],
  },
  build:
    mode === "workspace" || mode === "browser"
      ? {
          rolldownOptions: {
            input: [
              "index.html",
              "tests/fixtureMap.html",
              ...(mode === "workspace" ? ["tests/workspace.html"] : []),
            ],
          },
        }
      : undefined,
}));
