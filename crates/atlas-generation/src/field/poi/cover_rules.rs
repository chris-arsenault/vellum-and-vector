//! Rule-defined country lies over biome landscapes and reads its owning magic system.
use super::{
    catalogue::CatalogueState,
    contract::*,
    cover_shared as shared,
    kinds::{Group, Kind},
    places, reads, records,
    state::State,
    values::*,
    visibility::Weights,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Country {
    ThawedHalo,
    WildZone,
    GreenwoodStand,
    VerdantGround,
}
impl Country {
    pub const ALL: [Self; 4] = [
        Self::ThawedHalo,
        Self::WildZone,
        Self::GreenwoodStand,
        Self::VerdantGround,
    ];
    fn identity(self) -> (Kind, &'static str, &'static str, &'static str) {
        match self {
            Self::ThawedHalo => (Kind::ThawedHalo, "fire", "halo", "Thawed halo"),
            Self::WildZone => (Kind::WildZone, "veil", "wild", "Wild zone"),
            Self::GreenwoodStand => (Kind::GreenwoodStand, "greenwood", "stand", "Old stand"),
            Self::VerdantGround => (
                Kind::VerdantGround,
                "greenwood",
                "verdant",
                "Verdant country",
            ),
        }
    }
    fn found(self, state: &impl State) -> io::Result<Vec<Place>> {
        let (kind, system, rule, _) = self.identity();
        Ok(places::rule_places(state, kind, system, rule)?
            .as_ref()
            .clone())
    }
    fn read(self, state: &impl State, cell: usize) -> io::Result<f64> {
        match self {
            Self::ThawedHalo => reads::celsius(state.field()?, cell),
            Self::WildZone => reads::magic_value(state, "veil", Channel::Wild, cell),
            Self::GreenwoodStand | Self::VerdantGround => {
                shared::scalar(state, Scalar::Verdure, cell)
            }
        }
    }
    fn typical_area(self) -> f64 {
        match self {
            Self::ThawedHalo => 0.000125,
            Self::WildZone => 0.0000625,
            Self::GreenwoodStand => 0.00003125,
            Self::VerdantGround => 0.00125,
        }
    }
    fn weights(self) -> Weights {
        let (magnitude, local_conditions, isolation) = match self {
            Self::ThawedHalo => (0.25, 0.55, 0.2),
            Self::WildZone => (0.3, 0.5, 0.2),
            Self::GreenwoodStand => (0.25, 0.5, 0.25),
            Self::VerdantGround => (0.45, 0.35, 0.2),
        };
        Weights {
            magnitude,
            local_conditions,
            isolation,
        }
    }
}
fn frozen_country(state: &impl State, place: &Place) -> io::Result<bool> {
    Ok(*state.held().get(&format!("halo-rim:{}", place.id), || {
        let field = state.field()?;
        let frozen = measure(&field.scale, 2.5e-7, 1, 1.0)?;
        let ice = field.shared.scalar(Scalar::IceThickness);
        for &cell in &place.cells {
            for edge in 0..3 {
                if let Some(next) = field.mesh.neighbor(cell, edge) {
                    if ice.get(next)? > frozen {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    })?)
}
fn costs(
    country: Country,
    state: &impl State,
    place: &Place,
    boats: bool,
) -> io::Result<Vec<Cost>> {
    if country == Country::ThawedHalo && !frozen_country(state, place)? {
        return Ok(Vec::new());
    }
    let mut costs = Vec::new();
    for &cell in &place.cells {
        if boats && !reads::has_channel(state.field()?, cell)? {
            continue;
        }
        costs.push(Cost {
            cell,
            factor: if country == Country::WildZone {
                1.0 + country.read(state, cell)?
            } else if boats {
                0.8
            } else {
                0.7
            },
        });
    }
    Ok(costs)
}
fn movement<S: State + 'static>(country: Country) -> Movement<S> {
    let mut movement = shared::movement(
        "Existing costs read ordinary cover; the country adds no duplicate carrier cost.",
    );
    if matches!(country, Country::ThawedHalo | Country::WildZone) {
        movement.statement = Must::Value(
            if country == Country::ThawedHalo {
                "Only a frozen rim makes thawed ground a cheap road and open channel crossing."
            } else {
                "Shifting ground raises road and channel costs in proportion to Veil's wild share."
            }
            .into(),
        );
        movement.roads = Slot::Value(Rc::new(move |state, place| {
            costs(country, state, place, false)
        }));
        movement.boats = Slot::Value(Rc::new(move |state, place| {
            costs(country, state, place, true)
        }));
        movement.drainage =
            Slot::NotApplicable("Drainage reads the ground already changed by the owner.");
        movement.magic = Slot::NotApplicable(
            "The system's carrier does not read a cost from the place it produced.",
        );
        if country == Country::ThawedHalo {
            movement.crosses = Slot::Value(Rc::new(|state, place| {
                Ok(if frozen_country(state, place)? {
                    vec![Barrier::Ice]
                } else {
                    Vec::new()
                })
            }));
        }
    }
    movement
}
fn fields<S>(country: Country) -> Fields<S> {
    let mut fields = shared::fields(
        "The owning system writes its source, feedback and cover forcing across the whole field.",
    );
    if country == Country::ThawedHalo {
        fields.terrain =
            Slot::NotApplicable("Fire hardens rock by intensity without a halo terrain write.");
        fields.water = Slot::NotApplicable("Fire melts ice and river warmth carries its heat.");
        fields.climate = Slot::NotApplicable("Magic feedback writes Fire's heat forcing.");
        fields.cover = Slot::NotApplicable("Ecology reads quickening for turnover and fire.");
        fields.magic = Slot::NotApplicable("Fire's feedback owns quickening.");
    } else if country == Country::WildZone {
        fields.terrain =
            Slot::NotApplicable("Veil owns bounded hashed bedrock relief on all wild land.");
        fields.water = Slot::NotApplicable("Moved ground redirects streams without storing water.");
        fields.climate = Slot::NotApplicable("Veil chills doors, not shifting ground.");
        fields.cover = Slot::NotApplicable("Veil owns exchanges of tree and grass cover.");
        fields.magic = Slot::NotApplicable("Magic feedback owns Tearing.");
    } else if country == Country::GreenwoodStand {
        fields.magic =
            Slot::NotApplicable("Greenwood sources refill sap and feedback writes verdure.");
    }
    fields
}
fn others<S: State + 'static>(country: Country) -> Others<S> {
    let (mut excludes, contains, pairs) = match country {
        Country::ThawedHalo => {
            let mut pairs = shared::borders(&[Kind::MeltLine]);
            pairs.push(shared::within_own(Kind::Settlement, Rc::new(shared::span)));
            (
                shared::holds(&[Kind::WildZone, Kind::Lake]),
                Slot::Value(shared::holds(&[
                    Kind::ThermalVein,
                    Kind::Spring,
                    Kind::EmberGrove,
                    Kind::ThawMeadow,
                ])),
                pairs,
            )
        }
        Country::WildZone => (
            shared::holds(&[Kind::ThawedHalo, Kind::Lake]),
            Slot::Value(shared::holds(&[Kind::Tear])),
            vec![shared::within_own(Kind::Tear, Rc::new(shared::span))],
        ),
        Country::GreenwoodStand => (
            shared::holds(&[Kind::Lake, Kind::WildZone]),
            Slot::Value(shared::holds(&[Kind::Shrine, Kind::Spring])),
            vec![shared::within_own(
                Kind::VerdantGround,
                Rc::new(shared::span),
            )],
        ),
        Country::VerdantGround => (
            shared::holds(&[Kind::Lake, Kind::KillingGround]),
            Slot::NotApplicable("Sites also stand outside verdant country."),
            vec![
                shared::within_own(Kind::GreenwoodStand, Rc::new(shared::span)),
                shared::within_own(Kind::Spring, Rc::new(shared::span)),
            ],
        ),
    };
    if country == Country::WildZone {
        excludes.push(shared::near(Kind::Door, 2.0));
    }
    Others {
        statement: Must::Value(
            "The system's rule determines its overlaps, exclusions and neighbouring sources."
                .into(),
        ),
        needs: Slot::NotApplicable("The rule reads its owner field, not another named place."),
        excludes: Slot::Value(excludes),
        contains,
        pairs_with: Slot::Value(pairs),
    }
}
fn offers(country: Country, state: &impl State, place: &Place) -> io::Result<Benefits> {
    Ok(match country {
        Country::ThawedHalo => {
            let quick = shared::mean_scalar(state, place, Scalar::Quickening)?;
            [
                (Benefit::Food, quick),
                (
                    Benefit::Water,
                    if frozen_country(state, place)? {
                        1.0
                    } else {
                        0.2
                    },
                ),
                (
                    Benefit::Power,
                    shared::mean_scalar(state, place, Scalar::Geothermal)? / 1000.0,
                ),
                (Benefit::Sanctity, quick / 2.0),
            ]
            .into_iter()
            .collect()
        }
        Country::WildZone => [(
            Benefit::Sanctity,
            shared::mean(state, place, |cell| country.read(state, cell))? / 2.0,
        )]
        .into_iter()
        .collect(),
        Country::GreenwoodStand => [
            (
                Benefit::Materials,
                shared::mean(state, place, |cell| shared::canopy(state, cell))? / 2.0,
            ),
            (
                Benefit::Food,
                shared::mean_scalar(state, place, Scalar::Verdure)? / 2.0,
            ),
            (Benefit::Sanctity, 1.0),
        ]
        .into_iter()
        .collect(),
        Country::VerdantGround => {
            let verdure = shared::mean_scalar(state, place, Scalar::Verdure)?;
            [
                (
                    Benefit::Food,
                    (shared::mean(state, place, |cell| shared::living_cover(state, cell))?
                        + verdure)
                        .min(1.0),
                ),
                (Benefit::Sanctity, verdure / 2.0),
            ]
            .into_iter()
            .collect()
        }
    })
}
fn threatens(country: Country, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let (hazard, severity) = match country {
        Country::ThawedHalo => (
            "fast fire",
            shared::mean_scalar(state, place, Scalar::Quickening)?,
        ),
        Country::WildZone => (
            "shifting ground",
            shared::mean(state, place, |cell| country.read(state, cell))?,
        ),
        Country::GreenwoodStand => {
            let fire = shared::mean_scalar(state, place, Scalar::FireActivity)?;
            if fire <= 0.0 {
                return Ok(Vec::new());
            }
            ("wildfire", fire.min(1.0))
        }
        Country::VerdantGround => (
            "overgrowth",
            shared::mean_scalar(state, place, Scalar::Verdure)? / 2.0,
        ),
    };
    Ok(vec![Hazard {
        hazard: hazard.into(),
        reach: shared::hazard_reach(state, place)?,
        severity,
    }])
}
fn fate(country: Country, state: &impl State, place: &Place) -> io::Result<Fate> {
    Ok(match country {
        Country::ThawedHalo => {
            for &cell in &place.cells {
                if reads::magic_rule(state, "fire", "scar", cell)? {
                    return Ok(Fate::Ends {
                        leaves: Some(Kind::BasaltFlat),
                    });
                }
            }
            Fate::Persists
        }
        Country::WildZone => {
            if shared::mean_scalar(state, place, Scalar::Salting)? > 0.0 {
                Fate::Becomes(Kind::Tear)
            } else if shared::mean_scalar(state, place, Scalar::Verdure)? > 0.5 {
                Fate::Ends { leaves: None }
            } else {
                Fate::Persists
            }
        }
        Country::GreenwoodStand => {
            if shared::mean_scalar(state, place, Scalar::EcologicalDamage)? > 0.5 {
                Fate::Ends {
                    leaves: Some(Kind::Forest),
                }
            } else {
                Fate::Persists
            }
        }
        Country::VerdantGround => {
            if shared::mean_scalar(state, place, Scalar::Salting)? > 0.0 {
                Fate::Ends { leaves: None }
            } else {
                Fate::Persists
            }
        }
    })
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    country: Country,
) -> Entry<S, Schedule> {
    let (kind, system, rule, name) = country.identity();
    Entry {
        id: kind, group: Group::Cover, name: name.into(),
        recognition: Recognition { distinct: Must::Value(format!("The {system}:{rule} rule defines this country independently of the biome beneath it.")), is_a: Must::Value(Rc::new(move |state, cell| reads::magic_rule(state, system, rule, cell))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The owning system's sources, propagation and feedback establish the rule's country.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("The owner rule supplies the requirements."), suitability: Slot::NotApplicable("No process chooses this rule's location."), places: Must::Value(Rc::new(move |state| country.found(state))) },
        publication: Publication { statement: Must::Value("Publish the owning magic rule's coverage.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |state: &S, place: &Place| records::rule(state, place, system, rule))) },
        across_maps: shared::developed_country("Captured system fields develop on the child; the name follows the nearest rule country within two parent cells or goes.", Rc::new(move |state, cell| reads::magic_rule(state, system, rule, cell))), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten,
            fields: fields(country), movement: movement(country), others: others(country),
            people: People { statement: Must::Value("People encounter this system's particular resources and hazards through the country it changes.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(country, state, place))), threatens: Slot::Value(Rc::new(move |state, place| threatens(country, state, place))) },
            time: ThroughTime { statement: Must::Value("Owner rules determine whether heat seals, wild strain stills, old growth dies or salt ends verdure.".into()), fate: Slot::Value(Rc::new(move |state, place| fate(country, state, place))) },
            visibility: shared::country_factors("Country contrasts its temperature, wildness or verdure against its neighbours, with extent and human attachment.", Rc::new(move |state| country.found(state)), country.typical_area(), Rc::new(move |state, cell| country.read(state, cell)), country.weights()),
            naming: Naming { statement: Must::Value("Nearby people name it; stable country can lend names to towns.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("Its own character gives its name."), lends_name_to: if country == Country::WildZone { Slot::NotApplicable("People do not name towns after unreliable ground.") } else { Slot::Value(vec![shared::within_own(Kind::Settlement, Rc::new(shared::span))]) }, term: Slot::Unwritten },
        },
    }
}
