# NameForge runtime

Standalone TypeScript naming runtime ported from
`the-canonry/apps/name-forge/lib` at `ff9d7991`, with the C# runtime at
`the-canonry-game/src/NameForge.Runtime` (`0f62584c`) reviewed for model injection
and profile behavior. The upstream license is retained in `LICENSE`.

The package owns seeded generation, character Markov training and sampling,
culture profiles, weighted strategies, grammar composition and the existing
phonology → morphology → style pipeline. It imports no atlas code, React, world
schema, filesystem or network loader. Callers supply cultures and in-memory
models. Atlas-specific cultures live in `@atlas/generation`.

```ts
import { generateOne, trainMarkovChain } from "@atlas/name-forge";

const models = new Map([["places", trainMarkovChain(placeSamples, 3)]]);
const name = generateOne(
  culture,
  {
    kind: "settlement",
    seed: "world-seed:stable-place-identity",
  },
  { models }
);
```

Grammars support nested rules, `slot:id`, `markov:id`, `domain:id`,
`context:key`, `^` concatenation, token casing, derivations and truncation.
Profile selection uses an explicit profile, then entity kind, then default.
Higher numeric group priorities win (the upstream TypeScript comments incorrectly
describe the reverse; both runtime implementations sort descending).

Port adaptations: generation is synchronous and requires an explicit seed;
missing resources raise errors instead of producing identifiers or `Name-1`;
Markov names must reach their end marker within the requested length range,
rather than being truncated midword. Training retains full probabilities.
The upstream editor, optimizer, quantitative analysis tools, game-specific
generated context/reference-name extensions and default setting configuration
are outside this runtime package.
