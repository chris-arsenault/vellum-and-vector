import { vi } from "vitest";

// Routine tests supply maps; invoking the real Rust generator requires an explicit workload.
vi.mock("@atlas/engine", () => ({
  initializeEngine() {
    throw new Error("Full generation is forbidden in unit tests. Supply a completed map.");
  },
}));
