import { requireThat } from "@atlas/domain";

export interface RandomStream {
  next(): number;
  counter(): number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

export function randomStream(
  seed: string,
  scope: string,
  invocation: string,
  stream: string,
  iterations: string[],
  start = 0
): RandomStream {
  requireThat(
    Number.isSafeInteger(start) && start >= 0,
    "invalid_random_counter",
    "Random counters must be nonnegative integers."
  );
  const key = hash(
    JSON.stringify(["atlas-counter-v1", seed, scope, invocation, stream, iterations])
  );
  let cursor = start;
  return {
    next() {
      let value = key ^ hash(String(cursor++));
      value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
      value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
      return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
    },
    counter: () => cursor,
  };
}
