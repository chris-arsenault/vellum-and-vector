export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown = null
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requireThat(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}

export interface Diagnostic {
  code: string;
  message: string;
  severity: "error" | "warning";
  invocation: string | null;
  resource: string | null;
  field?: { feature: string; path: (string | number)[] };
}
