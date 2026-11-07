# Process coupling: architecture analysis and plan

Owner direction, 2026-11-07. Proposal awaiting review; nothing here is built. It applies the method in
section 2 of [MATERIALS-AND-PROCESSES-ARCHITECTURE.md](MATERIALS-AND-PROCESSES-ARCHITECTURE.md) and extends
[ADR 0010](docs/adr/0010-processes-and-materials-meet-through-modes.md). Execution is tracked in the Sulion
plan "Process coupling architecture". Numbers are measured from the code or the saved draft unless marked
as illustrative.

## 1. The problem

Most of the processes exist. They do not act together, and no structure makes them.

**Measured, one saved draft, average height change across land per pass (metres):**

| Process           | Epoch 1 | Epoch 2 (cold) | Epoch 3 |
| ----------------- | ------- | -------------- | ------- |
| Rivers            | -137    | -96            | -70     |
| Ice               | 0       | -70            | 0       |
| Slopes            | -4      | -4             | -1      |
| Coasts            | 0       | 0              | 0       |
| Mean rain on land | 353     | 53             | 256     |

**What the code shows:**

| Finding                                     | Evidence                                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Climate does not reach rivers               | River power uses catchment area and slope; a 7× swing in rain leaves no mark                                                                                          |
| Soil exists, but processes do not act on it | `SoilDepth` is built from rain, ice and erosion, and the ground stack has no soil layer                                                                               |
| Coasts are effectively switched off         | A cap of 12 m a pass; the worst-hit cell loses 5 m                                                                                                                    |
| Only 5 of 68 steps use the process contract | Rivers, solution, ice and two slope steps                                                                                                                             |
| Reads are undeclared                        | Each process reads what its author remembered. The step contracts name coarse facts and came from Canonry's layers, so a hookup can be missing with nothing to notice |
| Writes go straight in                       | Mountains, volcanoes and magic write bands directly. `magicFeedback` writes temperature and ice thickness itself                                                      |
| Moves are a hand-kept list                  | `transportHistory` names each band it carries, in lists sorted by how it combines. A new band that is left out does not move with the crust                           |
| Amounts of work are arbitrary               | 13 river iterations, 4 and 2 slope iterations, and limits stated "per pass"                                                                                           |
| Nothing balances                            | Only crust keeps partial books; nothing checks that what left one place arrived somewhere                                                                             |

**The pattern exists in three places already, in three different shapes:** `Ground` does double dispatch for
wear, `PoiFieldChange` and `poiEffects` declare commands and collect them per band and cell, and
`regional/media` keeps contributions with floors and ceilings. Geology's own writes use none of it.

### Why caps exist, and why they are wrong

A per-pass cap stands in for something the model lacks:

| What the cap stood in for      | What replaces it                 | Where it lives       |
| ------------------------------ | -------------------------------- | -------------------- |
| Competing for limited material | Supply answers demand            | The aggregator (4.4) |
| What a driver can carry        | A capacity asked of the driver   | A keyed answer (4.2) |
| Keeping the numbers stable     | A stepping rule or stable solver | The driver (4.6)     |

A cap also hides a missing link: if rivers cut 60 m at most whatever the rain, the rain never had to be
connected.

## 2. Applying the method

**Axes.** Five things grow independently, and each pair that meets needs a representation:

| Pair                                      | Today                      | Representation                    |
| ----------------------------------------- | -------------------------- | --------------------------------- |
| Process × material                        | Solved by modes (ADR 0010) | Double dispatch, extended in 4.3  |
| Process × what it needs to know           | Hand-written reads         | **Method key and response** (4.2) |
| Process × process, competing for material | Order of writes decides    | **Command aggregator** (4.4)      |
| History event × quantity                  | Hand-kept lists            | **Visitor over quantities** (4.5) |
| All of these × map scale                  | Scale rules per process    | Stays with each process           |

**Refuse the ownership question.** "Should rivers read rain, or should climate feed rivers?" fails both ways. So
does "does magic edit the river, or does the river know about magic?" Each pairing goes through a key.

**Domain structure.** Each of these exists in the physics: a question has several causes that combine, an
action really passes through a stack, material really is shared out when there is not enough, and an event
really does something different to each thing it reaches.

**Read, decide, write.** Asks read. Actions and processes decide. Commands write, and one ledger applies them.

**Default for the many, intercept for the few.** A kind of quantity answers an event by default, a family of
rock answers a mode by rule, and a responder adds to an answer only where it has something to add.

## 3. Choosing the architecture

The owner's named paradigms were examples of the thinking expected, not requirements. Each option below is judged
against what this task needs:

1. A hookup cannot be silently missing, and adding something does not mean remembering to edit other things.
2. Hot loops run over hundreds of thousands of cells on typed arrays, in a browser worker, with no allocation per cell.
3. Results are deterministic, and order stays explicit because order here is physics.
4. Material balances, and a failed balance is visible.
5. It wraps existing process bodies, with no rewrite and no new storage.

### What the test changed

Holding each piece to those five points, the design's shape stays and its foundations change:

| Part                | First described as       | What it really is                                                                                                                                   | Why it matters                                                                                                                                                                                                             |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reads               | Method key and response  | **Incremental derived quantities**, like spreadsheet cells or Adapton and Salsa queries: a key, named contributors, memoized until an input changes | The freshness rule comes free. Bands carry a revision, an answer recomputes only when an input's revision moved, and the hand-kept `requires` and `invalidates` lists go. The earlier "recompute at each stage" was cruder |
| Writes              | Command aggregator       | **A stock-and-flow model**: pools are stocks and transfers are flows, which is the domain's own structure and carries its conservation rule         | Budgets become the foundation. Buffering and sharing are needed only where processes really compete, so they are not the core                                                                                              |
| Competing processes | Every stage simultaneous | **Sequential by default.** A stage is simultaneous only when its processes are declared to compete                                                  | Keeps explicit order, and changes today's map far less                                                                                                                                                                     |
| Moves               | Visitor over quantities  | **A table of quantity kinds**: a type object with one policy per event                                                                              | Events are few and fixed, and kinds answer by data. No visitor is needed, and calling it one was fitting the design to a name                                                                                              |
| Stack               | Double dispatch          | **Double dispatch, kept.** Both sides really do vary: process mix and layer                                                                         | Confined to the ground, where it is justified. It is not a general pattern here                                                                                                                                            |
| Process view        | Typed view               | **Capability passing**: a process holds only the authority it is given                                                                              | The enforcement mechanism, needing no framework                                                                                                                                                                            |
| Hot loops           | Compiling                | **Data-oriented design**: structure of arrays, kernels over bands, tables resolved ahead of time                                                    | Already how this code works, and it governs everything above                                                                                                                                                               |

The result is a **stock-and-flow core, with incremental derived quantities for reads, double dispatch at the ground
only, table-driven quantity kinds, and capability-limited processes.**

### Also considered and rejected

| Option                               | Why not                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Bond graphs and port-based modelling | Rigorous for energy coupling, but we do not model energy, and it would mean re-deriving every process                              |
| Petri nets as an engine              | Their conflict rule for shared tokens clarifies competing processes, but discrete firing does not fit fields of continuous amounts |
| Actors and message passing           | They solve concurrency, and this runs deterministically in one worker                                                              |
| Rule engines, Datalog                | Fine for sparse facts, far too slow and opaque per cell                                                                            |
| Algebraic effects                    | The fit is good, but TypeScript has no support; capabilities give the part we need                                                 |
| Automatic scheduling                 | Breaks point 3; declarations check the order instead of deciding it                                                                |

### The paradigms reviewed

| Paradigm                                    | What it gives                                               | Verdict here                                                                          |
| ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Classic Visitor                             | New operations are cheap; a new element edits every visitor | **No, as written.** Too many kinds; this trade-off is its known weakness              |
| Default Visitor, by family                  | A visitor handles families and falls back                   | **Yes.** Rock families and quantity kinds                                             |
| Double dispatch                             | The result depends on both sides                            | **Yes, the core.** Extended beyond rock (4.3)                                         |
| Dispatch table (compiled multiple dispatch) | Double dispatch resolved ahead of time, in arrays           | **Yes.** How it stays fast; modes compile this way already                            |
| Method key and response                     | The caller sends a key; whoever answers it answers          | **Yes.** How processes read (4.2)                                                     |
| Chain of Responsibility                     | Several parties shape one answer                            | **Yes.** Answers compose; the stack composes                                          |
| Command                                     | A declared change as data, one writer                       | **Yes.** All land writes (4.4)                                                        |
| Aggregator                                  | Messages sharing a key combine into one result              | **Yes.** Commands by cell and pool (4.4)                                              |
| Command buffer (ECS)                        | Changes recorded, then played back at a set point           | **Yes.** Within a stage nobody sees another's writes                                  |
| Event sourcing                              | History reconstructed from a record of changes              | **In part.** Keep the record by cause for tracing, with no replay                     |
| Mediator                                    | Parties talk through one object                             | **Yes, implicitly.** The ask table and aggregator are it; no extra class              |
| Observer, publish and subscribe             | Anyone may react at any time                                | **No.** Hidden order; order here is physics                                           |
| Bridge                                      | Two hierarchies vary through an abstraction                 | **Yes.** Modes already; keys are the same idea for reads                              |
| Blackboard                                  | Shared state                                                | **Already `PhysicalField`.** Direct access is the fault, so it moves behind the above |
| Entity Component System                     | Cells as component bags                                     | **No storage change.** Bands stay; we take declared access and buffers                |

**Scientific frameworks, which reached similar answers:**

| Source                   | What it shows                                                                                           | Verdict                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| xarray-simlab, FastScape | Processes declare in, out and inout variables; only one may compute a variable                          | **Take** declared access and one-writer rule     |
| Landlab                  | Components share named fields, with tables of users and providers; names drift because it is convention | **Take** the generated tables. Ours are enforced |
| CESM, ClimaCoupler       | Driver sequences components; coupler must conserve or the model drifts                                  | **Take** sequencing and budget checks            |
| Implicit river solvers   | An O(n) solver removes the main numerical case for a cap, though long steps can still misbehave         | **Evaluate** in the wear phase                   |

**Limits of this review.** My searches confirmed the Visitor, multiple dispatch, Aggregator, command-buffer,
incremental-computation and stock-and-flow descriptions. They returned nothing on method-selector dispatch or
sediment-flux models, and I did not search capability-based design. Those verdicts come from what I know. Sections
4.2, 4.4 and 4.5 still carry their first names, with the corrections above taking precedence where they differ.

## 4. The design

```text
                  ┌───── ask(key) ──▶ responders compose ──▶ answer         READ    (4.2)
process ──────────┤
                  ├───── act(mix) ──▶ cell's stack, each layer answers       DECIDE  (4.3)
                  │
                  └───── demand(pool→pool, cause) ──▶ aggregator ──▶ ledger  WRITE   (4.4)

history event ──▶ every quantity answers by its kind                         MOVE    (4.5)
```

### 4.1 Process contract

One entry, the only registration. A process's body cannot reach the field: its view holds asks, the ground, and
the demand call. Lint forbids field access from a process module, extending the rule that keeps rock bands in
`rock/`. Illustrative:

```ts
const streams = process({
  id: "streams",
  statement: "Water falling faster than its load requires cuts by the power it carries.",
  asks: [Keys.discharge, Keys.drop, Keys.loadCapacity],
  acts: flowing, // its mix of modes
  settings: streamSettings,
  run({ ask, ground, demand, span }) {
    /* routes; acts through the ground; demands what it took */
  },
});
```

Mountains, volcanoes, support, coast, sediment and plates join this contract too, so it stops being only for wear.

### 4.2 Method key and response: how a process reads

A **key** names a question, not a band: `discharge`, `wetness`, `frost`, `waveEnergy`, `looseSupply`,
`loadCapacity`, `rootHold`, `heat`. The asker names the key and never learns who answered.

**Responders register against a key.** Each says what it adds and how it combines:

```ts
// Illustrative
answer(Keys.wetness, "climate", { base: (i) => runoff(i) });
answer(Keys.wetness, "wetlands", { add: (i) => wetlandCover(i) * held });
answer(Keys.wetness, "greenwood", { add: (i) => springFlow(i) }); // a magic system's own medium
answer(Keys.frost, "aurora", { add: (i) => charge(i) * chill });
```

- **Composes as a chain.** One base, then additions and scales, in a declared order. This is the same shape as the
  stack and as `regional/media`.
- **Extends in both directions.** A new responder edits no asker. A new asker edits no responder. Rain reaches
  rivers because `discharge` is answered from runoff, so nobody edits rivers when a new thing changes runoff.
- **Fast and always fresh.** An answer resolves into a band when asked, and stays memoized until the revision of
  something it reads has moved. Band-level revisions keep this cheap, with no per-cell dispatch. A stale read cannot
  happen, which is what the hand-kept `requires` and `invalidates` lists tried to prevent.
- **Traceable.** An answer can report who contributed, which is how we see why a cell did what it did.

Magic keeps its own media under ADR 0004: a system responds to the keys its medium touches, in its own terms, and
the generic "altered" effect that ADR rejected remains rejected.

### 4.3 Double dispatch: how a process acts on what is there

`Ground.actOn` already dispatches twice: on the process's mix of modes, then on each layer's answer. The stack grows
to hold what is really on a cell:

```text
plant cover ▶ soil ▶ loose sediment ▶ ice ▶ rock layers ▶ (void) ▶ crust
```

- **Process as visitor, layers as elements.** Each layer takes what it gives up, passes on the rest, and returns a
  **response**: amount taken, what is left, the demands that result.
- **Default by family.** Rock answers by mode rules. `gives` stays for exceptions, and a real interception is added
  only when one needs code.
- **Soil becomes a layer.** Climate and plants already build it, so every process that acts on the ground reaches it
  with no change.
- **Crust at the bottom.** Wear past the rock reaches the root, replacing the hook I added to the ledger.
- **Compiled.** Mix × kind stays a table lookup. Only cells with cover, sediment or soil walk the stack.

### 4.4 Command aggregator: how anything writes

Processes do not write land. They **demand** a transfer between pools, and the aggregator resolves them all at the
end of a stage. This generalizes `PoiFieldChange` and `poiEffects`, which already collect add, at-most and at-least
per band and cell.

```text
pools:  rock ⇄ soil ⇄ moving load ⇄ laid sediment → rock
        continental crust ⇄ root ⇄ ocean crust → arc rock
        ocean ⇄ ice ⇄ runoff
```

```ts
demand(Pools.rock, Pools.load, cell, amount, Causes.streams); // illustrative
```

1. **Buffer, where processes compete.** Steps run in sequence by default. Inside a stage declared simultaneous,
   processes see the same state and not each other's writes, so their order there stops mattering.
2. **Aggregate.** Demands correlate by cell and pool. Sum the demand on a pool.
3. **Resolve.** If demand exceeds supply, each demand is scaled by its share. This is where caps go: a river and a
   slope wanting more soil than exists get what exists, shared.
4. **Apply.** One ledger writes height, column, sediment and pools together.
5. **Record.** Totals by cause and pass are kept, and the books are checked. A failed budget is a bug report.

**No allocation per cell.** Records in earlier design were dropped because hot loops would build an object per cell.
This keeps that decision: a demand is a typed call into a band per pool and cause, and each is one array slot, so the
command is a contract without a runtime object. POI effects, which are rare, keep their object form and feed the same
aggregator.

### 4.5 Visitor over quantities: what history does to everything

An event, such as a plate move, visits every quantity. A quantity states its **kind**, and the kind answers each event
by default:

| Event ↓ / Kind →   | Accumulated            | Maximum          | Category | Conserved pool            | Derived   |
| ------------------ | ---------------------- | ---------------- | -------- | ------------------------- | --------- |
| Moved              | Area-weighted sum      | Largest arriving | Dominant | Conserved move            | Recompute |
| Overlapped         | Sum                    | Largest          | Dominant | Shared by the pool's rule | Recompute |
| New crust in a gap | Zero                   | Zero             | None     | Fresh by the pool's rule  | Recompute |
| Slab sinking       | Lost                   | Lost             | Lost     | Passes to its return pool | Recompute |
| Rifted, unroofed   | By event, same pattern |                  |          |                           |           |

This replaces the hand-kept lists in `transportHistory`, and it is a test failure for a band to have no kind. A new
magic stock or soil property moves with the crust because it was declared. Stranded sea floor gets its answer here:
marine beds riding on what closes are a pool with a rule, and they need not vanish.

### 4.6 Span instead of iterations

Rates are per unit of span, and a pass carries a span. A process states a stable step rule, and the driver picks
substeps; each substep is a stage, ending in the aggregator. Fixed iterations and "per pass" limits go. A span is not
years: it is how much work a pass stands for, as the owner set out.

### 4.7 Caps

| Class                            | Limits                                                                           | Treatment                                                  |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Numerical, keep                  | Crust 800 to 14,000 m, height limit, 8 rock layers                               | One file, each with a stated numerical reason              |
| Wear per pass, remove            | River cut, ice erosion, coast erosion, hillslope transport, lake outlet incision | Supply, capacity, stepping                                 |
| Deposit per pass, remove         | River and ice deposition, marine sediment capacity                               | Load capacity and pools                                    |
| Building per pass, remove        | Root budgets, surface relief, rift thinning                                      | Supply from crust and plate motion                         |
| Hidden bounds, review each       | `mostGiven`, the cover floor in `Ground`, clamps across process files            | Justified as numerical, or removed                         |
| Map thresholds, not process caps | Lake area, river reach length, channel slope                                     | Review separately; these decide what is drawn              |
| Rainfall ceiling                 | `PrecipitationCeiling`                                                           | Review with climate; likely a stand-in for moisture supply |

A lint rule rejects names like `Maximum…PerPass` in process settings.

### 4.8 What replaces remembering

Registrations generate a table of who asks, who answers, who demands and which kind each quantity is. Tests keep it true:

- Every asked key has a base answer, available by that point in the sequence, or it reads the previous pass.
- Every responder's key has an asker, or a declared consumer outside geology.
- Every quantity has a kind, and answers every event.
- Every pool's books close on a small field.
- Mix × kind is defined for every process and every kind. ADR 0010's conformance test already covers rock.
- The contracts generated from Canonry are replaced by this.

### 4.9 Epochs

An epoch is data: tectonic strength, travel, rainfall, temperature, sea level. It reaches processes as answers to keys.
A wet epoch wears more with no code knowing it is wet.

## 5. What stays out

- **Modes and the rock catalogue.** ADR 0010 stands. This extends its method.
- **Bands and working arrays.** Storage does not change.
- **Plate mechanics.** Stays its own model; what it moves joins through the visitor, and what it consumes through pools.
- **Routing and solvers.** How a process finds its power stays private to it.
- **Ecology, magic and society internals.** They join at keys and demands. They are not re-expressed.
- **Sequence.** Keeps the order, because order is physics. Stages say which steps are simultaneous.
- **Canonry.** Research input only. We copy nothing, and this product's goals differ.

## 6. Testing the design on paper

Every edit outside the feature's own module and the shared vocabulary is a defect.

| Example                          | How it works                                                                | Edits elsewhere             |
| -------------------------------- | --------------------------------------------------------------------------- | --------------------------- |
| Rain reaches rivers              | `discharge` answered from runoff                                            | None                        |
| Plants slow erosion              | Already a layer's response; holds for every process                         | None                        |
| A drought epoch                  | Epoch data changes answers                                                  | None                        |
| Fire softens rock                | A responder or stack modifier in Fire's own module                          | None                        |
| Greenwood springs wet the ground | Responder on `wetness`; rivers, slopes and soil feel it                     | None                        |
| Waves move coasts                | Coast joins; `waveEnergy` drives an action on the stack                     | None                        |
| River and slope compete for soil | Aggregator shares it by demand                                              | None                        |
| Old belt wears to a plain        | Action reaches the root at the stack's base; rebound follows the pool       | None                        |
| Sea floor stranded inland        | Marine beds' pool answers "slab sinking" and "overlapped"                   | The event's rule, one place |
| Salt plain from a closed sea     | Water pool empties; demand lays salt                                        | None                        |
| Wind                             | One module; asks `wind`, `cover`; acts on loose layers                      | None                        |
| New magic stock                  | A quantity with a kind; moves automatically                                 | None                        |
| New rock kind                    | One catalogue entry; every process responds                                 | None                        |
| Regional map                     | Same processes; responders such as a region's cone apron added on the child | None outside `regional/`    |

**Open questions:**

- How far keys reach into repeated climate and drainage steps, which also need to run several times per epoch.
- What ice is: a layer, or a process above the ground. Both have reasons.
- Whether simultaneous stages change the map beyond what later tuning can handle, since they differ from today's order.
- Whether "scale by share" is right for every pool, or whether some processes have priority. Water may reach soil first.

## 7. Costs and risks

| Risk                                | Handling                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Rewriting everything                | Contracts wrap existing bodies; algorithms change only for caps and hookups                 |
| Too many keys recreate the mess     | Stop on paper if the table will not fit; a key per band means the design failed             |
| An answer used per cell is slow     | Compile to bands per stage; measure                                                         |
| Stages hide a needed order          | Steps stay in different stages when order is physics                                        |
| Removing caps makes the map explode | Expected first. Each cap comes off with its replacement, on small-field tests, then a draft |
| A framework with no users           | Proved first on five existing processes; nothing generic beyond their needs                 |
| The design shrinks while building   | Report departures and update this file, the failure the materials file recorded             |
| Very large uncommitted tree         | Land the current work first, on the owner's say                                             |

## 8. Plan

1. **Contract, keys and table, no behaviour change.** The contract, keys with base answers only, the aggregator with one
   cause per process and no sharing. Five processes join. Exact replay proves nothing moved.
2. **Quantities answer events.** `transportHistory`'s lists become kinds. Exact replay again.
3. **Hook up wear.** Responders on `discharge` and `wetness`, soil in the stack, coast on the contract. Span and stepping
   come in, and wear caps come off.
4. **Pools and load.** Sharing by supply, load capacity and closed books for rock, soil, load and sediment. Deposition caps go.
5. **Crust and builders.** Mountains, volcanoes, support and plates declare, demand and join crust pools. Remaining caps go.
6. **Remaining land steps and contracts.** Everything left joins; magic writes that touch land become demands and answers;
   the Canonry contracts are removed.
7. **Epochs and the trace.** Epoch roles as data, and a report by cause of what each epoch's ground became, judged on the
   map by the owner's goal.
8. **Close.** Move this to an ADR, update the guides and delete this file.

Sources: [Adapton](https://people.mpi-sws.org/~hammer/adapton-pldi2014.pdf),
[Salsa](https://docs.rs/crate/salsa/0.14.2/source/README.md),
[Stock and flow conservation](https://arxiv.org/pdf/2205.08373),
[BondGraphTools](https://arxiv.org/abs/1906.10799),
[Data-oriented design](https://wikipedia.com/wiki/Data-oriented_design),
[Visitor and multiple dispatch](https://learn.microsoft.com/ja-jp/archive/blogs/devdev/the-visitor-pattern-and-multiple-dispatch),
[Visitor trade-offs](https://www.doc.ic.ac.uk/~jnm/se_third_yr/patterns4-notes.pdf),
[Aggregator](https://docs.redhat.com/en/documentation/red_hat_fuse/6.3/html/apache_camel_development_guide/msgrout-aggregator),
[Unity command buffers](https://docs.unity3d.com/Packages/com.unity.entities@1.3/manual/systems-manage-structural-changes-intro.html),
[Event sourcing](https://docs.axonops.com/data-platforms/cassandra/application-development/patterns/event-sourcing),
[xarray-simlab framework](https://xarray-simlab.readthedocs.io/en/latest/framework.html),
[FastScape processes](https://fastscape.readthedocs.io/en/latest/_api_generated/fastscape.processes.TotalErosion.html),
[Landlab components](https://landlab.readthedocs.io/en/latest/user_guide/components.html),
[Landlab FastscapeEroder](https://landlab.readthedocs.io/en/latest/reference/components/stream_power.html),
[CESM coupler](https://docs.cesm.ucar.edu/models/cpl/7/x26.html),
[ClimaCoupler](https://clima.caltech.edu/2024/07/02/climacoupler-jl-a-modular-efficient-esm-coupler-in-julia/),
[Unity job dependencies](https://docs.unity3d.com/Packages/com.unity.entities@1.4/manual/scheduling-jobs-dependencies.html).
