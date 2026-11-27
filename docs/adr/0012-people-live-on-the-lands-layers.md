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
  and craft it holds, a second tongue it knows, how firmly, and for how long. Traditions are named entities; the column
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
  they are held. Contact teaches a second tongue before it replaces the first, and a known
  tongue fades where no one around speaks it. A tongue in common eases the going, so
  frontiers between tongues slow contact and reach. A realm is an allegiance founded at a seat
  and spread by reach; it never rewrites what its people speak or believe.
- **Places speak a vocabulary; people value it.** A catalogue entry declares what a place
  offers people as benefits, whom each benefit serves (a tradition and its code), what it
  threatens, and which distant cells it joins and at what cost. Once each era a facade reads
  the places standing on the map into bands: benefits, threat, links and the magic meetings
  that strike. People's processes read only these. A needs table
  values the benefits on the `draw` question, and people move toward draw along journeys that
  climb it beyond the next cell, across water, worn ways and links. No people's process names a
  place kind, and no place declares that it draws people.
- **Realms rise and fall with their people.** A realm's strength is its seat's crowd times its
  health and the learning its towns' temples and academies give its people. Health follows the
  share of its people their own ground feeds. A realm holds crowded and ruined ground harder,
  and country its seat's crafts suit more easily. Ground beyond every realm's reach forgets its
  realm. A seat follows its realm's crowd, a close rival contests a town, and a town taken from
  a living realm is besieged, the harder the further that realm has fallen.
- **Survivors flee.** After a disaster, a magic meeting's strike or a siege, a share of the
  survivors moves along the going to the nearest ground with room, and the event records
  how many fled and where.
- **The living land keeps changing through the human eras.** The ecology's development runs in
  each era over the era's years. It asks people how much ground they clear and graze and how
  much game and fish they take, through shared questions, and people's food reads cover per
  share of wild ground.
- **Goods are traded as food is.** People make goods where the land's places offer the means,
  and every people wants them. Each kind clears through the same market rule as food. The goods
  travel routes toward those who want them and wear those routes into ways. What a place sends
  or carries raises its answers to the shared `draw` and `wealth` questions, so it draws people
  and grows richer without any other process calling into trade. No price or stock is kept.
- **Crafts seek their medium.** A mover weighs each destination by how well its media suit the
  crafts the mover's people keep, so crafts cluster where their medium lies and follow it.
- **Busy ways are graded.** Where a way carries enough traffic, people grade its climbs: a
  responder on the `climbing` question, so the way climbs cheaper and steeper. A graded way
  over a pass the map shows publishes as a cut pass.
- **Magic breaks a rule.** Each magic system offers people a craft, learned where its medium
  lies under them and held as a tradition in the column. A craft does not add to a yield. It
  breaks a rule some existing process obeys: a responder on a shared question that replaces the
  answer, for the share of people who practise it. The process that asks the question does not
  change and does not know. Practising leaves marks on the ground, which the catalogue
  publishes as places.
- **Geology always runs.** Every world has generated land. Magic and people stay selectable.
- **A finer map inherits and goes on.** A regional map inherits the layers and the places its
  parent named. Its people roughly match its parent's, and that agreement comes from people's
  refinement processes, which produce roughly equal counts the way the other domains'
  refinement processes do; nothing copies, conserves or fits the parent's number. The child
  starts from sampled households, land use and capital. Regional and city development
  couples market reach, food access, settlement, building and upkeep. Built ground holds
  more people where many live within a short walk, fewer where trade fills its households'
  purse, and as a district's character has them live. On a city map households settle
  where built ground has room, in proportion to how good the location is, and the land's
  own households weigh in with the ground that feeds them. Builders add a share of the
  ground people still lack, on open ground first and on working land where the people
  lacking room outweigh the people the field feeds; ground beyond what its people need
  goes back to the working land round it, or lies open where there is none. Room attracts
  households and households call for room, so good ground fills and then crowds while
  poor ground empties toward what its land keeps. Standing capital gathers on built ground
  with the crowd and trade that keep it. Water and ice
  inform present exposure. Its places, ways and crossings are read by
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
  suits them. Built ground and standing capital start from their own captured shares and
  respond to demand for land and maintenance of existing works. A parent cell's built share
  arrives spread smoothly over its child cells; settling and building bring it to stand
  where the people are, so a child cell does not keep a thin share of a town that stands
  elsewhere.
- The people a square kilometre of built ground houses for ordinary households in a village
  is a shared question, `room`. Settling works out from it how tightly households live at
  each cell, from the neighbours within a walk and the households' purse, and building
  reads that finding. World history does the same at the grain of its cells: after its
  journeys it finds how tightly each cell's people live, builders add a share of the
  ground they lack over the years of the pass, and ground people leave wears to ruin.
- Rust visibility and the compile-fail checks in `crates/atlas-generation/src/human/storage.rs`
  keep one writer of the human layers. `rustFoundations.architecture.ts` requires every human
  owner mutation to pass through the registered command boundary.
