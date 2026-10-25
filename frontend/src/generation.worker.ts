import {
  generateAtlas,
  generationPreview,
  generationSnapshot,
  type AtlasGenerationInput,
  type GenerationDiagnostic,
} from "@atlas/generation";
import { DomainError, type Diagnostic, type DomainSnapshot } from "@atlas/domain";
import { sendGeneration } from "./generationTransport";
import { transferableBuffers } from "./generationNumerical";

self.onmessage = async (
  event: MessageEvent<{
    snapshot: DomainSnapshot;
    input: AtlasGenerationInput;
    operationId: string;
  }>
) => {
  let stage = "Preparing geography";
  const diagnostics: GenerationDiagnostic[] = [];
  try {
    const result = await generateAtlas(event.data.snapshot, event.data.input, {
      yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      diagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        self.postMessage({ kind: "diagnostic", diagnostic });
      },
      progress(path, fraction, message) {
        stage = `${path.join(" / ")}: ${message}`;
        self.postMessage({ kind: "progress", path, fraction, message });
      },
      async saveBoundary(boundary) {
        const grid = generationPreview(boundary.state);
        if (!grid.channels.elevation) return;
        const label =
          boundary.kind === "epoch"
            ? boundary.ancestry.map((epoch) => epoch.id).join(" / ")
            : "Present geography";
        self.postMessage({ kind: "preview", grid, label }, { transfer: transferableBuffers(grid) });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      },
    });
    stage = "Preparing completed fields and coverage";
    const warnings: Diagnostic[] = [];
    const snapshot = generationSnapshot(
      result,
      event.data.input,
      event.data.operationId,
      event.data.snapshot,
      warnings
    );
    const history = [
      ...result.state.history,
      ...(result.state.causes?.length
        ? [{ path: ["present"], ancestry: [], causes: result.state.causes }]
        : []),
    ];
    stage = "Sending completed geography to the editor";
    self.postMessage({ kind: "progress", path: ["finalize"], fraction: 0.995, message: stage });
    await sendGeneration(
      snapshot,
      history,
      [...(result.state.diagnostics ?? []), ...warnings],
      (message, transfer) => self.postMessage(message, { transfer })
    );
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
