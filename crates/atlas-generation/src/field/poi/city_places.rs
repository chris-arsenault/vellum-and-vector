//! A city map's own places: the walls and gates its growth raises (`town::walls`), the
//! prominent places its hot spots raise, its districts and its major works (`town::city`).
//! City growth and the city plan decide them; the catalogue publishes each with its record.
use super::{
    catalogue::CatalogueState,
    contract::*,
    kinds::{Group, Kind},
    values::*,
};
use std::rc::Rc;

/// What one city kind says of itself; the rest of its contract is shared.
struct Says {
    kind: Kind,
    name: &'static str,
    distinct: &'static str,
    arises: &'static str,
    publishes: &'static str,
    journeys: &'static str,
}

fn published<S>() -> Must<Rc<dyn PublicationRecord<S>>> {
    Must::Value(Rc::new(|_: &S, place: &Place| Ok(place.feature.clone())))
}
fn roles<S: 'static>(journeys: &str) -> Roles<S> {
    Roles {
        true_size: Slot::NotApplicable("The published record is drawn at its city-map extent."),
        variety: Slot::Unwritten,
        appearance: Slot::Unwritten,
        account: Slot::Unwritten,
        fields: Fields {
            statement: Must::Value(
                "City places change no physical field; the people pass reads the city they shape."
                    .into(),
            ),
            terrain: Slot::NotApplicable("City places are built or drawn, not landforms."),
            water: Slot::NotApplicable("Water passes city places at their gaps."),
            climate: Slot::NotApplicable("A city place is too small to change the climate."),
            cover: Slot::NotApplicable("Built land already clears its cover."),
            magic: Slot::NotApplicable("City places carry no magical medium of their own."),
        },
        movement: Movement {
            on_foot: None,
            statement: Must::Value(journeys.into()),
            roads: Slot::Unwritten,
            boats: Slot::NotApplicable("Boats pass city places on the water."),
            drainage: Slot::NotApplicable("Water drains past city places."),
            magic: Slot::NotApplicable("No carrier stops at a city place."),
            links: Slot::Unwritten,
            crosses: Slot::Unwritten,
        },
        others: Others {
            statement: Must::Value(
                "Walls ring the built city; gates, markets and halls gather where its ways meet."
                    .into(),
            ),
            needs: Slot::NotApplicable("The city plan decides where each stands."),
            excludes: Slot::NotApplicable(
                "The city plan's own development rounds read what stands.",
            ),
            contains: Slot::NotApplicable("The enclosure question reads walls' cells directly."),
            pairs_with: Slot::NotApplicable("Gates are published with their wall."),
        },
        people: People {
            statement: Must::Value(
                "City places draw, house, protect and channel the city's people.".into(),
            ),
            offers: Slot::Unwritten,
            threatens: Slot::NotApplicable("A city place threatens no one."),
        },
        time: ThroughTime {
            statement: Must::Value(
                "City places stand once raised; an outgrown wall stays inside the city.".into(),
            ),
            fate: Slot::Value(Rc::new(|_, _| Ok(Fate::Persists))),
        },
        visibility: Visibility {
            statement: Must::Value("A city map shows only its prominent places.".into()),
            magnitude: Slot::Unwritten,
            local_conditions: Slot::Unwritten,
            isolation: Slot::Unwritten,
            cultural: Slot::Unwritten,
            importance: Must::Value(Rc::new(|_, _| Ok(1.0))),
        },
        naming: Naming {
            statement: Must::Value("Named for the city, its quarter or its work.".into()),
            named_by: Slot::Unwritten,
            takes_name_from: Slot::Unwritten,
            lends_name_to: Slot::Unwritten,
            term: Slot::Unwritten,
        },
    }
}
fn across<S, Schedule>() -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value(
            "District maps capture the city places that stand in or bound them.".into(),
        ),
        stands_on: Slot::Unwritten,
        carry: Slot::Unwritten,
        realize: Slot::NotApplicable("A captured city place is drawn as captured."),
        counterpart: Slot::NotApplicable("A city place is captured, not refound."),
        unrealized: Slot::NotApplicable("A captured city place keeps its record."),
        settle: Slot::NotApplicable("Water does not move city places."),
        schedule: Slot::NotApplicable(
            "The city plan decides them; no refinement step refinds them.",
        ),
    }
}
fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    says: Says,
) -> Entry<S, Schedule> {
    let kind = says.kind;
    Entry {
        id: kind,
        group: Group::Settlements,
        name: says.name.into(),
        recognition: Recognition {
            distinct: Must::Value(says.distinct.into()),
            is_a: Must::Value(Rc::new(|_, _| Ok(false))),
            landform: Slot::NotApplicable("A city place is built or drawn, not a landform."),
        },
        existence: Existence {
            origins: Slot::Unwritten,
            statement: Must::Value(says.arises.into()),
            way: Must::Value(ExistenceWay::Emerges),
            requires: Slot::NotApplicable(
                "City growth and the city plan decide when its causes meet.",
            ),
            suitability: Slot::NotApplicable(
                "City growth and the city plan decide where it stands.",
            ),
            places: Must::Value(Rc::new(move |state: &S| state.city(kind))),
        },
        publication: Publication {
            delivery: Delivery::Landforms,
            statement: Must::Value(says.publishes.into()),
            moment: Must::Value(Moment::Society),
            record: published(),
        },
        across_maps: across(),
        event: None,
        roles: roles(says.journeys),
    }
}
pub fn wall<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    entry(Says {
        kind: Kind::CityWall,
        name: "City wall",
        distinct: "A wall a city raised round its built land; a building's walls are components.",
        arises: "Raised where threat, power, wealth, ground and builders meet.",
        publishes:
            "Publish each wall's run, with gaps where ground defends and gates where ways cross.",
        journeys: "Journeys cross a wall only at its gates.",
    })
}
pub fn gate<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    entry(Says {
        kind: Kind::CityGate,
        name: "City gate",
        distinct: "Where a way crosses a city wall; a building's doors are components.",
        arises: "Opened where a maintained way meets a wall.",
        publishes: "Publish each gate where its way crosses the wall.",
        journeys: "A gate is where journeys pass a wall; markets and inns gather at it.",
    })
}
pub fn place<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    entry(Says {
        kind: Kind::CityPlace,
        name: "Prominent city place",
        distinct:
            "A place from the settlement catalogue that a city map shows at its rough location.",
        arises: "Raised by development rounds at a hot spot of the city's social fields.",
        publishes:
            "Publish each at its rough location, with its catalogue place, symbol and ground.",
        journeys: "City places draw journeys from across the city.",
    })
}
pub fn district<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    entry(Says {
        kind: Kind::CityDistrict,
        name: "District",
        distinct: "A part of a city map with its own character, which opens as its own map.",
        arises: "Cut round the city's strongest centres, parting along water, walls, main roads and changes of character.",
        publishes: "Publish each district as a region with its population, density, wealth and specializations.",
        journeys: "Journeys cross between districts on the city's ways.",
    })
}
pub fn work<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    entry(Says {
        kind: Kind::MajorWork,
        name: "Major work",
        distinct: "An extraordinary work a city's population can sustain, sited by its own rules.",
        arises:
            "As many as the city's population band expects, each at a site its own rules accept.",
        publishes: "Publish each at its rough location and size.",
        journeys: "A major work draws visitors from beyond the city.",
    })
}
