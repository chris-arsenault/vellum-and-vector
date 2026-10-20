import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build:
    mode === "performance"
      ? {
          rolldownOptions: { input: ["index.html", "tests/performance.html"] },
        }
      : undefined,
}));
