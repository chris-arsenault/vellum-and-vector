import {
  generateAtlas,
  type AtlasGenerationInput,
  type GenerationDiagnostic,
} from "@atlas/generation";
import { DomainError, type DomainSnapshot } from "@atlas/domain";

self.onmessage = async (
  event: MessageEvent<{ snapshot: DomainSnapshot; input: AtlasGenerationInput }>
) => {
  let stage = "Preparing geography";
  const diagnostics: GenerationDiagnostic[] = [];
  try {
    const result = await generateAtlas(event.data.snapshot, event.data.input, {
      diagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        self.postMessage({ kind: "diagnostic", diagnostic });
      },
      progress(path, fraction, message) {
        stage = `${path.join(" / ")}: ${message}`;
        self.postMessage({ kind: "progress", path, fraction, message });
      },
    });
    stage = "Sending completed geography to the editor";
    self.postMessage({ kind: "progress", path: ["finalize"], fraction: 0.995, message: stage });
    self.postMessage({ kind: "completed", result });
  } catch (error) {
    console.error(`[atlas generation] Failed during ${stage}`, error);
    self.postMessage({
      kind: "failed",
      error: `${stage}: ${error instanceof Error ? error.message : String(error)}`,
      diagnostics: [
        ...diagnostics,
        ...(error instanceof DomainError && Array.isArray(error.details) ? error.details : []),
      ],
    });
  }
};
