"""Earlier order-clearing study accompanying settlement-clearing-study.md."""
from collections import Counter
from dataclasses import dataclass
from enum import Enum, auto
from itertools import groupby


class Good(Enum):
    CLOTH = auto()
    DYE = auto()
    DYED_CLOTH = auto()


class Capacity(Enum):
    SHIFT = auto()
    VAT = auto()
    BENCH = auto()


class Service(Enum):
    CLEARANCE = auto()


class Influence(Enum):
    NUISANCE = auto()


class Mode(Enum):
    FOOT = auto()
    FREIGHT = auto()


class Fact(Enum):
    WATER_AVAILABLE = auto()


@dataclass(frozen=True)
class Use:
    key: Good | Capacity
    units: int

    def __post_init__(self):
        if self.units <= 0 or not isinstance(self.key, (Good, Capacity)):
            raise ValueError("An input must cost positive goods or capacity")


@dataclass(frozen=True)
class Emit:
    key: Influence
    units: int


@dataclass(frozen=True)
class Rule:
    output: Good | Service
    mode: Mode
    requires: frozenset[Fact]
    inputs: tuple[Use, ...]
    emissions: tuple[Emit, ...] = ()

    def __post_init__(self):
        if not self.inputs or len({i.key for i in self.inputs}) != len(self.inputs):
            raise ValueError("Specify a single cost per input and at least one limiting input")
        if not isinstance(self.output, (Good, Service)):
            raise ValueError("Orders can request goods or services")


# One firing delivers one output unit to one beneficiary.
wash = Rule(Service.CLEARANCE, Mode.FOOT, frozenset({Fact.WATER_AVAILABLE}),
            (Use(Capacity.SHIFT, 1), Use(Capacity.BENCH, 1)))
dye = Rule(Good.DYED_CLOTH, Mode.FREIGHT, frozenset({Fact.WATER_AVAILABLE}),
           (Use(Good.CLOTH, 2), Use(Good.DYE, 1), Use(Capacity.VAT, 1),
            Use(Capacity.SHIFT, 1)), (Emit(Influence.NUISANCE, 1),))
sell_cloth = Rule(Good.CLOTH, Mode.FREIGHT, frozenset(), (Use(Good.CLOTH, 1),))


@dataclass(frozen=True)
class Order:
    buyer: str
    # Each alternative satisfies ONE unit of this need.
    accepts: tuple[Good | Service, ...]
    units: int
    priority: int


@dataclass(frozen=True)
class Route:
    cost: int
    edges: tuple[str, ...]


@dataclass(frozen=True)
class Receipt:
    seller: str
    buyer: str
    rule: Rule
    route: Route
    units: int


@dataclass(frozen=True)
class Patronage:
    """A standing contract on a patron's premises; money is carried between rounds."""
    patron: str
    operator: str
    eligible_clients: frozenset[str]
    service: Service
    minimum_clients: int
    payment: int

    def settle(self, receipts, means):
        clients = {r.buyer for r in receipts
                   if r.seller == self.operator and r.rule.output == self.service
                   and r.buyer in self.eligible_clients}
        if len(clients) < self.minimum_clients or means[self.patron] < self.payment:
            return 0
        means[self.patron] -= self.payment
        means[self.operator] += self.payment
        return self.payment


def clear(stock, capacity, facts, catalog, orders, routes):
    """Pure clearing step. Keys are (holding, resource) or (seller, buyer, mode)."""
    left = stock.copy()
    free = capacity.copy()
    missing = [o.units for o in orders]
    candidates = []
    for i, order in enumerate(orders):
        for seller, programs in catalog.items():
            for j, rule in enumerate(programs):
                route = routes.get((seller, order.buyer, rule.mode))
                if (rule.output in order.accepts and rule.requires <= facts[seller]
                        and route is not None):
                    candidates.append((-order.priority, route.cost, order.accepts.index(rule.output),
                                       order.buyer, seller, i, j, route))
    # Higher priority, then cheaper travel, then preferred substitute. Rotate one
    # unit per candidate at equal rank so one bulk order cannot drain its peers.
    receipts = []
    for _, peers in groupby(sorted(candidates), key=lambda c: c[:3]):
        peers = list(peers)
        while peers:
            live = []
            for candidate in peers:
                _, _, _, buyer, seller, i, j, route = candidate
                rule = catalog[seller][j]
                costs = [(left if isinstance(x.key, Good) else free,
                          (seller, x.key), x.units) for x in rule.inputs]
                if missing[i] == 0 or any(pool[k] < n for pool, k, n in costs):
                    continue
                for pool, k, n in costs:
                    pool[k] -= n
                missing[i] -= 1
                receipts.append(Receipt(seller, buyer, rule, route, 1))
                live.append(candidate)
            peers = live
    arrivals, service, influence, trips = Counter(), Counter(), Counter(), Counter()
    for r in receipts:
        output = r.rule.output
        account = arrivals if isinstance(output, Good) else service
        account[r.buyer, output] += r.units
        for effect in r.rule.emissions:
            influence[r.seller, effect.key] += r.units * effect.units
        for edge in r.route.edges:
            trips[edge, r.rule.mode] += r.units
    return left + arrivals, service, influence, trips, missing, receipts


def example():
    stock = Counter({("yard", Good.CLOTH): 6, ("yard", Good.DYE): 2})
    capacity = Counter({("yard", Capacity.VAT): 3, ("yard", Capacity.SHIFT): 3,
                        ("washhouse", Capacity.BENCH): 2, ("washhouse", Capacity.SHIFT): 1})
    facts = {p: {Fact.WATER_AVAILABLE} for p in ("yard", "washhouse", "port")}
    catalog = {"yard": (dye, sell_cloth), "washhouse": (wash,), "port": (sell_cloth,)}
    orders = [Order("court", (Good.DYED_CLOTH,), 3, 1),
              Order("homes", (Good.CLOTH,), 4, 0),
              Order("court", (Service.CLEARANCE,), 2, 0),
              Order("homes", (Service.CLEARANCE,), 2, 0)]
    routes = {("yard", "court", Mode.FREIGHT): Route(4, ("quay",)),
              ("yard", "homes", Mode.FREIGHT): Route(2, ("lane",)),
              ("washhouse", "homes", Mode.FOOT): Route(1, ("passage",))}
    goods, served, impact, traffic, unmet, _ = clear(stock, capacity, facts, catalog, orders, routes)
    assert goods["court", Good.DYED_CLOTH] == 2 and goods["homes", Good.CLOTH] == 2
    assert served["homes", Service.CLEARANCE] == 1 and served["court", Service.CLEARANCE] == 0
    assert impact["yard", Influence.NUISANCE] == 2 and traffic["quay", Mode.FREIGHT] == 2
    assert unmet == [1, 2, 2, 1]
    del routes["yard", "court", Mode.FREIGHT]
    goods, _, impact, traffic, unmet, _ = clear(stock, capacity, facts, catalog, orders, routes)
    assert goods["homes", Good.CLOTH] == 4 and not impact and not traffic["quay", Mode.FREIGHT]
    assert unmet[:2] == [3, 0]
    # An import can restart an idle converter only after the cloth arrives.
    imports = Counter({("port", Good.CLOTH): 2, ("yard", Good.DYE): 1})
    routes["port", "yard", Mode.FREIGHT] = Route(3, ("dock",))
    routes["yard", "court", Mode.FREIGHT] = Route(4, ("quay",))
    jobs = [Order("yard", (Good.CLOTH,), 2, 0), orders[0]]
    received, _, _, _, missing, _ = clear(imports, capacity, facts, catalog, jobs, routes)
    assert missing == [0, 3]
    finished, _, _, _, missing, _ = clear(received, capacity, facts, catalog, [orders[0]], routes)
    assert finished["court", Good.DYED_CLOTH] == 1 and missing == [2]
    print("Open route: 2 dyed, 2 plain. Closed route: 0 dyed, 4 plain. Import: 1 dyed next pass.")

    # A local institution endows service to two courts. Distinct beneficiaries,
    # an open passage and actual use all matter; proximity alone earns nothing.
    contract = Patronage("guild", "washhouse", frozenset({"court", "homes"}),
                         Service.CLEARANCE, minimum_clients=2, payment=1)
    means = Counter(guild=1)
    waste = {"homes": 2, "court": 2}
    capacity["washhouse", Capacity.SHIFT] = 2
    for passage_open in (False, True, True):
        if passage_open:
            routes["washhouse", "court", Mode.FOOT] = Route(1, ("gate",))
        requests = [Order(p, (Service.CLEARANCE,), n, 0) for p, n in waste.items()]
        _, served, _, _, _, visits = clear(stock, capacity, facts, catalog, requests, routes)
        paid = contract.settle(visits, means)
        for p in waste:
            waste[p] -= served[p, Service.CLEARANCE]
            waste[p] += 1  # supplied fresh waste from occupation this round
        if not passage_open:
            assert paid == 0 and waste == {"homes": 1, "court": 3}
        elif means["guild"] == 0:
            assert waste == {"homes": 1, "court": 3}
    assert means["washhouse"] == 1
    print("Two visits to one court: no grant. Two courts served: one funded grant.")


if __name__ == "__main__":
    example()
