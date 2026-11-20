# Earlier study of settlement order clearing

This study explored per-pass allocation of goods, shifts and services. The [current settlement design](../settlement-feedback-design.md) uses changes to places as the unit of development. The [clearing example](settlement_feedback.py) remains available for comparison.

## State and rule types

The four verbs below are reader-facing headings. Authors need finer distinctions. A building can supply a passive capacity with an empty room, undertake an activity only when someone orders it, or respond to work that another building actually completed. Those have different activation rules.

```text
Owner       = Holding(id) | External(id)
Resource    = Good(good_id) | Capacity(shift | bench | vat | ...)
Deliverable = Good(good_id) | Service(service_id)
Account     = Inventory(owner, good_id) | Means(owner)
Channel     = Nuisance | Clearance | Protection
Reach       = Here | ServedEndpoint | Along(actual_route) | Local(channel_kernel)

Installed   = (owner, space_use, usable_area)
Facility    = (owner, capacity_key, available_units_per_pass)
Program     = (one_deliverable, access_mode, required_facts,
               positive_input_costs[], emissions_per_firing[])
Order       = (buyer, acceptable_deliverables_in_preference_order[], units, priority)
Receipt     = (operator, buyer, program, units, actual_route)
Patronage   = (payer, operator, eligible_clients, service,
               minimum_distinct_clients, payment)
```

The existing four `Operation` values describe why premises are related. They are not four commodities. In the proposed binding, a worker travels from a household to a workplace under `Work`; a filled assignment reserves one household shift and grants one staffed shift to that workplace for the pass. A goods delivery records `Supply` at the receiving end. A consumer visit records `Customers` at the operator. A washing visit can therefore be both a customer's visit and the customer's `Service` tie, with **one** physical journey. Record one receipt and project its two views. Where a workplace receives both rent and sales, those transfers retain their payer and payee. The executable model begins with assigned shifts and resolved routes as inputs; it does not invent a labour market, prices or a pathfinder.

| State class | Owner and lifetime | Composition |
| --- | --- | --- |
| Physical capacity | Fabric owns the floor, berth or room until an edit changes it. | Mixed uses divide the usable area. Closing a workshop frees its operating capacity while the building remains. |
| Reusable operating capacity | Premises receives staffed shifts, bench places or vat capacity for one pass. | Each firing consumes from the same local pool across programs. Unused shifts expire. Reopening a shop cannot restore a shift already allocated elsewhere that pass. |
| Stock | A named owner retains goods or means until a transfer, use or loss. | Debit the source. Transfer a good to the receiver, or consume it in an operation. Credit patronage from the payer's purse. |
| Condition or right | The relevant owner answers a read-only predicate for this site, route or counterparty. | Water, a maintained door or a right of passage enables a rule without being spent. Consumable water would instead be an input stock. |
| Rate and event | The active program produces emissions and fulfilled receipts. | Nuisance has a source and a local exposure kernel. Service accrues to its actual beneficiary. Travel loads the edges of its actual route. Each event is consumed once by each interested owner in the scheduled pass. |

### Firing and resolution

For a program at site `s`, an order `o` and snapshot `t`, the following is the maximum transferable lot before competing orders are considered. All terms are in units of that program's output.

```text
eligible = output ∈ o.accepts ∧ required_facts ⊆ facts[s,t]
           ∧ route(s, o.buyer, program.mode, t) exists

max_lot = 0                                                    if !eligible
        = min(o.remaining, min_i floor(available[s,i]/cost[i])) otherwise

fire(q), 0 < q ≤ max_lot:
    available[s,i] -= q * cost[i]                 for every input i
    o.remaining    -= q
    issue Receipt(s, o.buyer, program, q, route)

resolve(receipt):
    Good(g)    → credit inventory[buyer,g] for next livelihood pass
    Service(k) → deliver units to the service owner at buyer this pass
    Emit(k,n)  → contribute units*n at operator to the owner of k
    Journey    → movement reads route and units on its next scheduled pass
```

For the reference cases, order priority precedes travel cost, then the buyer's substitute preference. At equal rank, allocate one output unit per eligible candidate per sweep, using stable endpoint order for a remaining indivisible unit. The program debits **all** inputs together, so a failed dye order cannot consume the cloth needed by a different customer. Imported material can be ordered and delivered this pass but cannot be consumed recursively in this clearing. Goods used for final consumption must be debited by their consuming owner. The fixture stops at delivery for finished cloth. The Python sweeps describe allocation semantics on small inputs. A production solver would use the existing access index and clear equivalent lots in batches.

These are proposed policies with visible consequences. A court buying dyed cloth ahead of households buying plain cloth wins only if its order has seniority. Population alone confers no seniority. A different institutional settlement can supply different order priorities through its rights and obligations.

### A non-production combo

A guild can endow a washhouse on condition that it serves **two distinct eligible courts**. Both visits must have occurred. The following rule fires at most once per contract per livelihood pass when its owner settles the completed receipts.

```text
B = {r.buyer | r ∈ settled_receipts, r.operator == contract.operator,
               r.output == Clearance, r.buyer ∈ contract.eligible_clients}
if |B| ≥ 2 and means[payer] ≥ payment:
    transfer(payer, washhouse, payment)

waste_next[court] = max(0, waste_open[court] - clearance_served[court]) + fresh_waste[court]
next_clearance_order[court] = waste_next[court]
```

Here the beneficiary's waste creates the next order. A closed passage concentrates both available service units at one court. The neighboring court accumulates waste, and the washhouse earns no grant. Opening the passage lets both courts qualify. The guild pays from finite means. A subsequent qualifying pass with an empty purse still clears waste but pays nothing. This example separates physical access, fulfilled demand, a distinct-client trigger, an enduring stock and a reversible effect. The linear waste response is the example's explicit owner function. The current Rust sanitation process uses a saturating exposure response instead.

### How an economic result can change the map

A receipt can serve multiple readers without giving the building control over them. Movement reads traversals. Livelihood reads served and unmet orders. An investment owner can evaluate an expansion on its *incremental* benefit. A proposed comparison for a candidate site and program is:

```text
extra_served = clear(with candidate, same opening snapshot).served_by_need
             - clear(existing premises, same opening snapshot).served_by_need
eligible_project = site_fits ∧ sponsors_can_pledge ∧ any(extra_served > 0)
```

This is a definition for comparing small constructed cases. It prevents credit for a new dyer whose sales merely displace an equally accessible existing yard. A real siting process can estimate the difference from outstanding orders, competing capacity and freight costs without running a town twice. Other reasons to build, such as a civic obligation or a less costly route, have their own project criteria. Within the existing schedule, livelihood lands its receipts before investment and construction. New premises join the next operating snapshot. Streets improved by movement can change the routes available to the following livelihood step.

## The common vocabulary

Use four headings for ordinary building descriptions. `House` presents installed space, `Offer` presents available programs or endpoint capacity, `Seek` presents orders, and `Affect` presents emissions or receipt-triggered responses. Several clauses can compose within a building. Adding a new building that uses these clauses requires no change to livelihood, movement or construction.

| Clause | What the author declares | Who acts on it |
| --- | --- | --- |
| **House** | Usable living or working space at these premises. Capacity follows the realized floor area and use. | Occupation and crowding determine whether nearby households can move in, share premises or need another frontage. Empty floor space supplies capacity. Residents supply labour. |
| **Offer** | Work, supplies, service or custom available at an entrance, with an access mode and operating capacity. | Livelihood can bind a reachable partner. A completed match supports occupation and income at the participating premises. |
| **Seek** | The same four kinds of relationship, from the consumer's side. A request names its mode and, where material identity matters, its good. | The operating tie identifies the actual counterparty. Fulfilled ties generate journeys. Unmet demand can support another use of an existing building or a new site. |
| **Affect** | A named local influence. Start with **nuisance, clearance and protection**. Each has its own spatial reach and consumer. | Exposure changes site choice, clearance removes accumulated waste through its owner, and protection reduces costs borne by exposed occupants. |

The common parameters already have homes. The four relationship purposes exist as `Operation`. Living space, occupation, means, clearance, protection, nuisance, street wear, construction effort and road effort already have consumers. Keep their distinctions. A builder spends effort, a patron pledges means, a visitor uses access, and wear records journeys. A mill should never have to declare how much road wear, land value or town growth it produces. Those are consequences. For an unusual building that actually opens a crossing or reserves ground, use the existing access or land owner's operation and say so separately in the description. [Catalogue contracts](../../crates/atlas-generation/src/town/catalogue.rs) · [Operating economy](../../crates/atlas-generation/src/processes/town/economy.rs) · [Local influence providers](../../crates/atlas-generation/src/atlas/town/providers.rs)

### Three building descriptions, with their consequences

| Proposed building text | Consequence a player could see |
| --- | --- |
| **Courtyard house.** Houses several households on a shared entrance. Its residents seek work and services on foot and offer custom where they can travel. | Several households can sustain one nearby shop. Their repeated trips can make a shared passage worth improving. If the employers close, the court can retain buildings after occupation and traffic fall. |
| **Washhouse.** Offers washing to households within walking reach. While staffed it provides clearance there. | Two crowded courts can support one washhouse. Reduced waste makes the served frontage more habitable. A court behind an impassable wall receives no service merely because it is close on the map. |
| **Tannery.** Offers work. Seeks supplies and buyers by freight. While working it creates nuisance on neighboring parcels. Its specialist operation converts hides into leather. | A yard can attract carriers, sustain a leatherworker, and discourage houses on its immediate boundary. Losing the hide route idles the vats, reducing nuisance and freight traffic before the buildings disappear. |

These illustrate the proposed contract. Today a tannery declares freight access, waterfront siting and nuisance. It cannot declare a hide requirement. A smithy and mill also both qualify as broad production suppliers. The shared `Supply` relationship alone cannot tell a leatherworker whether either has leather. Conversely the clearance loop already has both ends wired: a service provider contributes clearance and sanitation removes waste. Extending that pattern is cheaper and more legible than introducing a town-wide set of building bonuses. [Production definitions](../../crates/atlas-generation/src/town/catalogue/production.rs) · [Sanitation](../../crates/atlas-generation/src/processes/town/sanitation.rs)

## Specialist chains

A specialist adds a **recipe**: named inputs, named outputs and an operating capacity at actual premises. Keep goods in a separate catalogue. Adding leather adds no new influence parameter. A workshop can offer ordinary work and create nuisance through the common vocabulary, and sell a specific output through a recipe. Where output depends on the recipe, tie offers, emissions and journeys to actual throughput. A closed tannery can still house a caretaker.

Every chain needs a final use. A household's provisioning request can accept bread or another declared staple. Fulfilling it by one source reduces the amount another can sell. A binder's request for leather is stricter. An institution seeking testimony can fund a reader's service without buying a physical book. Put acceptable substitutes on the request and offered goods on the supplier. That gives producers a reason to exist outside their own chain and gives the same good several plausible destinations.

| Chain proposal | What makes it an engine |
| --- | --- |
| **Cloth finishing.** Wool from the hinterland → woven cloth → dyed cloth. A dyer also needs dyestuff. | Households can use plain cloth. A court or export buyer creates a second outlet that makes dye imports and a separate finishing yard worthwhile. Losing that buyer can close the dye yard while the weavers keep working. |
| **Food provision.** Grain → flour → bread. Brewing competes for grain. | A single cargo cannot keep the mill and brewhouse fully occupied at once. A reliable grain landing or another farm expands both possibilities. Imported flour can sustain a baker when the mill loses access. |
| **Book production.** Writing material and copying labour → texts. Texts and binding materials → bound volumes. | A working archive, college or distant buyer can sustain binders whom ordinary households alone could rarely support. An archive can also buy completed volumes. The presence of a library does not automatically produce a publishing district. |

In *Farthest Frontier*, milling feeds baking, raw and finished goods have competing uses, and trade can fill a missing stage. For the atlas, those choices matter because they can change **which workplaces survive and where people and freight travel**. Model supplier, transformation, competing outlet and feasible import. Leave conveyor timing, individual deliveries and per-worker inventories out of the proposed town model. [Farthest Frontier resource guide](https://www.farthestfrontier.com/guide/gameplay/resources/)

### When specialization pays

A small town can satisfy ordinary needs through households, mixed premises and its recorded hinterland. A specialist can survive there if an exceptional local resource, institution or export route supplies enough business. A large town has more distinct customers, denser catchments and more competing uses for frontage. Sustained orders can support a dedicated workshop near its suppliers, another near a distant customer, or a carrier between them. Population bands need no recipe unlocks. A capital with no hides and no viable import route still cannot operate a leather district.

For each declared recipe, compare orders reachable from a candidate workplace with the quantity it can actually deliver after inputs, operating space and transport. Count demand already served. Let the existing construction choices compete to share space, expand or establish premises. If an import serves customers more readily, the port might grow while local production remains small. An external endpoint must actually offer the good. Access to a road alone supplies nothing.

### Execution and feedback

1. The POI owns its operating clauses and recipes. An occupied holding instantiates these at its entrances, including any secondary use. Its activities share available space and staff. Regional suppliers and trading connections can offer the same goods through the existing external endpoint contract.
2. Livelihood matches compatible offers and requests using current access. Allocate each supplier's available output among competing requests; do not let each buyer independently claim the whole offer. A converter's realized output is limited by the scarcest required input relative to its recipe and by its own capacity. The resulting ties identify counterparties and amounts that actually moved.
3. Use existing rounds to propagate change. As an initial timing rule, a delivery can be used at the recipient's next livelihood pass. A circular chain cannot create its first input, and a downstream workshop need not wait for an entire district to be built if it can buy inputs from outside. Where storage matters, the receiving premises owns the stock. Visits and service capacity expire or renew through operation.
4. Movement reads the fulfilled trips, sanitation reads exposure, livelihood updates support and means, and construction or collective investment chooses a physical change. Preserve the common sequence across all rounds. When a route closes, outstanding orders can divert, a shop can contract, and a previously crowded passage can lose its reason for widening. A route opening can reverse those decisions.

Magic remains part of these loops through the specific rule a practice changes. A maintained Veil crossing can change which supplier is reachable, subject to its cargo restrictions. Hallowed protection can change who can safely meet and what activity is allowed at the boundary. Pressure requires connected water and suitable divers, Greenwood requires living ground and tending, Fire can change work at a rock face, Aurora can tie readers to evidence in ice, and Salt can tie witnesses to a maintained pan. Each practice keeps its own preconditions, costs and failures. A craft can thus change a route, site or service decision without becoming a generic ingredient. [Craft mechanisms and settlement consequences](../settlement-lore-research.md) · [Shared question ownership](../adr/0011-processes-couple-through-keys-and-a-ledger.md)

## Where the implementation needs to change

1. **Expose what each POI contributes.** Today `Definition::operating_mode` and `Operation::offered_by` infer much of a building's behavior from its activity. Move ordinary offers and requests to readable POI declarations, with reusable defaults for identical behavior. Keep siting preferences separate from operating effects. Give each effect a consumer before expanding the vocabulary. Derive the building description from the same clauses.
2. **Close one ordinary loop and one material loop.** Use reachable washhouse service to exercise the former. For the latter, give two consumers competing claims on one supplied good, then substitute an import for one stage. Check that closing the route changes allocation and the trips presented to movement. These are constructed decisions on explicit holdings and routes. They can be checked before generating any cities.
3. **Give unmet orders a path into spatial growth.** Let the existing siting and investment owners consider the accessible demand left over after local production and trade. Use the same test settlement with and without a sustained finishing buyer. The meaningful difference is whether a separate finishing premises can find both its inputs and its customers. A capital map becomes useful when the question is whether several such catchments produce distinguishable districts.
