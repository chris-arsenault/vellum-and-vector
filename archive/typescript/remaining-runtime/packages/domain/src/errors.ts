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
