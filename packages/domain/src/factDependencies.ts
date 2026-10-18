export class FactDependencies {
  private readonly consumers = new Map<string, Set<string>>();
  add(input: string, outputs: string[]): this {
    const values = this.consumers.get(input) ?? new Set<string>();
    for (const output of outputs) values.add(output);
    this.consumers.set(input, values);
    return this;
  }
  affected(inputs: string[]): string[] {
    const affected = new Set(inputs),
      queue = [...inputs];
    for (let i = 0; i < queue.length; i++)
      for (const output of this.consumers.get(queue[i]) ?? []) {
        if (affected.has(output)) continue;
        affected.add(output);
        queue.push(output);
      }
    return [...affected];
  }
}
