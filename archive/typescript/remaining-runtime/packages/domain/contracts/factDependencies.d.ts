export declare class FactDependencies {
  private readonly consumers;
  add(input: string, outputs: string[]): this;
  affected(inputs: string[]): string[];
}
