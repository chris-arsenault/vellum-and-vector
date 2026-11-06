# Materials and processes: architecture analysis and plan

Owner direction, 2026-11-06. This file has two jobs:

1. It is the working design for refactoring the rock catalogue and the processes that act on it.
2. It records the way of thinking the owner wants applied across this application. Section 2 is the
   part to reuse elsewhere; it is not specific to rock.

Execution is tracked in the Sulion plan "Materials and processes: double dispatch through the ground".
Numbers in this file are illustrative unless marked as measured. The code holds real values.

## 1. How we got here

### What the owner asked for

Rock settings should live in the catalogue. Processes should sit behind common interfaces, as POIs do,
with dependency inversion and a plugin-oriented model. The owner's complaint was specific: changes were
being made as patches to unrelated files, strewing constants through the code.

### What went wrong, in order

1. **Phase 4 added behaviour as patches.** Rock limiting river, slope and ice cutting was added as a
   private share in the river code, a floor in the glacier file, a new entry in the global profile and a
   length exported from the slope code.
2. **The first refactor moved code without changing its shape.** It introduced `rockResponse` in the
   catalogue, the `Ground` reader and `WearProcess`. An exact replay proved the land did not change. That
   proof was valuable, but it also meant every inconsistency moved intact.
3. **The result was reported more strongly than it deserved.**
   - `Ground` was described as replacing the two definitions of ground. It holds both, as `surface()` and
     `material()`.
   - The contract proposed `capacity`, `reach`, `takes` and `records`. What was built is essentially one
     `wear(work)` function.
   - "A new process is one module and one line" was false. It touches the module, `wearSettings`, the
     profile, the list, the sequence and `nativeContracts`.
4. **The design question was framed as binary ownership.** The agent asked whether a rule belongs to the
   catalogue or to the process. Each answer fails. In the catalogue, `rockResponse` must name every
   consumer, so a road feature would edit the rock catalogue. In the process, nothing keeps two processes
   consistent, and a material can never behave as an exception. The owner identified this: the question
   called for an architecture where neither side owns the rule.

### Evidence of the mismatch

The code as it stands, measured by reading it:

| Reader            | How it uses one resistance number                                         |
| ----------------- | ------------------------------------------------------------------------- |
| Streams           | Divide by a blend of rock and sediment, times roots and burning; no bound |
| Ice               | Divide by relative hardness, floored at 0.6; ignores sediment             |
| Slope angle       | Bounded 0.55 to 1.45, times a jointing term, times a cover term           |
| Slope shedding    | Bounded 0.6 to 2.5                                                        |
| Thrust sheets     | Bounded 0.6 to 1.6                                                        |
| Relief detail     | Bounded 0.6 to 1.4                                                        |
| Channel banks     | Bounded 0.5 to 2                                                          |
| Regional seepage  | Bounded 0.3 to 3                                                          |
| Regional material | Power 0.9, fracture, ward, apron, bounded 0.35 to 3.5                     |
| POI hardness      | Scaled between 700 and 1500, so schist equals quartzite                   |

Consequences that are visible in behaviour:

- On the world map, fractures do not weaken rock under rivers and wards do not protect river banks,
  because those appear only in `material()`.
- Regional routing ignores sediment and roots, because those appear only in `surface()`.
- `erode()` strips sediment and then rock at one rate, set by a blended resistance. A river does not spend
  its power on sediment and then meet the rock.
- Ice cannot treat jointed basalt differently from massive granite of similar resistance.

Some differences between processes are correct, because rivers abrade, ice plucks along joints and slopes
fail on joints and bedding. But they are currently expressed as different limits on one number, and those
limits are accidents of history.

### What extending the catalogue costs today

| Addition                     | Cost today                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| New rock kind                | One entry, appended only: a kind's code is its list position and maps store codes    |
| New property                 | Edit all 25 positional entries                                                       |
| New question about rock      | A `rockResponse` rule and a `Ground` method, so the catalogue knows every process    |
| Rock below the surface       | Missing: `Ground` reads the surface, and nothing outside `rock/` reads deeper layers |
| Loose material kinds         | Missing: sediment is one thickness and one resistance                                |
| A void or tunnel             | No representation                                                                    |
| A process that adds material | No contract: `WearProcess` only removes                                              |

## 2. The method: how to think about this kind of problem

This is the part to apply to other parts of the system.

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

**Step 5. Separate reading, deciding and writing.** Queries return values and write nothing. Decisions
produce declared effects. One writer applies effects. This keeps "each effect has one writer" true by
construction.

**Step 6. Default for the many, intercept for the few.** Most cases follow from data and a shared rule.
Exceptions step in explicitly at a named point, without a special case in the general code.

**Step 7. Make it fast by compiling, not by giving up.** Use expressive definitions at load, then compile
them into typed arrays for hot loops. Performance is not a reason for the architecture to collapse into
hand-written formulas, and it is also not free: measure it.

**Step 8. Prove it with examples that were not in the room.** Take a feature nobody has built and write
out what it would touch. Every edit outside the feature's own module and the shared vocabulary is a design
defect. The owner's lava, desertification and deep road examples did this, and each exposed a real flaw.

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

## 3. The design

### Overview

A process acts on a cell. The action passes down through what is on that cell. Each layer takes what it
gives up, may change the action, and passes the remainder on. Effects are declared and one ledger applies
them.

```text
process ──acts by modes──▶ Action
Action ──ground.actOn(cell)──▶ cover ▶ sediment ▶ rock layers (with modifiers, voids)
each layer ──receive(action)──▶ what it takes + what remains + effects
effects ──▶ ledger (the one writer)
```

### Modes: the vocabulary in the middle

A mode is one way of attacking material. Processes state how they act in modes. Materials are answered in
modes. Neither knows the other.

Candidate set. Phase 1 settles it, and the owner reviews it:

| Mode       | Meaning                                | Reads mainly                          |
| ---------- | -------------------------------------- | ------------------------------------- |
| Abrasion   | Grinding by what water or wind carries | Resistance                            |
| Plucking   | Blocks pulled out along joints         | Jointing, resistance                  |
| Shear      | Failure of a slope or mass             | Jointing, bedding, resistance         |
| Solution   | Dissolving                             | Solubility, porosity                  |
| Excavation | Removal by digging                     | Resistance, jointing                  |
| Heat       | Melting and baking                     | A heat fact, not yet in the catalogue |

Rules for the set:

- Start small. Add a mode only when a real process cannot be expressed without it.
- More than about seven modes, or many exceptions, means the design is wrong. Phase 1 exists to find this
  cheaply.

**Who owns a mode's rule.** The mode does. Each mode is an object with one default rule from a material's
facts to its resistance. This is the third owner that replaces the binary question: facts belong to the
material, how a process acts belongs to the process, and how facts answer an attack belongs to the mode.

```ts
interface Mode {
  readonly id: ModeId;
  /** How a material's facts resist this attack, unless the material says otherwise. */
  readonly resistance: (facts: MaterialFacts) => number;
}
```

All modes share one strength scale and one set of limits, so mismatched bounds cannot grow back.

### Materials: the catalogue

The catalogue holds facts about materials and nothing about processes.

```ts
interface Material {
  readonly id: MaterialId;
  /** Fixed and stored in maps, independent of list order. */
  readonly code: number;
  readonly name: string;
  readonly family: "sedimentary" | "igneous" | "metamorphic" | "broken" | "loose";
  readonly facts: MaterialFacts; // named, not positional
  /** Where this material departs from a mode's rule. */
  readonly resists?: Partial<Record<ModeId, number>>;
  /** The rare material that answers an action in its own way. */
  readonly receive?: Interception;
  readonly underHeat?: MaterialId;
  /** What it weathers into. */
  readonly weathersTo?: MaterialId;
}
```

Changes this brings:

- **Named facts.** Adding a fact stops being an edit to 25 positional calls.
- **Fixed codes.** Order stops mattering, which removes the risk of relabelling rock on saved maps.
- **`loose` family.** Sand, dust and alluvium sit beside granite, and the sediment band gains kinds.
- **Overrides are data.** `resists` covers a material that departs from a rule in a number.
  `receive` covers one that behaves differently in kind, such as kept stone refusing wear.

### The ground: a cell as a stack

`Ground` stops growing one method per question. It has three operations.

```ts
interface Ground {
  /** A process's action goes down through the cell, from the top or from a depth. */
  actOn(cell: number, action: Action, from?: Depth): ActionResult;
  /** A read-only walk of what is there. */
  fold<T>(cell: number, query: GroundQuery<T>): T;
  /** What is at a depth. */
  at(cell: number, depth: number): MaterialReading;
}
```

What is in the stack:

| Layer or modifier | Effect on an action                                                |
| ----------------- | ------------------------------------------------------------------ |
| Living cover      | Binds; absorbs part of what would reach the ground, by mode        |
| Loose sediment    | Gives up first, by its own kind                                    |
| Rock layers       | Each answers by its material, using the column that already exists |
| Fractures         | Weaken what they cross, for modes they matter to                   |
| Wards             | Stop or reduce an action                                           |
| Alteration        | Carries what has been done to the surface                          |
| Void              | A gap in the stack, for mines and deep roads                       |

This removes the `surface()` / `material()` split, because all of these are in one stack for both world and
regions. The regional apron becomes a modifier a region adds.

### Actions and processes

```ts
interface Action {
  /** How much it can do at this cell, in metres of ordinary material. */
  readonly power: number;
  /** How it acts. */
  readonly modes: ModeMix;
  /** How much of the cell it reaches. */
  readonly reach: number;
}
interface SurfaceProcess {
  readonly id: string;
  readonly statement: string;
  /** Its own settings, assembled into the profile. */
  readonly settings: ProcessSettings;
  /** How its settings read on a map of another scale. */
  readonly atScale?: (settings, reading) => Partial<ProcessSettings>;
  /** One pass of its work. */
  readonly run: (work: ProcessWork) => void;
}
```

`run` stays free-form because processes differ in how they find power: streams route water, ice follows
flux, slopes work between pairs of cells. What is shared is how they meet the ground and how effects land.
That is the honest common interface, unlike a per-cell contract that slopes cannot meet.

The name is `SurfaceProcess` for now, but deep roads make "surface" questionable. Phase 1 settles the name.
The owner has ruled out "agent".

### Effects: one writer

`receive` returns declared effects, in the style of `PoiFieldChange`:

```ts
type GroundEffect =
  | { effect: "remove"; layer: LayerRef; amount: number }
  | { effect: "lay"; material: MaterialId; amount: number }
  | { effect: "alter"; layer: LayerRef; change: number }
  | { effect: "record"; history: HistoryBand; amount: number }
  | { effect: "open"; depth: number; amount: number };
```

The ledger applies them and keeps the height, column, sediment and totals consistent. This covers adding
material, which `WearProcess` cannot do. In hot loops effects are written straight to the ledger through
typed calls, without allocating an object per cell. The command is the contract, not necessarily the
runtime object.

### Queries

Slope angle, channel banks, thrust spacing and POI hardness read the ground and change nothing. They become
`GroundQuery` objects owned by their consumers, so `Ground` and the catalogue do not know about them.

### Settings

A process owns its settings. The profile is assembled from the processes, not the reverse. `wearSettings`
goes away. The import loop that caused it is solved by splitting each process's plain settings from its
running code, so configuration can read settings without loading routing. User configuration keeps working
through the assembled profile.

### Performance

The stakes: streams run 13 iterations over every cell, and regional maps are larger.

- **Compile at load.** For each mode and material, resolve resistance once into a `Float64Array` indexed
  by code. A process's `ModeMix` compiles to a table per material.
- **Fast path.** A cell with no layering that matters reads its table entry directly. Only cells with
  cover, sediment or modifiers walk the stack.
- **No per-cell allocation.** Use the existing working arrays and bands. No new data structures unless the
  existing ones cannot serve.
- **Measure.** Compare draft world time before and after. The owner does not mind generation time but does
  mind bad code, so a large regression gets investigated rather than accepted.

### What stays out

- **Tectonics.** Plate movement carries crust whole. It does not act on cells through a stack, though it
  does read through queries and lay rock through the ledger.
- **Routing.** Rivers, ice flow and lava paths are how a process finds its power. They stay in the process.
- **Slope failure's solver.** It works between pairs of cells. It uses queries for what it holds and
  effects for what moves.
- **Ecology.** It writes cover, which is in the stack. It is not itself a process acting through modes.
- **Coast.** It does not read rock today. Whether it should is a question for the mode table.
- **Sequence.** `sequence.ts` keeps the order, because order is physics.

## 4. Testing the design on examples

Each row must hold on paper before code, and again after. Any row that needs an edit to an unrelated process
or to a rule in the catalogue is a defect.

| Process                                  | Acts by                                                    | New material                      | Stays outside the design                |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| River                                    | Abrasion, spent first on sediment                          | None                              | Routing                                 |
| Ice                                      | Plucking and abrasion                                      | None                              | Ice flow                                |
| Solution                                 | Solution                                                   | None                              | Runoff                                  |
| Slopes                                   | Shear, as query and effects                                | None                              | The face solver                         |
| Lava (not to be built here)              | Heat, and laying rock                                      | A lava kind with a runniness fact | Its flow path                           |
| Ejecta (not to be built here)            | Laying a breccia, volume from excavation                   | One kind                          | Ballistic spread                        |
| Wind (not to be built here)              | Abrasion, stopped by cover, reaching loose material        | Loose kinds                       | Dune movement                           |
| Desertification (not to be built here)   | Mostly ecology; the stack feels the cover it lost          | None                              | Nearly everything, correctly            |
| Mine or deep road (not to be built here) | Excavation from a depth; queries for standing and flooding | Void layer                        | Route, in the network; records, in POIs |
| Magic rock                               | Effects to alter and lay; materials that intercept         | Existing kinds                    | The magic system                        |

Open questions in this table that the plan must answer:

- A void in an eight-layer column at 28 km cells must be a share of a cell (ADR 0009).
- How erosion breaking into a void is represented.
- Ore is not a rock property today: mines read magic stocks and placers.

## 5. Costs and risks

| Risk                                  | Handling                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Too many modes recreate the mess      | Stop at the paper test if the table will not fit                                 |
| More machinery than the problem needs | Justified only by the named processes; checked by the examples                   |
| Slower generation                     | Compile to tables, fast path, measure                                            |
| The map changes                       | Exact replay no longer applies; stack order changes results, so judge on a draft |
| The design shrinks in implementation  | Any departure from this file is reported when made, and this file is updated     |
| A large uncommitted working tree      | The earlier refactor is uncommitted; the owner decides when it lands             |

## 6. How it will be judged

- **Mechanism:** tests on small fields state the behaviour. Examples: a river spends itself on sediment
  before rock, jointed rock gives up more to ice than massive rock of equal resistance, a ward stops an
  action, a fracture weakens what it crosses on both world and region.
- **Conformance:** tests over the data, not the map. Every material answers every mode within the shared
  scale. Codes are unique and stable. No process names a material's rule.
- **Structure:** lint and architecture rules. Only the ground reads rock bands, and only the ledger writes
  them. No process imports another's module for behaviour.
- **On the map:** the owner's standard from `judge-phase-by-its-goal` applies. Reason as a cartographer about
  what a draft world shows. Do not chase small numbers.
- **Extensibility:** the examples in section 4 are re-run against the finished contract and every edit they
  would need is listed. Only an edit outside the new feature and the vocabulary counts as a failure.

## 7. Current state of the code

- Committed: phase 3, as `5b3fcb8`.
- Uncommitted: phase 4's behaviour, `rockResponse`, `Ground`, `WearProcess`, the lint rule and ADR 0010.
- ADR 0010 describes the interim design. It is revised at the end of this work.
- A known failing architecture check: a `Map` in `canonry/reactivation.ts`, from phase 3.
- Retired by this work: `rockResponse`, most `Ground` methods, `wearSettings`, `surface()` and
  `material()`, positional `rock(...)` entries and `WearProcess` under that name.
