import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const buildSha =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  }).trim();

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { "import.meta.env.VITE_BUILD_SHA": JSON.stringify(buildSha) },
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
