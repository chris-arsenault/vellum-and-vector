import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { spatial } from "@atlas/domain";
import { generationResolution } from "@atlas/generation";
import { atlasWorkspace } from "./atlasWorkspace";
import { inheritedGeneration } from "./generationJobs";
import { useGenerate } from "./useAtlas";
import { ErrorMessage } from "./ErrorMessage";
import type { EditorState } from "./useEditor";
import type { World } from "./types";

function useRegionalGeneration(world: World, editor: EditorState) {
  const previous = inheritedGeneration(world, editor.area.id),
    defaults = previous ?? { quality: "standard", seed: world.seed, domains: ["magic", "built"] },
    [quality, setQuality] = useState(defaults.quality),
    [seed, setSeed] = useState(defaults.seed ?? world.seed),
    [magic, setMagic] = useState(defaults.domains.includes("magic")),
    [people, setPeople] = useState(
      defaults.domains.some((id) => ["built", "cultural", "political"].includes(id))
    ),
    generate = useGenerate(world, editor.area.id),
    domains = [
      "physical",
      ...(magic ? ["magic"] : []),
      ...(people ? ["built", "cultural", "political"] : []),
    ],
    input = {
      areaId: editor.area.id,
      quality,
      seed,
      domains,
      parameters: previous?.parameters,
    },
    prepared = useQuery({
      queryKey: ["generation-setup", world.id, world.version, input],
      queryFn: async () => (await atlasWorkspace()).generationSetup(world.id, input),
    }),
    errors = preparationErrors(prepared.data?.diagnostics, prepared.error),
    resolution = prepared.data?.resolution ?? generationResolution(quality, editor.area.profile);
  return {
    quality,
    setQuality,
    seed,
    setSeed,
    magic,
    setMagic,
    people,
    setPeople,
    generate,
    domains,
    errors,
    resolution,
    preparing: prepared.isPending,
    parameters: previous?.parameters,
  };
}
function preparationErrors(
  diagnostics: { severity: string; message: string }[] = [],
  error: Error | null
) {
  return [
    ...diagnostics.filter((item) => item.severity === "error"),
    ...(error ? [{ message: error.message }] : []),
  ];
}
type RegionalSetup = ReturnType<typeof useRegionalGeneration>;

export function RegionalGeneration({ world, editor }: { world: World; editor: EditorState }) {
  const setup = useRegionalGeneration(world, editor);
  return (
    <section className="regional-generation">
      <RegionalContext world={world} editor={editor} setup={setup} />
      <RegionalForm editor={editor} setup={setup} />
    </section>
  );
}
function RegionalContext({
  world,
  editor,
  setup,
}: {
  world: World;
  editor: EditorState;
  setup: RegionalSetup;
}) {
  return (
    <>
      <p className="eyebrow">REFINE THE EXISTING MAP</p>
      <h2>{editor.region?.name ?? editor.area.name}</h2>
      <p>
        Develop smaller valleys, tributaries and places from the parent geography. Completed history
        stays fixed.
      </p>
      <p className="hint">
        Climate and habitats follow the finer relief and connected water. Existing magical
        landscapes retain their sources and history.
      </p>
      <p className="hint">
        Known towns and routes keep their identities. Smaller places resolve from inherited
        residents where the landscape offers a site; no new settlement era runs.
      </p>
      <p className="hint">
        Generation uses the original geography. Structural map edits protect the geography they
        touch; choose an untouched region to refine further. Names and styles remain editable.
      </p>
      {setup.magic && (
        <p className="hint">
          Inherited systems:{" "}
          {(world.magicSystems ?? [])
            .filter((system) => system.enabled)
            .map((system) => system.name)
            .join(", ") || "none"}
          .
        </p>
      )}
      <dl>
        <div>
          <dt>Parent map</dt>
          <dd>{world.areas[editor.area.parentId!]?.name ?? world.name}</dd>
        </div>
        <div>
          <dt>Selected area</dt>
          <dd>
            {(spatial.area(editor.area.footprint) / 1e6).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{" "}
            km²
          </dd>
        </div>
        <div>
          <dt>Approximate terrain spacing</dt>
          <dd>{Math.round(setup.resolution.cellSpan).toLocaleString()} m</dd>
        </div>
      </dl>
    </>
  );
}
function RegionalForm({ editor, setup }: { editor: EditorState; setup: RegionalSetup }) {
  const { quality, setQuality, seed, setSeed, generate, domains, errors, parameters } = setup;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        generate.mutate(
          { domains, quality, seed, parameters },
          { onSuccess: () => editor.setPanel("generate") }
        );
      }}
    >
      <label>
        Regional detail
        <select value={quality} onChange={(event) => setQuality(event.target.value)}>
          <option value="draft">Draft</option>
          <option value="standard">Standard</option>
          <option value="fine">Fine</option>
        </select>
      </label>
      <label>
        Detail seed
        <input
          type="number"
          step="1"
          value={seed}
          onChange={(event) => setSeed(Number(event.target.value))}
          required
        />
      </label>
      <RegionalDomains setup={setup} />
      {errors.map((item, index) => (
        <p className="error" key={index}>
          {item.message}
        </p>
      ))}
      <button
        className="primary"
        disabled={generate.isPending || setup.preparing || !!errors.length}
      >
        Generate regional detail
      </button>
      <button type="button" onClick={() => editor.setPanel("regions")}>
        Return to region
      </button>
      <ErrorMessage error={generate.error} />
    </form>
  );
}
function RegionalDomains({ setup }: { setup: RegionalSetup }) {
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={setup.magic}
          onChange={(event) => setup.setMagic(event.target.checked)}
        />
        Refine inherited magical geography
      </label>
      <label>
        <input
          type="checkbox"
          checked={setup.people}
          onChange={(event) => setup.setPeople(event.target.checked)}
        />
        Develop inherited settlements and routes
      </label>
    </>
  );
}
