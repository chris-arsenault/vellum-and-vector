import type { SetupInvocation } from "@atlas/generation";

export interface ExecutionGroup {
  key: string;
  label: string;
  occurrences: { invocation: SetupInvocation; position: number }[];
}
/** The projected sequence already includes shared operations in causal order. */
export function executionGroups(invocations: SetupInvocation[]): ExecutionGroup[] {
  const seen = new Set<string>(),
    groups: ExecutionGroup[] = [];
  const hasEpochs = invocations.some((item) => item.epochs.length > 0);
  let encounteredEpoch = false,
    position = 0;
  for (const invocation of invocations) {
    if (seen.has(invocation.key)) continue;
    seen.add(invocation.key);
    if (invocation.epochs.length) encounteredEpoch = true;
    const phase = invocation.epochs.length
      ? JSON.stringify(invocation.epochs.map((epoch) => epoch.id))
      : encounteredEpoch
        ? "present"
        : "initial";
    if (groups.at(-1)?.key !== phase)
      groups.push({
        key: phase,
        label: phaseLabel(invocation, encounteredEpoch, hasEpochs),
        occurrences: [],
      });
    groups.at(-1)!.occurrences.push({ invocation, position: ++position });
  }
  return groups;
}
function phaseLabel(invocation: SetupInvocation, encounteredEpoch: boolean, hasEpochs: boolean) {
  if (!hasEpochs) return "Generation and publication";
  if (!invocation.epochs.length)
    return encounteredEpoch ? "Present geography and publication" : "Initial formation";
  const epoch = invocation.epochs.at(-1)!;
  return `${invocation.epochs.map((item) => item.id).join(" / ")} · ${formatYears(epoch.duration)} epoch`;
}
export function formatYears(years: number) {
  return `${new Intl.NumberFormat("en", { maximumSignificantDigits: 10 }).format(years)} ${years === 1 ? "year" : "years"}`;
}
export function executionTiming(invocation: SetupInvocation) {
  if (invocation.behavior === "elapsed")
    return invocation.durationYears === null
      ? "Unbound duration"
      : formatYears(invocation.durationYears);
  if (invocation.behavior === "model-pass" || invocation.behavior === "material-transformation")
    return "Per pass";
  return "No duration binding";
}
export function executionStatus(invocation: SetupInvocation) {
  if (!invocation.scheduled) return "Skipped by condition";
  if (invocation.reconciliation) return "Conditional repair";
  return invocation.conditional ? "Condition matched" : "Scheduled";
}
export const executionTraits: Record<SetupInvocation["behavior"], string> = {
  initialize: "Initialize",
  "model-pass": "Model pass",
  elapsed: "Elapsed response",
  transfer: "Transfer",
  extract: "Extract geography",
  "forcing-contributor": "Forcing contributor",
  "material-transformation": "Material transformation",
};
