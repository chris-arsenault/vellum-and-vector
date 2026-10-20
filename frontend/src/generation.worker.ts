import { generateAtlas, type AtlasGenerationInput } from "@atlas/generation";
import type { DomainSnapshot } from "@atlas/domain";

self.onmessage = async (
  event: MessageEvent<{ snapshot: DomainSnapshot; input: AtlasGenerationInput }>
) => {
  let stage = "Preparing geography";
  try {
    const result = await generateAtlas(event.data.snapshot, event.data.input, {
      progress(path, fraction, message) {
        stage = `${path.join(" / ")}: ${message}`;
        self.postMessage({ kind: "progress", path, fraction, message });
      },
    });
    stage = "Sending completed geography to the editor";
    self.postMessage({ kind: "progress", path: ["finalize"], fraction: 0.995, message: stage });
    self.postMessage({ kind: "completed", result }, {transfer: resultBuffers(result)});
  } catch (error) {
    console.error(`[atlas generation] Failed during ${stage}`, error);
    self.postMessage({
      kind: "failed",
      error: `${stage}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};

function resultBuffers(result: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>(), visited = new Set<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
    } else for (const child of Object.values(value)) visit(child);
  };
  visit(result);
  return [...buffers];
}
