import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConnectionTarget, MapFeature } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";
import { follow, useStructure, type StructureServices } from "./structureServices";
import { heldConnections, isConnection, type HeldConnection } from "./structureMaps";
import type { AuthoringSession } from "./useRealScaleAuthoring";

interface Props {
  session: AuthoringSession;
  feature: MapFeature;
}
const candidateKey = (candidate: { mapId?: string; featureId: string }) =>
  `${candidate.mapId ?? ""}|${candidate.featureId}`;
const target = (held: { mapId?: string; featureId: string }): ConnectionTarget =>
  held.mapId ? { mapId: held.mapId, featureId: held.featureId } : { featureId: held.featureId };

/** A stair, ladder or trapdoor's links to its landings and to features on other maps, each
 * one followable, and the choice of what to connect it to next. */
export function RealScaleConnections({ session, feature }: Props) {
  const services = useStructure();
  const [error, setError] = useState<unknown>(null);
  if (!services || !isConnection(feature)) return null;
  const held = heldConnections(feature);
  return (
    <section aria-label="Connections" className="real-scale-connections">
      <h4>Connections</h4>
      {held.length === 0 ? (
        <p>Not connected</p>
      ) : (
        <ul>
          {held.map((connection) => (
            <HeldRow
              key={candidateKey(connection)}
              connection={connection}
              services={services}
              disconnect={() =>
                session.run({ command: "disconnect", id: feature.id, target: target(connection) })
              }
              fail={setError}
            />
          ))}
        </ul>
      )}
      <ConnectChoice session={session} services={services} feature={feature} />
      <ErrorMessage error={error} />
    </section>
  );
}
function HeldRow({
  connection,
  services,
  disconnect,
  fail,
}: {
  connection: HeldConnection;
  services: StructureServices;
  disconnect(): void;
  fail(error: unknown): void;
}) {
  const name = connection.relation.targetName;
  return (
    <li>
      {name}
      {connection.mapId && connection.mapId !== services.map.reference.mapId
        ? " (another map)"
        : ""}
      <button type="button" onClick={() => void follow(services, connection).catch(fail)}>
        Go to {name}
      </button>
      <button type="button" onClick={disconnect}>
        Disconnect {name}
      </button>
    </li>
  );
}
function ConnectChoice({ session, services, feature }: Props & { services: StructureServices }) {
  const [choice, setChoice] = useState("");
  const candidates = useQuery({
    queryKey: [
      "connection-candidates",
      services.map.reference,
      feature.id,
      session.map.realScale?.edits,
    ],
    // The map store applies the connection rule and lists what this feature may reach.
    queryFn: ({ signal }) =>
      services.reader.connections(services.map.reference, feature.id, { signal }),
  });
  const options = candidates.data ?? [];
  const picked = options.find((option) => candidateKey(option) === choice);
  return (
    <div className="connect-choice">
      <label>
        Connect to
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Choose a landing or a feature below</option>
          {options.map((option) => (
            <option key={candidateKey(option)} value={candidateKey(option)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!picked || session.busy}
        onClick={() =>
          picked && void session.run({ command: "connect", id: feature.id, target: target(picked) })
        }
      >
        Connect
      </button>
      <ErrorMessage error={candidates.error} />
    </div>
  );
}
