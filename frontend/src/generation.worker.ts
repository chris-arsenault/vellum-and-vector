import { generateAtlas, type AtlasGenerationInput } from "@atlas/generation";
import type { DomainSnapshot } from "@atlas/domain";

self.onmessage = async (
  event: MessageEvent<{ snapshot: DomainSnapshot; input: AtlasGenerationInput }>
) => {
  try {
    const result = await generateAtlas(event.data.snapshot, event.data.input, {
      progress(path, fraction, message) {
        self.postMessage({ kind: "progress", path, fraction, message });
      },
    });
    self.postMessage({ kind: "completed", result });
  } catch (error) {
    self.postMessage({
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
