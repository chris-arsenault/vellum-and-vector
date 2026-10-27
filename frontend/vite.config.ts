import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build:
    mode === "workspace"
      ? {
          rolldownOptions: {
            input: ["index.html", "tests/workspace.html"],
          },
        }
      : undefined,
}));
