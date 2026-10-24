# 0004 — Couple the pillars through each system's own medium

User direction recorded 2026-10-23 and 2026-10-24. Applies to the generation
of society, magic, climate and geology as four pillars that shape one another.

## Decision

Each magic system acts on climate, water, rock and the living landscape through
a medium of its own, and the ecology, society and classifiers read that medium.
Fire quickens living processes, evolves the conduits it flows through and carries
warmth down the rivers below it. Aurora acts through the charge its ice holds:
it keeps ice from ablating, casts a cold shadow and stills the life within. A
Pressure front moves water: it lifts cold deep water where a ray shoals, settles
fog on the coast it faces and leaves warm still water in its wakes, so a large
front changes local climate. Biomes made by magic are named for the system and
the cover it produced. There is no generic "altered" plant group, cover, trait or
biome.

Society reads geography when it settles: each population unit takes the best
site class its country offers (pass, Fire seat, river node, harbour, melt line,
fishery coast, halo edge, plain node) and holds a fortress only when a route
node or hazard gives a reason. At the World profile a unit's works are demands
of its country rather than located earthworks; what a demand does there and how
a finer profile realizes it is [ADR 0005](0005-scale-contract.md).

Society specializes through the same media, and no type is decided at founding.
Each population group carries practice shares beside its language shares: a
distribution over the livelihoods the support formula yields and an engagement in
each magic practice. Doing writes the shares: every cycle they relax toward what the
community's country yielded and what its magic ledger shows in use. The shares raise
the yield of their own channel by a bounded, per-channel factor, and skilled hands
mine, read and dive more; fishing costs the fauna of the waters fished, as hunting
costs the herds. The shares steer seeking: migrants and a seat's political reach
weigh a destination by how far their practices find their medium there. Rivers and
the sea are roads in the travel graph, so a shore people's reach follows coasts.
Language the two ends of a connection share shortens it, so a seat whose people know
many languages reaches further; a language kept by almost no namings is forgotten
over centuries, which is the brake on that loop. A polity's character and the word
its name ends in are read at publication from the communities it holds, never fed
back into behaviour.

A human era can bind to a physical epoch. Bound to an epoch before the present,
it runs inside that epoch as a mobile round whose camps become ruins and whose
works stop being maintained while their physical consequences travel on with the
crust. The binding is structural (the epoch before the final one), never a name.

Non-magical couplings close the loop: living cover binds hillslope transport,
burnt ground gullies, wetlands and peat hold runoff.

Every quantity a profile generates is realized, latent or absent;
[ADR 0005](0005-scale-contract.md) defines the states and what each pillar
produces.

## Alternatives

- A shared menu of ecological effects per system (fertility, blight,
  transformation) and an altered vegetation lineage. Rejected: it says that magic
  changed something without saying what, and every system reads alike.
- Located works at every profile. Rejected: a World cell is tens of kilometres
  across; a five-kilometre earthwork on it is neither visible nor meaningful,
  and withholding it from the map hides the forcing it applies.
- Binding the pre-present round to a named epoch ("Cold age"). Rejected by the
  user: the schedule, not the name, decides where the round runs.
- A nation archetype chosen at a polity's founding (raider, hoarder, trader) that
  drives its behaviour. Rejected by the user: specialization has to emerge from the
  human eras through reinforcement, not from a hand-coded type statement.

## Consequences

Each system's reach, rarity and ecological signature are tuned in its preset and
in the curated controls declared in `packages/generation/src/magicCartography.ts`;
documentation describes the mechanisms and leaves the values to that code. A
land-heavy world shows different signatures from an oceanic one (more cores and
longer warm reaches, a quieter Pressure sea); retuning for that is a product
decision, not a defect. Society output depends on the magic that preceded it,
so a world with magic settles differently from the same world without it.
