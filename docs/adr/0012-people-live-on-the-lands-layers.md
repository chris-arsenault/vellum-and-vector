# 0012 — People live on the land's layers, and their magic breaks a rule

Owner direction recorded 2026-11-11. Extends
[ADR 0010](0010-processes-and-materials-meet-through-modes.md) and
[ADR 0011](0011-processes-couple-through-keys-and-a-ledger.md); applies
[ADR 0009](0009-named-entities-persist-and-cells-are-shares.md) to people.

## Context

People were held in records beside the map: catchments with population groups, connections
between them, works as demands and a list of events. The land read those records through
special paths, a regional map had its own village, field and road model, and a world could be
generated with people and no geology. Every new interaction between people, land and magic
needed a new path between two structures that did not share a representation.

The owner asked for people to work as rock does: something the land carries, that processes act
on through one interface, and that a finer map inherits like any other band. The owner also
ruled on magic. People's use of a magic system must be extraordinary, not hauling material or a
better harvest, and it must enter through the architecture, with no special cases inside the
processes it changes.

## Decision

- **Layers, not records.** People are bands on the map's mesh, each a value per area of ground:
  how many live there, the shares of ground under crops, under herds and built on, how long a
  built place has stood, what remains of places that are gone, and an identity column. The
  column holds a few layers of people per cell, each with the tongue, faith, custom, allegiance
  and craft it holds, how firmly, and for how long. Traditions are named entities; the column
  refers to them by code. One owner writes these bands, through registered operations. No
  record says where people are.
- **One pass, repeated.** People act in passes. A pass puts land to feeding them, grows them
  into what feeds them, moves them along the going, builds where they stay, and lets the ground
  keep the years. Each step is one aggregate act sized by the years the pass stands for and
  reads what the last step left. Loose people inside a geological epoch and settled people in a
  human era run the same pass with different facts. Before a pass people meet what the land did
  since they last looked: what was drowned, buried, scoured or struck.
- **Shared questions both ways.** People ask the land what it feeds, what a step costs and what
  season it gives, through the shared questions of ADR 0011. The land asks what holds the
  ground the same way. A physical process names no human layer, and people's code writes no
  ground, water, ice or climate.
- **Everything on the map is read from the layers.** Settlements, ruins, hinterlands, ways,
  cultural regions, realms and their frontiers, dams, events and hazards are found by
  classifiers that read the layers and the land, and are published by the place catalogue. A
  run keeps the names of the places it has found so a town stays the same town while its crowd
  grows, shrinks and moves. Inspection reads a place's record and the records that name it.
- **Identity is carried by people.** Tongues, faiths and customs move with the people who hold
  them, spread by contact along the going, drift apart in isolation and set harder the longer
  they are held. A realm is an allegiance founded at a seat and spread by reach; it never
  rewrites what its people speak or believe.
- **Magic breaks a rule.** Each magic system offers people a craft, learned where its medium
  lies under them and held as a tradition in the column. A craft does not add to a yield. It
  breaks a rule some existing process obeys: a responder on a shared question that replaces the
  answer, for the share of people who practise it. The process that asks the question does not
  change and does not know. Practising leaves marks on the ground, which the catalogue
  publishes as places.
- **Geology always runs.** Every world has generated land. Magic and people stay selectable.
- **A finer map inherits and goes on.** A regional map inherits the layers and the places its
  parent named. Its people live the same pass once in each round of development, with one fact
  changed: their number stays what the parent says. Its places, ways and crossings are read by
  the same classifiers and published by the same catalogue. Nothing is written to the parent,
  and no era is lived again. A round's redrawing of relief is not an event in the land's
  history: soil and what grows in it stay on the surface as it is redrawn.

## Alternatives

- **Keep records and add bridges.** Each new interaction would add another path between records
  and fields, and a regional map would keep a second model.
- **An entity-component rebuild, or state rebuilt by replaying a history log.** Both replace the
  field as the place facts live. History explains; the layers are the authority.
- **A recipe table per pair of magic system and human activity.** The table grows with both
  lists, and each row is a special case inside a process.
- **A separate regional people model conditioned on the parent.** Two models disagree about
  what a place is, and each change has to be made twice.

## Consequences

- A new kind of place is a catalogue entry that reads the layers. A new way magic bends people's
  lives is a responder on a question. Neither edits the pass.
- A rule can only be broken once it is a question. An effect whose rule is still written inside
  a process waits until that rule is asked.
- Counts are not kept by group. What a creator edits on a settlement is reconciled on its
  record; the layers stay what generation made.
- A coarse value is a share of the ground beneath it. A finer map moves people to where its land
  suits them, so a town gains a shape there. Built ground and remains inherited as an even
  share do not yet gather the same way.
- Architecture tests in `packages/generation/src/human` and
  `packages/generation/src/regional` hold the boundaries: one writer, no human band named
  outside people's code, one publisher of places, and no people model in the regional namespace.
