import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listTemplates, saveTemplate } from "./atlasTemplates";
import { download } from "./download";
import { ErrorMessage } from "./ErrorMessage";
import type { EditorState } from "./useEditor";
import type { Template, World } from "./types";
import { TemplateDrawing, useTemplateDrawing } from "./TemplateDrawing";
import { buildDefinition } from "./templateEditing";
import { TemplateSettings, TemplatePlacement } from "./TemplateSettings";

export function TemplateStudio({ world, editor }: { world?: World; editor?: EditorState }) {
  const cache = useQueryClient();
  const library = useQuery({
    queryKey: ["templates"],
    queryFn: () => listTemplates(),
  });
  const drawing = useTemplateDrawing();
  const [editing, setEditing] = useState<Template | null>(null);
  const [importError, setImportError] = useState<Error | null>(null);
  function edit(template: Template) {
    setEditing(template);
    drawing.load(template);
  }
  const save = useMutation({
    mutationFn: async (definition: Template) => saveTemplate(definition),
    onSuccess: (result) => {
      edit(result);
      void cache.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  const templates = templateList(library.data, world);
  return (
    <section>
      <h3>Independent template library</h3>
      <p className="hint">
        Draw in local units. Definitions belong to your library; placed instances retain their own
        content.
      </p>
      <label>
        Import a definition
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              setImportError(null);
              save.mutate(JSON.parse(await file.text()) as Template);
            } catch {
              setImportError(new Error("The file must contain a valid template definition."));
            }
          }}
        />
      </label>
      <TemplateDrawing studio={drawing} existing={!!editing} />
      <TemplateSettings
        key={editing?.id ?? "new"}
        editing={editing}
        saving={save.isPending}
        submit={(form) => save.mutate(buildDefinition(form, drawing, editing))}
        detach={() => {
          if (editing) setEditing({ ...editing, id: crypto.randomUUID(), version: 1 });
        }}
      />
      <ErrorMessage error={importError ?? save.error ?? library.error} />
      {templates.map((template) => (
        <div key={template.id}>
          <h4>
            {template.name} · v{template.version ?? 1}
          </h4>
          <button className="quiet" onClick={() => edit(template)}>
            Edit definition
          </button>
          <button className="quiet" onClick={() => download(`${template.name}.json`, template)}>
            Export definition
          </button>
          {editor && <TemplatePlacement template={template} editor={editor} />}
        </div>
      ))}
    </section>
  );
}
function templateList(library: Template[] = [], world?: World) {
  return library.concat(
    Object.values(world?.templates ?? {}).filter((t) => !library.some((l) => l.id === t.id))
  );
}
