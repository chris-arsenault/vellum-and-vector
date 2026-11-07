# Materials and processes: architecture method

Use this method to reason about independent extension axes. The implemented mechanisms are described
in [ADR 0010](docs/adr/0010-processes-and-materials-meet-through-modes.md) and
[ADR 0011](docs/adr/0011-processes-couple-through-keys-and-a-ledger.md).

## Method

**Step 1. Find the axes.** Ask what varies independently. Here it is materials and processes. A system
with two independent axes that both grow is an instance of the **expression problem**: a structure that
makes one axis cheap to extend usually makes the other expensive.

**Step 2. Refuse the ownership question.** "Which side owns this rule?" is a warning sign when the rule
depends on both sides. Rules that depend on both belong to the interaction, so give the interaction a
representation.

**Step 3. Put a vocabulary in the middle.** Find the small set of terms both sides can speak: how a
process acts, and how a thing responds. Each side depends on the vocabulary and neither on the other. This
turns M×N pairings into M×K + N×K. If no small vocabulary exists, the axes may not be independent, and
that is worth knowing early.

**Step 4. Look for the physical or domain structure.** Good structure usually already exists in the
domain. Here a cell really is a stack, and an action really does pass through it. Prefer a structure the
domain justifies over one imported from a pattern catalogue.

**Step 5. Separate reading, deciding and writing.** Queries return values without changing domain state.
Decisions use shared operations to apply effects. Name immediate writes and deferred settlement explicitly
so callers can reason about when another process sees a change.

**Step 6. Default for the many, intercept for the few.** Most cases follow from data and a shared rule.
Exceptions step in explicitly at a named point, without a special case in the general code.

**Step 7. Make it fast by compiling, not by giving up.** Use expressive definitions at load, then compile
them into typed arrays for hot loops. Performance is not a reason for the architecture to collapse into
hand-written formulas, and it is also not free: measure it.

**Step 8. Prove it with examples that were not in the room.** Take a feature nobody has built and write
out what it would touch. An edit to an unrelated process is a design warning; composition and scheduling still need an explicit home. The owner's lava, desertification and deep road examples did this, and each exposed a real flaw.

**Step 9. Say what stays out.** A pattern applied everywhere is a different failure. Record what does not
fit, and why, so the boundary is a decision.

**Warning signs that this analysis is needed:**

- A constant or formula being added to a process file to describe something else's behaviour.
- A lookup or interface gaining one method per caller.
- Two functions that compute nearly the same concept with different terms.
- A config function that has to know the inside of each thing it configures.
- "Which file does this go in?" having no obvious answer.
- A reported design shrinking during implementation without anyone being told.

**Where this should be examined next.** These are candidates, not findings. None has been analysed in this
way, and each needs its code read first:

- Magic systems × the media they act through (ADR 0004 and ADR 0007 set direction; confluences are
  interactions between systems).
- POI kinds × the fields they affect (`PoiFieldChange` is already a command; the question is whether the
  rest follows).
- Regional refinement causes × processes (`FeatureCause` is a hook registry).
- Biome and ecology cover × disturbance and climate.
- Networks (roads, rivers, deep roads) × the cost surfaces they read.

### Reviewing the classic paradigms

| Paradigm                              | What it gives                                             | Verdict here                                                |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| Classic Visitor (`visitGranite`, ...) | New processes cheap; each new kind edits every process    | No: 25 kinds and growing makes it brittle                   |
| Default Visitor, by family            | A process handles families and falls back to a default    | Yes, for queries and interception                           |
| Double dispatch (`actOn` / `receive`) | Result depends on both sides                              | Yes, the core                                               |
| Bridge                                | Two hierarchies vary independently through an abstraction | Yes, the modes                                              |
| Chain of Responsibility / Decorator   | Each thing on a cell changes an action as it passes       | Yes, the stack                                              |
| Command                               | Declared effects, one writer                              | Yes; POIs already do this                                   |
| Type Object / Flyweight               | Kinds are shared data, not classes                        | Already what the catalogue is                               |
| Entity Component System               | Cells as bags of components                               | No: per-cell bands already exist, and it would be a rebuild |
| Strategy                              | Swappable rule inside one owner                           | No: this is the binary ownership that failed                |
| Blackboard                            | Shared state that processes read and write                | Already what `PhysicalField` is; not a design to add        |


## Extension boundaries

Adding voids for mines or deep roads, additional loose material kinds, or another attack mode requires
a concrete consumer. A void at coarse map scale would represent a share of a cell, and a design must
explain how erosion reaches it. Queries through the existing column do not supply a void representation.
These remain future design questions, not requirements of the current process refactor.
