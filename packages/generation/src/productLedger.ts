import { DomainError, requireThat } from "@atlas/domain";
import type { MapProcessContract } from "./process";

export interface ProductDefinition<K extends string = string> {
  id: K;
  lifetime: "run" | "epoch";
  unit?: string;
  representation?: "field" | "history" | "forcing" | "geography" | "workspace";
  scope?: "located-space";
  composition?: "exclusive" | "shared-state" | "additive";
}
export type ProductStatus = "missing" | "stale" | "available";

/** Run-local validity; allocation alone never establishes an input. */
export class ProductLedger {
  private readonly definitions = new Map<string, ProductDefinition>();
  private readonly invalidators = new Map<string, string>();
  private readonly providers = new Map<string, string>();
  constructor(
    readonly facts: Set<string>,
    definitions: ProductDefinition[] = []
  ) {
    for (const definition of definitions) {
      const previous = this.definitions.get(definition.id);
      requireThat(
        !previous || previous.lifetime === definition.lifetime,
        "product_definition",
        `Use one lifetime for ${definition.id}.`
      );
      for (const key of ["unit", "representation", "scope", "composition"] as const)
        requireThat(
          previous?.[key] === undefined ||
            definition[key] === undefined ||
            previous[key] === definition[key],
          "product_definition",
          `Use one ${key} for ${definition.id}.`
        );
      this.definitions.set(definition.id, { ...previous, ...definition });
    }
  }
  status(product: string): ProductStatus {
    if (this.facts.has(product)) return "available";
    return this.invalidators.has(product) ? "stale" : "missing";
  }
  accepts(product: string) {
    return this.facts.has(product);
  }
  invalidatedBy(product: string) {
    return this.invalidators.get(product);
  }
  fork(): ProductLedger {
    const branch = new ProductLedger(new Set(this.facts), [...this.definitions.values()]);
    for (const [product, by] of this.invalidators) branch.invalidators.set(product, by);
    for (const [product, provider] of this.providers) branch.providers.set(product, provider);
    return branch;
  }
  /** Keep only validity established on both outcomes of a conditional repair. */
  join(branch: ProductLedger, by: string) {
    for (const [product, provider] of branch.providers) this.providers.set(product, provider);
    const products = new Set([
      ...this.facts,
      ...branch.facts,
      ...this.invalidators.keys(),
      ...branch.invalidators.keys(),
    ]);
    for (const product of products)
      if (!this.facts.has(product) || !branch.facts.has(product)) this.invalidate(product, by);
  }
  produce(product: string) {
    this.facts.add(product);
    this.invalidators.delete(product);
  }
  invalidate(product: string, by: string) {
    this.facts.delete(product);
    this.invalidators.set(product, by);
  }
  enterEpoch(path: string) {
    for (const definition of this.definitions.values())
      if (definition.lifetime === "epoch") this.invalidate(definition.id, `${path} epoch boundary`);
  }
  commit(contract: MapProcessContract, by: string) {
    this.checkProviders(contract);
    const provider = `${contract.id}@${contract.version}`;
    for (const product of contract.produces)
      if (this.definitions.get(product)?.composition === "exclusive")
        this.providers.set(product, provider);
    for (const product of contract.invalidates) this.invalidate(product, by);
    for (const product of contract.produces) this.produce(product);
  }
  checkProviders(contract: MapProcessContract) {
    const provider = `${contract.id}@${contract.version}`;
    for (const product of contract.produces) {
      if (this.definitions.get(product)?.composition !== "exclusive") continue;
      const previous = this.providers.get(product);
      if (previous !== undefined && previous !== provider)
        throw new DomainError(
          "product_writer",
          `${previous} and ${provider} both exclusively produce ${product}. Select one provider.`,
          product
        );
    }
  }
}
