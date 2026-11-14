use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, records, relief_shape as shape,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        shared::{CellCode, Scalar},
        significance::measure,
    },
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Glacial {
    Cirque,
    Moraine,
}
impl Glacial {
    pub const ALL: [Self; 2] = [Self::Cirque, Self::Moraine];
    fn kind(self) -> Kind {
        if self == Self::Cirque {
            Kind::Cirque
        } else {
            Kind::Moraine
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Cirque {
            "Cirque"
        } else {
            "Moraine"
        }
    }
    fn is_a(self, state: &impl State, cell: usize) -> io::Result<bool> {
        Ok(state
            .field()?
            .shared
            .code(CellCode::LandformCodes)
            .get(cell)?
            == if self == Self::Cirque { 10 } else { 12 })
    }
    fn read(self, state: &impl State, cell: usize) -> io::Result<f64> {
        let band = if self == Self::Cirque {
            Scalar::MaximumIceThickness
        } else {
            Scalar::CumulativeGlacialDeposition
        };
        let value = state.field()?.shared.scalar(band).get(cell)?;
        Ok(if self == Self::Cirque {
            value
        } else {
            MapScale::metres(value, LengthUnit::Native)
        })
    }
    fn found(self, state: &impl State) -> io::Result<Vec<Place>> {
        Ok(places::region_places(
            state,
            self.kind(),
            |cell| self.is_a(state, cell),
            |cell| self.read(state, cell),
        )?
        .as_ref()
        .clone())
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let evidence = shape::evidence(state, place)?;
        let scale = &state.field()?.scale;
        Ok((visibility::sized(
            evidence.area,
            measure(
                scale,
                if self == Self::Cirque {
                    0.00005
                } else {
                    0.0005
                },
                2,
                1.0,
            )?,
        ) + visibility::sized(evidence.relief, measure(scale, 0.000075, 1, 0.5)?))
            / 2.0)
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::stands_out(
            state,
            place,
            state
                .field()?
                .scale
                .cells(if self == Self::Cirque { 6.0 } else { 8.0 }),
            |cell| self.read(state, cell),
        )
    }
    fn isolation(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            state
                .field()?
                .scale
                .cells(if self == Self::Cirque { 8.0 } else { 10.0 }),
        )
    }
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn beside(
    state: &impl State,
    place: &Place,
    test: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<bool> {
    for &cell in &place.cells {
        for edge in 0..3 {
            if let Some(next) = state.field()?.mesh.neighbor(cell, edge) {
                if test(next)? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}
fn wet_beside(state: &impl State, place: &Place) -> io::Result<bool> {
    beside(state, place, |cell| {
        Ok(state
            .field()?
            .shared
            .scalar(Scalar::WetlandCover)
            .get(cell)?
            >= 0.2)
    })
}
fn iced(state: &impl State, place: &Place) -> io::Result<bool> {
    Ok(state
        .field()?
        .shared
        .scalar(Scalar::IceThickness)
        .get(place.anchor)?
        > 0.0)
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    kind: Glacial,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        kind.is_a(state, cell)
    })
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Glacial,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Captured ground and glacial evidence let the child recognize the landform while its geography develops independently.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(kind, state, carried))), realize: Slot::NotApplicable("The child does not repeat glacial excavation or restore a parent ridge height."), unrealized: Slot::Value(Rc::new(move |state, carried| Ok(carry_rules::moves_to(counterpart(kind, state, carried)?)))), settle: Slot::NotApplicable("A round's water does not relocate the bowl or till."), schedule: Slot::NotApplicable("The ordinary glacial processes supply the ground.") }
}
fn fields<S>() -> Fields<S> {
    Fields { statement: Must::Value("Glacial erosion quarries bowls and deposition lays till. Ice, lakes, soil and charge read their existing owners.".into()), terrain: Slot::NotApplicable("Glacial processes write the ground."), water: Slot::NotApplicable("Land ice and lake filling read the ground."), climate: Slot::NotApplicable("Local cold pooling and till rise have no additional climate band."), cover: Slot::NotApplicable("Ecology reads height, ice and deposited material."), magic: Slot::NotApplicable("Aurora owns charge carried and deposited by ice.") }
}
fn movement<S: State + 'static>(kind: Glacial) -> Movement<S> {
    let ice: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0));
    Movement { statement: Must::Value("Cirques feed drainage and ice down their valleys; moraines resist drainage and provide firm routes through wet ground.".into()), roads: if kind == Glacial::Moraine { Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.9, 0.0))) } else { Slot::NotApplicable("Road grade already reads the head wall.") }, boats: Slot::NotApplicable("The landform supplies no additional boat route."), drainage: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, if kind == Glacial::Cirque { 0.6 } else { 2.0 }, 0.0))), magic: if kind == Glacial::Cirque { Slot::Value([(Carrier::Ice, ice)].into_iter().collect()) } else { Slot::NotApplicable("Deposited charge follows the owning system's crust transport.") }, links: Slot::NotApplicable("The ground joins no fixed pair of cells."), crosses: if kind == Glacial::Moraine { Slot::Value(Rc::new(|state, place| Ok(if wet_beside(state, place)? { vec![Barrier::Wetland] } else { Vec::new() }))) } else { Slot::NotApplicable("A bowl ends a route rather than crossing a barrier.") } }
}
fn others<S: State + 'static>(kind: Glacial) -> Others<S> {
    let excludes = vec![Relation {
        kind: if kind == Glacial::Cirque {
            Kind::Moraine
        } else {
            Kind::Cirque
        },
        holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(a.anchor == b.anchor)) as RelationRule<S>,
    }];
    let pairs = if kind == Glacial::Cirque {
        vec![
            cover_shared::near(Kind::Valley, 4.0),
            cover_shared::near(Kind::Moraine, 8.0),
            cover_shared::near(Kind::Peak, 4.0),
        ]
    } else {
        vec![
            cover_shared::near(Kind::Cirque, 8.0),
            cover_shared::holds(&[Kind::Valley]).remove(0),
            cover_shared::near(Kind::Lake, 3.0),
            cover_shared::near(Kind::Wetland, 3.0),
        ]
    };
    Others {
        statement: Must::Value(
            "Cirques head valleys below peaks, and moraines below them hold lakes and wetlands."
                .into(),
        ),
        needs: Slot::NotApplicable("The classifier already reads the necessary glacial history."),
        excludes: Slot::Value(excludes),
        contains: if kind == Glacial::Cirque {
            Slot::Value(cover_shared::holds(&[Kind::Lake, Kind::LightWell]))
        } else {
            Slot::NotApplicable("Nearby places are recognized on their own ground.")
        },
        pairs_with: Slot::Value(pairs),
    }
}
fn offers(kind: Glacial, state: &impl State, place: &Place) -> io::Result<Benefits> {
    let magnitude = kind.magnitude(state, place)?;
    Ok(if kind == Glacial::Cirque {
        [
            (
                Benefit::Water,
                if iced(state, place)? { magnitude } else { 0.0 },
            ),
            (Benefit::Sanctity, magnitude / 2.0),
        ]
    } else {
        [
            (Benefit::Materials, magnitude),
            (
                Benefit::Trade,
                if wet_beside(state, place)? {
                    magnitude
                } else {
                    magnitude / 2.0
                },
            ),
        ]
    }
    .into_iter()
    .collect())
}
fn threatens(kind: Glacial, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let field = state.field()?;
    let (hazard, reach, severity) = if kind == Glacial::Cirque {
        if !iced(state, place)? || field.shared.scalar(Scalar::Slope).get(place.anchor)? < 0.15 {
            return Ok(Vec::new());
        }
        ("avalanche", 2.0, 0.5)
    } else {
        if !beside(state, place, |cell| {
            Ok(field.water().column.kind.get(cell)? == 2)
        })? {
            return Ok(Vec::new());
        }
        ("moraine-dam outburst", 6.0, kind.magnitude(state, place)?)
    };
    Ok(vec![Hazard {
        hazard: hazard.into(),
        reach: field.scale.cells(reach),
        severity,
    }])
}
fn visible<S: State + 'static>(kind: Glacial) -> Visibility<S> {
    Visibility { statement: Must::Value("Extent and relief, historical ice or till, isolation and nearby communities determine visibility.".into()), magnitude: Slot::Value(Rc::new(move |state, place| kind.magnitude(state, place))), local_conditions: Slot::Value(Rc::new(move |state, place| kind.local(state, place))), isolation: Slot::Value(Rc::new(move |state, place| kind.isolation(state, place))), cultural: Slot::Value(Rc::new(cultural)), importance: Must::Value(Rc::new(move |state, place| {
        let (m,l,i) = if kind == Glacial::Cirque { (0.6,0.2,0.2) } else { (0.7,0.15,0.15) };
        Ok((m * kind.magnitude(state, place)? + l * kind.local(state, place)? + i * kind.isolation(state, place)?).max(cultural(state, place)?))
    })) }
}
fn naming<S: State + 'static>(kind: Glacial) -> Naming<S> {
    let takes = if kind == Glacial::Cirque {
        vec![cover_shared::near(Kind::Peak, 4.0)]
    } else {
        vec![
            cover_shared::near(Kind::Lake, 3.0),
            cover_shared::near(Kind::Settlement, 4.0),
        ]
    };
    Naming { statement: Must::Value("Valley people name cirques for their peaks; farmers name moraines for nearby lakes and towns.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(takes.into_iter().map(|relation| NameRelation { relation, chance: None }).collect()), lends_name_to: if kind == Glacial::Cirque { Slot::Value(cover_shared::holds(&[Kind::Lake])) } else { Slot::NotApplicable("A till ridge lends no name to other places.") }, term: Slot::Unwritten }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Glacial,
) -> Entry<S, Schedule> {
    Entry { id: kind.kind(), group: Group::Relief, name: kind.name().into(), recognition: Recognition { distinct: Must::Value("The existing landform class retains the ice-cut head or glacial deposition, even after ice retreats.".into()), is_a: Must::Value(Rc::new(move |state, cell| kind.is_a(state, cell))), landform: Slot::Unwritten }, existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Ice flux and its deposited load leave the landform; no site is chosen.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("The classifier establishes the required glacial evidence."), suitability: Slot::NotApplicable("The ice determines its ground."), places: Must::Value(Rc::new(move |state| kind.found(state))) }, publication: Publication { statement: Must::Value("Connected cells publish their geographic outline.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(move |state: &S, place: &Place| records::area(state, place, records::Shape { kind: kind.kind().as_str(), name: kind.name(), layer: "geology", attributes: Default::default() }, None))) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: fields(), movement: movement(kind), others: others(kind), people: People { statement: Must::Value("Cirques supply meltwater and high sanctuaries; moraines supply gravel and causeways. Snow and impounded lakes have distinct hazards.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(kind, state, place))), threatens: Slot::Value(Rc::new(move |state, place| threatens(kind, state, place))) }, time: ThroughTime { statement: Must::Value("Glacial landforms persist after ice retreats while their class remains.".into()), fate: Slot::Value(Rc::new(move |state, place| Ok(shape::lasts_while(kind.is_a(state, place.anchor)?, None)))) }, visibility: visible(kind), naming: naming(kind) },
    }
}
