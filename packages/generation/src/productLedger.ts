import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcessContract } from "./process";

export interface ProductDefinition<K extends string = string> {
  id: K;
  lifetime: "run" | "epoch";
  unit?: string;
  representation?: "field" | "history" | "forcing" | "geography" | "workspace";
  scope?: "located-space";
  composition?: "exclusive" | "shared-state" | "additive";
}
export interface EmptyProductInitialization {
  product: string;
  initializer: string;
  /** Omitted event writers cannot create history through another model's invalidation. */
  retainOnInvalidation?: boolean;
}
export interface ProductRequirement {
  product: string;
  freshness?: "current" | "carried";
  acceptEmptyFrom?: string;
}
export type ProductStatus = "missing" | "stale" | "empty" | "available";

/** Run-local validity; allocation alone never establishes an input. */
export class ProductLedger {
  private readonly definitions = new Map<string, ProductDefinition>();
  private readonly empty = new Map<string, string>();
  private readonly invariantEmpty = new Set<string>();
  private readonly invalidators = new Map<string, string>();
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
    if (this.empty.has(product)) return "empty";
    return this.invalidators.has(product) ? "stale" : "missing";
  }
  accepts(input: ProductRequirement) {
    return (
      this.facts.has(input.product) ||
      (input.acceptEmptyFrom !== undefined &&
        this.empty.get(input.product) === input.acceptEmptyFrom)
    );
  }
  invalidatedBy(product: string) {
    return this.invalidators.get(product);
  }
  fork(): ProductLedger {
    const branch = new ProductLedger(new Set(this.facts), [...this.definitions.values()]);
    for (const [product, initializer] of this.empty) branch.empty.set(product, initializer);
    for (const product of this.invariantEmpty) branch.invariantEmpty.add(product);
    for (const [product, by] of this.invalidators) branch.invalidators.set(product, by);
    return branch;
  }
  /** Keep only validity established on both outcomes of a conditional repair. */
  join(branch: ProductLedger, by: string) {
    const products = new Set([
      ...this.facts,
      ...branch.facts,
      ...this.empty.keys(),
      ...branch.empty.keys(),
      ...this.invalidators.keys(),
      ...branch.invalidators.keys(),
    ]);
    for (const product of products) {
      if (this.facts.has(product) && branch.facts.has(product)) continue;
      const initializer = this.empty.get(product);
      if (initializer !== undefined && initializer === branch.empty.get(product)) {
        if (!branch.invariantEmpty.has(product)) this.invariantEmpty.delete(product);
        continue;
      }
      this.invariantEmpty.delete(product);
      this.invalidate(product, by);
    }
  }
  produce(product: string) {
    this.facts.add(product);
    this.empty.delete(product);
    this.invariantEmpty.delete(product);
    this.invalidators.delete(product);
  }
  invalidate(product: string, by: string) {
    if (this.invariantEmpty.has(product)) return;
    this.facts.delete(product);
    this.empty.delete(product);
    this.invalidators.set(product, by);
  }
  initializeEmpty(input: EmptyProductInitialization) {
    requireThat(
      !input.retainOnInvalidation || this.definitions.get(input.product)?.lifetime !== "epoch",
      "product_lifetime",
      "Epoch products cannot retain empty validity across invalidation."
    );
    this.facts.delete(input.product);
    this.empty.set(input.product, input.initializer);
    if (input.retainOnInvalidation) this.invariantEmpty.add(input.product);
    else this.invariantEmpty.delete(input.product);
    this.invalidators.delete(input.product);
  }
  enterEpoch(path: string) {
    for (const definition of this.definitions.values())
      if (definition.lifetime === "epoch") this.invalidate(definition.id, `${path} epoch boundary`);
  }
  commit(contract: MapProcessContract, by: string) {
    for (const product of contract.invalidates) this.invalidate(product, by);
    for (const input of contract.initializes ?? []) this.initializeEmpty(input);
    for (const product of contract.produces) this.produce(product);
  }
}

export function processRequirements(contract: MapProcessContract): ProductRequirement[] {
  const inputs = new Map(contract.requires.map((product) => [product, { product }]));
  for (const input of contract.inputs ?? []) inputs.set(input.product, input);
  return [...inputs.values()];
}

/** Runtime-only native view. Remeshing carries this non-array object by reference. */
class NativeFacts extends Set<string> {
  constructor(readonly ledger: ProductLedger) {
    super();
  }
  override has(product: string) {
    return this.ledger.facts.has(`canonry:${product}`);
  }
  override add(product: string): this {
    this.ledger.produce(`canonry:${product}`);
    return this;
  }
  override delete(product: string) {
    const existed = this.has(product);
    this.ledger.invalidate(`canonry:${product}`, "native workspace change");
    return existed;
  }
  override clear() {
    for (const product of this.values()) this.delete(product);
  }
  override get size() {
    return [...this.values()].length;
  }
  override *values(): SetIterator<string> {
    for (const fact of this.ledger.facts)
      if (fact.startsWith("canonry:") && fact !== "canonry:workspace") yield fact.slice(8);
  }
  override keys(): SetIterator<string> {
    return this.values();
  }
  override *entries(): SetIterator<[string, string]> {
    for (const value of this.values()) yield [value, value];
  }
  override [Symbol.iterator](): SetIterator<string> {
    return this.values();
  }
  override forEach(
    callback: (value: string, value2: string, set: Set<string>) => void,
    thisArg?: unknown
  ) {
    for (const value of this.values()) callback.call(thisArg, value, value, this);
  }
}
export function nativeFactsManaged(facts: Set<string>) {
  return facts instanceof NativeFacts;
}
export function invalidateNativeProducts(state: GenerationState, products: string[], by: string) {
  const facts = state.physical!.map.AvailableFacts;
  for (const product of products) {
    if (facts instanceof NativeFacts) facts.ledger.invalidate(`canonry:${product}`, by);
    else {
      facts.delete(product);
      state.facts.delete(`canonry:${product}`);
    }
  }
}
export function bindNativeFacts(state: GenerationState, ledger: ProductLedger) {
  if (!state.physical || state.physical.map.AvailableFacts instanceof NativeFacts) return;
  for (const fact of state.physical.map.AvailableFacts) ledger.produce(`canonry:${fact}`);
  state.physical.map.AvailableFacts = new NativeFacts(ledger);
}
/** Strip runtime adapters before serializing observed/completed state. */
export function detachNativeFacts(state: GenerationState) {
  if (state.physical)
    state.physical.map.AvailableFacts = new Set(state.physical.map.AvailableFacts);
}
