import type { Culture } from "./types/project.js";
import type { MarkovModel, MarkovOptions } from "./markov.js";

export interface GenerationContext {
  culture: Culture;
  rng: () => number;
  models: ReadonlyMap<string, MarkovModel>;
  userContext: Record<string, string>;
  markovOptions: MarkovOptions;
  usedMarkov: boolean;
}
