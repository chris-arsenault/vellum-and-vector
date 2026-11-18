use super::{
    carry_rules,
    community_records::CommunityState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, settlement_reads as settled,
    state::State,
    values::*,
    visibility,
    work_records::{self, SitedWork},
};
use crate::{
    field::{
        shared::{CellCode, Scalar},
        significance::measure,
    },
    magic::channels::Channel,
    scale::RelativeMeasure,
};
use std::{io, rc::Rc};

const SACRED_RULES: [(&str, &str, f64); 8] = [
    ("hallowed", "ring", 1.0),
    ("greenwood", "wellspring", 0.9),
    ("veil", "door", 0.85),
    ("aurora", "well", 0.8),
    ("salt", "ground", 0.7),
    ("fire", "spring", 0.7),
    ("hallowed", "line", 0.6),
    ("greenwood", "oasis", 0.6),
];
fn holiness(state: &impl State, cell: usize) -> io::Result<f64> {
    let mut best = match state
        .field()?
        .shared
        .code(CellCode::LandformCodes)
        .get(cell)?
    {
        17 => 0.8,
        6 => 0.7,
        7 => 0.5,
        _ => 0.0,
    };
    for (system, rule, weight) in SACRED_RULES {
        if weight > best && reads::magic_rule(state, system, rule, cell)? {
            best = weight;
        }
    }
    Ok(best)
}
fn keepers_from(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, 0.00375, 1, 1.0)
}
fn requires(state: &impl CommunityState, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    Ok(field.water().column.kind.get(cell)? == 0
        && field.shared.scalar(Scalar::IceThickness).get(cell)?
            <= measure(&field.scale, 2.5e-7, 1, 1.0)?
        && settled::near_town(state, cell, keepers_from(state)?, 0.0)?)
}
fn found<S: CommunityState + 'static>(state: &S) -> io::Result<Vec<Place>> {
    let shape = SitedWork {
        record: "shrine",
        layer: "magicPractices",
        label: "Shrine",
        radius: RelativeMeasure::length(0.00005).map_err(io::Error::other)?,
        spacing: RelativeMeasure::length(0.015).map_err(io::Error::other)?,
        requires: Rc::new(requires),
        suitability: Rc::new(holiness),
    };
    Ok(
        work_records::work_places(state, Kind::Shrine, &shape, || Ok(Vec::new()))?
            .as_ref()
            .clone(),
    )
}
fn kept(state: &impl CommunityState, place: &Place) -> io::Result<bool> {
    match settled::seat(state, place)? {
        Some(town) => Ok(!settled::gone(Some(&town))),
        None => settled::near_town(state, place.anchor, keepers_from(state)?, 0.0),
    }
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        holiness(state, cell)
    })
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, keepers_from(state)?)
}
fn visible<S: CommunityState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("Holy ground, local distinction, isolation and the people who keep it determine visibility.".into()),
        magnitude: Slot::Value(Rc::new(|state, place| holiness(state, place.anchor))), local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(|state, place| visibility::alone_among(state, place, &found(state)?, keepers_from(state)?))), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            Ok((0.3 * holiness(state, place.anchor)? + 0.3 * local(state, place)? + 0.4 * visibility::alone_among(state, place, &found(state)?, keepers_from(state)?)?).max(cultural(state, place)?))
        })),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value("Keepers preserve a grove where trees can live and maintain a source line for Hallowed.".into()),
        terrain: Slot::NotApplicable("A shrine takes the existing height or hollow."), water: Slot::NotApplicable("It neither takes nor holds the holy water."), climate: Slot::NotApplicable("The shrine and grove have no resolved climate effect."),
        cover: Slot::Value(Rc::new(|state: &S, place| Ok(if state.field()?.shared.scalar(Scalar::Moisture).get(place.anchor)? / 1000.0 >= 0.3 && reads::celsius(state.field()?, place.anchor)? > 0.0 { vec![FieldChange::Physical(PhysicalChange { cell: place.anchor, band: PhysicalBand::Scalar(Scalar::TreeCover), change: Change::AtLeast(0.3) })] } else { Vec::new() }))),
        magic: Slot::Value(Rc::new(|_, place| Ok(settled::kept_line(place, place.anchor)))),
    }
}
fn across<S: State + 'static, Schedule>() -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value(
            "A captured shrine retains its particular holy ground while the finer map develops."
                .into(),
        ),
        stands_on: Slot::Unwritten,
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::NotApplicable("The shrine shapes no ground."),
        counterpart: Slot::Value(Rc::new(|_, carried| Ok(Some(carried.cell)))),
        unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))),
        settle: Slot::NotApplicable("The shrine does not move with water."),
        schedule: Slot::NotApplicable("The shrine adds no refinement step."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let people: OnPlace<S, Vec<Cost>> = Rc::new(|state, place| {
        carry_rules::cost_near(
            state,
            place,
            0.85,
            measure(&state.field()?.scale, 0.0005, 1, 1.0)?,
        )
    });
    Movement {
        on_foot: Some(TrailRole::Destination),
        statement: Must::Value(
            "Pilgrims wear routes and carry seed, salt and cores along them.".into(),
        ),
        roads: Slot::Value(Rc::new(|state, place| {
            carry_rules::cost_near(
                state,
                place,
                0.8,
                measure(&state.field()?.scale, 0.0005, 1, 1.0)?,
            )
        })),
        boats: Slot::NotApplicable("People reach the shrine on foot."),
        drainage: Slot::NotApplicable("The shrine does not hold water."),
        magic: Slot::Value([(Carrier::People, people)].into_iter().collect()),
        links: Slot::NotApplicable("A shrine joins no cells."),
        crosses: Slot::NotApplicable("A shrine marks a crossing; it does not create one."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("Keepers mark heights, waters, doors and graves; a working forge breaks the ward at its own cell.".into()),
        needs: Slot::Value(vec![Relation { kind: Kind::Settlement, holds: Rc::new(|state, a, b| places::within(state, a, b, keepers_from(state)?)) }]),
        excludes: Slot::Value(vec![Relation { kind: Kind::Forge, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }]), contains: Slot::NotApplicable("A shrine is one kept point."),
        pairs_with: Slot::Value([Kind::Peak, Kind::Spring, Kind::Waterfall, Kind::LightWell, Kind::Door, Kind::Oasis, Kind::KillingGround].into_iter().map(|kind| cover_shared::near(kind, 6.0)).collect()),
    }
}
pub fn entry<S: CommunityState + 'static, Schedule>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Shrine, group: Group::Settlements, name: "Shrine".into(),
        recognition: Recognition { distinct: Must::Value("People keep a shrine at holy ground; natural magical places and sanctuary towns are separate records.".into()), is_a: Must::Value(Rc::new(|state, cell| places::holds_record(state, Kind::Shrine, cell, || found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Site shrines near keepers, choosing the holiest ground first and spacing their sites.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(requires)), suitability: Slot::Value(Rc::new(holiness)), places: Must::Value(Rc::new(found)) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish a located practice on the holy ground.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(work_records::work_record)) }, across_maps: across(), event: None,
        roles: Roles {
            true_size: super::true_sizes::sited(&super::true_sizes::SHRINE), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Shrine), fields: fields(), movement: movement(), others: others(),
            people: People { statement: Must::Value("Holy ground and warding supply sanctity while pilgrims bring trade.".into()), offers: Slot::Value(Rc::new(|state, place| { let holy = holiness(state, place.anchor)?; let ward = (reads::magic_value(state, "hallowed", Channel::Intensity, place.anchor)? / 1000.0).min(1.0); Ok([(Benefit::Sanctity, holy.max(ward)), (Benefit::Trade, holy / 3.0)].into_iter().collect()) })), threatens: Slot::NotApplicable("The marked ground's own entries supply its dangers.") },
            time: ThroughTime { statement: Must::Value("The shrine persists while kept; abandoned keeping leaves a ruin.".into()), fate: Slot::Value(Rc::new(|state, place| Ok(if kept(state, place)? { Fate::Persists } else { Fate::Ends { leaves: Some(Kind::Ruin) } }))) }, visibility: visible(),
            naming: Naming { statement: Must::Value("Keepers name the shrine for its height or water; a town growing from pilgrims can take that name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value([Kind::Peak, Kind::Spring, Kind::Waterfall].into_iter().map(|kind| NameRelation { relation: cover_shared::near(kind, 6.0), chance: None }).collect()), lends_name_to: Slot::Value(vec![cover_shared::near(Kind::Settlement, 6.0)]), term: Slot::Unwritten },
        },
    }
}
