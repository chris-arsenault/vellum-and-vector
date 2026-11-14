import type { GenerationProgress } from "./generated";

/** UI cancellation and progress bindings; Rust owns worker scheduling. */
export function browserGenerationControl(
  cancelled: () => boolean,
  report: (progress: GenerationProgress) => void
) {
  return {
    cancelled,
    progress: (value: string) => report(JSON.parse(value) as GenerationProgress),
  };
}
