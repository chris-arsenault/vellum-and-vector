import { landmarkKind, type Landmark } from "@atlas/domain";
import { landmarksInExtent } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

/**
 * The generator sites the configured number of major landscape landmarks itself, at the epochs
 * they form in, on the terrain of that moment. Records this extent already carries are kept
 * and re-formed; the count setting above says how many the world is owed in all.
 */
export function GenerationLandmarks({ flow }: { flow: GenerationWorkflow }) {
  const source = flow.options.source ?? flow.prepared?.source,
    input = flow.prepared?.input;
  const landmarks = source && input ? landmarksInExtent(source, input) : [];
  const epochs = formingEpochs(flow);
  return (
    <>
      <p className="hint">
        The generator chooses where each landmark belongs from the terrain of its forming epoch: a
        great cone on broad plains, a canyon where a river crosses a plateau, falls on a large river
        above base level. Each is held to its measures through every later epoch and named with the
        geography around it.
      </p>
      {landmarks.length ? (
        <table className="setup-located-sources">
          <caption>Landmarks this run keeps</caption>
          <thead>
            <tr>
              <th scope="col">Landmark</th>
              <th scope="col">Kind</th>
              <th scope="col">Forms in</th>
              <th scope="col">Held measures</th>
            </tr>
          </thead>
          <tbody>
            {landmarks.map((landmark) => (
              <tr key={landmark.id}>
                <th scope="row">{landmark.name || landmarkKind(landmark.kind)?.label}</th>
                <td>{landmarkKind(landmark.kind)?.label ?? landmark.kind}</td>
                <td>{epochs[landmark.emplacedAtEpoch]?.id ?? landmark.emplacedAtEpoch}</td>
                <td>{measures(landmark)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">
          No landmark stands in this extent yet; this run sites the configured number.
        </p>
      )}
    </>
  );
}
function formingEpochs(flow: GenerationWorkflow) {
  const source = flow.options.source ?? flow.prepared?.source;
  return flow.prepared?.input?.settings?.epochs ?? source?.world.epochs ?? [];
}
function measures(landmark: Landmark) {
  const kind = landmarkKind(landmark.kind);
  if (!kind) return "";
  return kind.parameters
    .filter((p) => !p.advisory)
    .map((p) => `${p.label} ${landmark.parameters[p.key]} ${p.unit}`)
    .join(" · ");
}
