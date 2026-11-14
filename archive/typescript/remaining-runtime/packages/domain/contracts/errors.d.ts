export declare class DomainError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown);
}
export declare function requireThat(
  condition: unknown,
  code: string,
  message: string
): asserts condition;
export interface Diagnostic {
  code: string;
  message: string;
  severity: "error" | "warning";
  invocation: string | null;
  resource: string | null;
  field?: {
    feature: string;
    path: (string | number)[];
  };
}
