import {
  describeProcess,
  type SetupInvocation,
  type PublicationDefinition,
} from "@atlas/generation";
import type { ProductRequirement } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import {
  executionGroups,
  executionStatus,
  executionTiming,
  executionTraits,
  formatYears,
} from "./generationExecutionPresentation";

export function GenerationExecutionInspector({ flow }: { flow: GenerationWorkflow }) {
  if (!flow.prepared || !flow.setup)
    return <p className="hint">Resolve the current configuration to inspect its execution plan.</p>;
  const groups = executionGroups(flow.setup.invocations);
  return (
    <details className="setup-execution-inspector">
      <summary>Execution details</summary>
      <p className="hint">
        Operations remain in causal order, including shared inputs and conditional repairs. Elapsed
        responses bind years; repeated model passes add no separate duration. Present ecology
        classifies the result without adding biological age.
      </p>
      {groups.map((group, index) => (
        <details className="setup-execution-phase" key={`${index}:${group.key}`}>
          <summary>{group.label}</summary>
          <ol className="setup-execution-list">
            {group.occurrences.map(({ invocation, position }) => (
              <ExecutionOccurrence
                key={invocation.key}
                flow={flow}
                invocation={invocation}
                position={position}
              />
            ))}
          </ol>
        </details>
      ))}
      <ExecutionPublications definitions={flow.setup.publications} />
    </details>
  );
}
function ExecutionOccurrence({
  flow,
  invocation,
  position,
}: {
  flow: GenerationWorkflow;
  invocation: SetupInvocation;
  position: number;
}) {
  const process = flow.prepared!.registry.get(invocation.process, invocation.version),
    owner = flow.setup!.features.find((feature) => feature.id === invocation.feature);
  return (
    <li className="setup-execution-row" value={position}>
      <details>
        <summary>
          <span className="setup-execution-title">{describeProcess(process.contract).label}</span>{" "}
          <span className="setup-execution-trait">{executionTraits[invocation.behavior]}</span>{" "}
          <span className="setup-execution-time">{executionTiming(invocation)}</span>{" "}
          <span className="setup-execution-status">{executionStatus(invocation)}</span>
        </summary>
        <p>
          {owner ? (
            <button type="button" className="setup-link" onClick={() => flow.locate(owner.id)}>
              {owner.label}
            </button>
          ) : (
            "Shared operation"
          )}
          {" · "}
          <code>
            {invocation.process}@{invocation.version}
          </code>
        </p>
        <p className="hint">
          Occurrence: <code>{invocation.path.join(" / ")}</code>
        </p>
        {invocation.durationNote && <p>{invocation.durationNote}</p>}
        {invocation.durationYears !== invocation.boundDurationYears &&
          invocation.boundDurationYears !== null && (
            <p className="hint">
              Declared duration: {formatYears(invocation.boundDurationYears)}. Applied duration:{" "}
              {executionTiming(invocation)}.
            </p>
          )}
        <ExecutionContract invocation={invocation} />
        {Object.keys(invocation.parameters).length > 0 && (
          <details>
            <summary>Bound parameters</summary>
            <pre>{JSON.stringify(invocation.parameters, null, 2)}</pre>
          </details>
        )}
      </details>
    </li>
  );
}
function ExecutionContract({ invocation }: { invocation: SetupInvocation }) {
  const reconciliation = invocation.reconciliationContract;
  return (
    <>
      <div className="setup-execution-products">
        <ProductList title="Inputs" values={invocation.inputs.map(inputLabel)} />
        <ProductList title="Produces" values={invocation.outputs} />
        <ProductList title="Invalidates after validation" values={invocation.invalidates} />
      </div>
      {reconciliation && (
        <section className="setup-execution-reconciliation" aria-label="Declared reconciliation">
          <h4>If the mesh changes</h4>
          <p className="hint">
            Revoke these products before the declared child operations; both outcomes must retain
            the guarantees.
          </p>
          <ProductList title="Immediate invalidations" values={reconciliation.invalidates} />
          <ProductList title="Guaranteed fresh products" values={reconciliation.guarantees} />
        </section>
      )}
    </>
  );
}
function inputLabel(input: ProductRequirement) {
  const freshness = input.freshness === "carried" ? " (carried state)" : "";
  const empty = input.acceptEmptyFrom
    ? `; accepts initialized empty from ${input.acceptEmptyFrom}`
    : "";
  return `${input.product}${freshness}${empty}`;
}
function ProductList({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <h4>{title}</h4>
      {values.length ? (
        <ul>
          {values.map((value) => (
            <li key={value}>
              <code>{value}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">None declared.</p>
      )}
    </div>
  );
}
function ExecutionPublications({ definitions }: { definitions: PublicationDefinition[] }) {
  return (
    <details className="setup-execution-publications">
      <summary>Publication bindings</summary>
      <p className="hint">
        Registered outputs for this request. Geographic objects are published when their extractors
        produce them.
      </p>
      <ul>
        {definitions.map((definition, index) => (
          <li key={index}>
            <strong>{definition.layer.name}</strong>
            {" · "}
            {definition.kind === "field" ? (
              <>
                <code>{definition.channel}</code> · {definition.unit} · {definition.quantity}
              </>
            ) : (
              <>
                {definition.network ? "Network" : "Geographic objects"}:{" "}
                {definition.featureKinds.join(", ") || "No configured kinds"}
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
