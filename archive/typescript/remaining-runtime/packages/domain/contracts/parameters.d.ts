import type { ParameterDefinitions, ParameterValues } from "./schemas";
export declare function resolveParameters(
  definitions: ParameterDefinitions,
  ...overrides: ParameterValues[]
): ParameterValues;
