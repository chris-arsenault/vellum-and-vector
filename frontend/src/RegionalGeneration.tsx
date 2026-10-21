import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { bounds } from "./presentation";
import {
  generationRecipeSchema,
  atlasParametersSchema,
  worldGenerationSettings,
} from "@atlas/generation";
import { session } from "./atlasState";
import { GenerationWizard } from "./GenerationWizard";
import { inheritedGeneration, startGeneration } from "./generationJobs";
import type { GenerationDraft } from "./generationDraft";
import type { PreparedSetup } from "./useGenerationWorkflow";
import type { EditorState } from "./useEditor";
import type { World } from "./types";

export function RegionalGeneration({ world, editor }: { world: World; editor: EditorState }) {
  const area = editor.area,
    extent = bounds(area.footprint);
  const previous = inheritedGeneration(world, area.id);
  const availableDomains = [
    ...new Set(
      Object.keys(area.layers)
        .map((id) => world.layers[id]?.generator)
        .filter(Boolean)
    ),
  ];
  const initial: GenerationDraft = {
    name: area.name,
    width: extent[2] - extent[0],
    height: extent[3] - extent[1],
    recipe: generationRecipeSchema.parse({
      schemaVersion: 1,
      seed: previous?.seed ?? world.seed,
      quality: previous?.quality ?? "standard",
      domains: availableDomains.length ? availableDomains : ["physical"],
      parameters: atlasParametersSchema.parse(previous?.parameters ?? {}),
      processes: {},
      settings: worldGenerationSettings(world),
    }),
  };
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const generate = (_draft: GenerationDraft, prepared: PreparedSetup) => {
    startGeneration(world.id, {
      ...prepared.input,
      operationId: crypto.randomUUID(),
      expectedVersion: prepared.source.world.version,
    });
    editor.setPanel("generate");
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="setup-region-dialog"
      aria-label="Generate region"
      onCancel={(event) => {
        event.preventDefault();
        editor.setPanel("generate");
      }}
    >
      <div className="setup-region-shell">
        <header className="setup-page-header">
          <div>
            <h1>Generate {area.name}</h1>
          </div>
          <p className="hint">Parent history and authored geography remain authoritative.</p>
        </header>
        <GenerationWizard
          key={area.id}
          initial={initial}
          source={session(world.id).snapshot}
          areaId={area.id}
          onGenerate={generate}
          onCancel={() => editor.setPanel("generate")}
        />
      </div>
    </dialog>,
    document.body
  );
}
