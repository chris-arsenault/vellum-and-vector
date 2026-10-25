import { landmarkKind, type Landmark } from "@atlas/domain";
import { landmarksInExtent } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

/** The landmarks this request will form, as the magic step lists located sources. */
export function GenerationLandmarks({ flow }: { flow: GenerationWorkflow }) {
  const source = flow.options.source ?? flow.prepared?.source,
    input = flow.prepared?.input;
  const landmarks = source && input ? landmarksInExtent(source, input) : [];
  if (!landmarks.length)
    return (
      <p className="hint">
        No landmarks are placed in this extent. This choice forms landmarks placed on the map; it
        does not create them.
      </p>
    );
  const epochs = input?.settings?.epochs ?? source!.world.epochs;
  return (
    <table className="setup-located-sources">
      <caption>Landmarks forming in this extent</caption>
      <thead>
        <tr>
          <th scope="col">Landmark</th>
          <th scope="col">Kind</th>
          <th scope="col">Forms in</th>
          <th scope="col">Guaranteed measures</th>
        </tr>
      </thead>
      <tbody>
        {landmarks.map((landmark) => (
          <tr key={landmark.id}>
            <th scope="row">{landmark.name}</th>
            <td>{landmarkKind(landmark.kind)?.label ?? landmark.kind}</td>
            <td>{epochs[landmark.emplacedAtEpoch]?.id ?? landmark.emplacedAtEpoch}</td>
            <td>{measures(landmark)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function measures(landmark: Landmark) {
  const kind = landmarkKind(landmark.kind);
  if (!kind) return "";
  return kind.parameters
    .filter((p) => !p.advisory)
    .map((p) => `${p.label} ${landmark.parameters[p.key]} ${p.unit}`)
    .join(" · ");
}
