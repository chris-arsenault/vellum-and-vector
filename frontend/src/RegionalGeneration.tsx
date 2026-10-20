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
  const generate = (draft: GenerationDraft) => {
    startGeneration(world.id, {
      ...draft.recipe,
      areaId: area.id,
      operationId: crypto.randomUUID(),
      expectedVersion: world.version,
    });
    editor.setPanel("generate");
  };
  return (
    <>
      <p className="callout">
        {area.boundary?.crossings.length ?? 0} locked crossings · parent history and authored
        geography remain authoritative.
      </p>
      <GenerationWizard
        key={area.id}
        initial={initial}
        source={session(world.id).snapshot}
        areaId={area.id}
        onGenerate={generate}
        onCancel={() => editor.setPanel("generate")}
      />
    </>
  );
}
