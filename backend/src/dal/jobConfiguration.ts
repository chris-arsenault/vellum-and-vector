import { requireThat, scalarSchema, type ParameterValues, type Value } from "@atlas/domain";
import type { GenerationEpoch, ProcessConfiguration, ProcessSequence } from "@atlas/generation";
import { insertRows, type Sql } from "./database";
import { readValues, writeValueSets } from "./typedValues";

interface StepRow {
  run_id: string;
  path: string[];
  ordinal: number;
  kind: "process" | "epochs";
  process_id: string | null;
  process_version: string | null;
  parameters: string | null;
  when_variable: string | null;
  when_value: string | null;
  reset_facts: string[];
}
interface EpochRow {
  path: string[];
  id: string;
  ordinal: number;
  duration: number;
  parent_epoch: string | null;
  variables: string;
}

function configurationRows(run: string, configuration: ProcessConfiguration) {
  const settings: { value: Value; purpose: "parameters" | "epoch"; schemaId: string }[] = [];
  const steps: (Omit<StepRow, "parameters" | "when_value"> & {
    parameters: number | null;
    when_value: number | null;
  })[] = [];
  const epochs: (Omit<EpochRow, "variables"> & { variables: number })[] = [];
  const values = (value: Value, purpose: "parameters" | "epoch") => {
    settings.push({ value, purpose, schemaId: configuration.id });
    return settings.length - 1;
  };
  const visit = (sequence: ProcessSequence, parent: string[]) => {
    requireThat(
      new Set(sequence.map((s) => s.id)).size === sequence.length,
      "duplicate_invocation",
      "Sequence invocation identities must be unique."
    );
    sequence.forEach((step, ordinal) => {
      const path = [...parent, step.id];
      steps.push({
        run_id: run,
        path,
        ordinal,
        kind: step.kind,
        ...stepSettings(step, values),
      });
      if (step.kind === "epochs") {
        step.epochs.forEach((epoch, i) =>
          epochs.push({
            path,
            id: epoch.id,
            ordinal: i,
            duration: epoch.duration,
            parent_epoch: epoch.parentEpoch,
            variables: values(epoch.variables, "epoch"),
          })
        );
        visit(step.body, path);
      }
    });
  };
  visit(configuration.sequence, []);
  return { settings, steps, epochs };
}
function stepSettings(
  step: ProcessSequence[number],
  values: (v: Value, purpose: "parameters") => number
) {
  if (step.kind === "epochs")
    return {
      process_id: null,
      process_version: null,
      parameters: null,
      when_variable: null,
      when_value: null,
      reset_facts: step.resetFacts,
    };
  return {
    process_id: step.process,
    process_version: step.version,
    parameters: step.parameters ? values(step.parameters, "parameters") : null,
    when_variable: step.when?.variable ?? null,
    when_value: step.when ? values(step.when.equals, "parameters") : null,
    reset_facts: [],
  };
}

export async function writeJobConfiguration(
  sql: Sql,
  world: string,
  run: string,
  configuration: ProcessConfiguration
): Promise<void> {
  const { settings, steps, epochs } = configurationRows(run, configuration);
  const ids = await writeValueSets(sql, world, settings);
  await insertRows(
    sql,
    "atlas_run_steps",
    [
      "run_id",
      "path",
      "ordinal",
      "kind",
      "process_id",
      "process_version",
      "parameters",
      "when_variable",
      "when_value",
      "reset_facts",
    ],
    steps.map((s) => [
      run,
      s.path,
      s.ordinal,
      s.kind,
      s.process_id,
      s.process_version,
      s.parameters === null ? null : ids[s.parameters],
      s.when_variable,
      s.when_value === null ? null : ids[s.when_value],
      s.reset_facts,
    ])
  );
  await insertRows(
    sql,
    "atlas_run_epochs",
    ["run_id", "path", "ordinal", "id", "duration", "parent_epoch", "variables"],
    epochs.map((e) => [run, e.path, e.ordinal, e.id, e.duration, e.parent_epoch, ids[e.variables]])
  );
}

export async function readJobSequence(
  sql: Sql,
  world: string,
  run: string
): Promise<ProcessSequence> {
  const steps = await sql.query<StepRow>(
    "SELECT * FROM atlas_run_steps WHERE run_id=$1 ORDER BY cardinality(path),ordinal",
    [run]
  );
  const epochs = await sql.query<EpochRow>(
    "SELECT * FROM atlas_run_epochs WHERE run_id=$1 ORDER BY ordinal",
    [run]
  );
  const ids = [
    ...steps.rows.flatMap((s) => [s.parameters, s.when_value]),
    ...epochs.rows.map((e) => e.variables),
  ].filter((id): id is string => id !== null);
  const values = await readValues(sql, world, ids);
  const sequences = new Map<string, ProcessSequence>([["[]", []]]);
  for (const s of steps.rows) {
    const parent = sequences.get(JSON.stringify(s.path.slice(0, -1)));
    requireThat(parent, "job_configuration", "Stored sequence parent is missing.");
    const id = s.path.at(-1)!;
    if (s.kind === "process")
      parent.push({
        kind: "process",
        id,
        process: s.process_id!,
        version: s.process_version!,
        ...(s.parameters ? { parameters: values.get(s.parameters) as ParameterValues } : {}),
        ...(s.when_variable
          ? {
              when: {
                variable: s.when_variable,
                equals: scalarSchema.parse(values.get(s.when_value!)),
              },
            }
          : {}),
      });
    else {
      const body: ProcessSequence = [];
      const schedule: GenerationEpoch[] = epochs.rows
        .filter((e) => samePath(e.path, s.path))
        .map((e) => ({
          id: e.id,
          duration: e.duration,
          parentEpoch: e.parent_epoch,
          variables: values.get(e.variables) as ParameterValues,
        }));
      parent.push({ kind: "epochs", id, epochs: schedule, body, resetFacts: s.reset_facts });
      sequences.set(JSON.stringify(s.path), body);
    }
  }
  return sequences.get("[]")!;
}
function samePath(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
