use super::{
    carry_rules, community_records,
    contract::*,
    cover_shared, dam_reservoir,
    kinds::{AreaKind, Group, Kind},
    places, reads, river_courses, settlement_reads as settled,
    state::State,
    values::*,
    visibility,
    work_records::{self, RememberedWork, SitedWork, WorkState},
};
use crate::{
    features::{records::Attributes, FeatureSelection},
    field::{
        people::works::Works, refinement::topology::Neighborhood, shared::Scalar,
        significance::measure,
    },
    hpc::BitSet,
    rock::ground::GroundField,
    scale::{MapScale, RelativeMeasure},
};
use atlas_map::Geometry;
use serde_json::json;
use std::{cell::Ref, io, rc::Rc};

pub trait DamState: WorkState {
    fn known_works(&self) -> Ref<'_, Works>;
    fn regional_receivers(&self) -> &[i32];
}
pub type ReservoirResponse<S> = Rc<dyn Fn(&S) -> io::Result<()>>;
fn wanted_from(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, 0.0075, 1, 1.0)
}
fn typical(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, 3.90625e-18, 3, 1.0)
}
fn requires(state: &impl WorkState, cell: usize) -> io::Result<bool> {
    Ok(river_courses::mapped_cells(state)?.has(cell)
        && settled::near_town(state, cell, wanted_from(state)?, 0.0)?)
}
fn suitable(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let mut count = 0;
    let mut banks = 0;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            count += 1;
            banks += usize::from(field.shared.scalar(Scalar::Slope).get(next)? >= 0.02);
        }
    }
    let banks = if count == 0 {
        0.0
    } else {
        banks as f64 / count as f64
    };
    let flow = reads::discharge(field, cell)?;
    Ok((banks + flow / (flow + typical(state)?)) / 2.0)
}
fn raised(state: &impl DamState) -> io::Result<Vec<RememberedWork>> {
    let mut records = Vec::new();
    for work in state.known_works().standing() {
        let mut attributes = Attributes::new();
        attributes.insert("workId".into(), json!(work.id));
        attributes.insert("built".into(), json!(work.built));
        attributes.insert("resolved".into(), true.into());
        attributes.insert(
            "atPlace".into(),
            community_records::local_id(state, state.known_places().standing_place(&work.place))?
                .into(),
        );
        records.push(RememberedWork { key: work.id.clone(), cell: work.cell, attributes, causes: Some(vec![format!("{}: the people of the place beside it dammed the river here, and the water behind it spread over {} of this map's cells.", work.built, work.holds)]) });
    }
    Ok(records)
}
fn found<S: DamState + 'static>(state: &S) -> io::Result<Vec<Place>> {
    let shape = SitedWork {
        record: "dam",
        layer: "waterworks",
        label: "Dam",
        radius: RelativeMeasure::length(0.000075).map_err(io::Error::other)?,
        spacing: RelativeMeasure::length(0.01).map_err(io::Error::other)?,
        requires: Rc::new(requires),
        suitability: Rc::new(suitable),
    };
    Ok(
        work_records::work_places(state, Kind::Dam, &shape, || raised(state))?
            .as_ref()
            .clone(),
    )
}
fn dam_cells<S: DamState + 'static>(state: &S) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let mut seen = BitSet::new(field.mesh.len());
    let mut cells = Vec::new();
    let mut add = |cell: Option<usize>| {
        if let Some(cell) = cell {
            if !seen.has(cell) {
                seen.add(cell);
                cells.push(cell);
            }
        }
    };
    for feature in state.features().values(FeatureSelection {
        area_id: Some(state.area_id()),
        kind: Some("dam"),
        ..Default::default()
    })? {
        if let Geometry::Point { coordinates } = feature?.geometry {
            let [x, y, _] = coordinates.coordinates();
            add(dam_reservoir::channel_at(field, [x, y])?);
        }
    }
    for place in found(state)? {
        add(dam_reservoir::channel_near(field, place.anchor)?);
    }
    Ok(cells)
}
pub fn respond<S: DamState + 'static>(state: &S) -> io::Result<()> {
    state.held().release();
    let children = dam_reservoir::upstream_index(state.regional_receivers());
    let field = state.field()?;
    let neighborhood = Neighborhood::new(&field.mesh);
    let mut body = dam_reservoir::next_body(field)?;
    for dam in dam_cells(state)? {
        if dam_reservoir::hold_reservoir(field, dam, &children, body, &neighborhood)? {
            body += 1;
        }
    }
    state.held().release();
    Ok(())
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        reads::discharge(state.field()?, place.anchor)?,
        typical(state)?,
    ))
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn local(state: &impl WorkState, place: &Place) -> io::Result<f64> {
    let mapped = river_courses::mapped_cells(state)?;
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        Ok(f64::from(mapped.has(cell)))
    })
}
fn visible<S: DamState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("River discharge, channel distinction, isolation and nearby people determine visibility.".into()), magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(|state: &S, place| visibility::alone_among(state, place, &found(state)?, state.field()?.scale.cells(6.0)))), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            Ok((0.6 * magnitude(state, place)? + 0.2 * local(state, place)? + 0.2 * visibility::alone_among(state, place, &found(state)?, state.field()?.scale.cells(6.0))?).max(cultural(state, place)?))
        })),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value("The work raises its crest and holds water above it; keeping the dam maintains a Hallowed line.".into()),
        terrain: Slot::Value(Rc::new(|state: &S, place| { let height = measure(&state.field()?.scale, 0.0000015, 1, 0.5)? * settled::strength(place); Ok(settled::work_reach(state, place)?.into_iter().map(|sample| FieldChange::Physical(PhysicalChange { cell: sample.cell, band: PhysicalBand::Ground(GroundField::Elevation), change: Change::Add(MapScale::native(height * sample.share)) })).collect()) })),
        water: Slot::Value(Rc::new(|state: &S, place| Ok(vec![FieldChange::Physical(PhysicalChange { cell: place.anchor, band: PhysicalBand::WaterSurfaceElevations, change: Change::AtLeast(state.field()?.ground().view(GroundField::Elevation).get(place.anchor)?) })]))),
        climate: Slot::NotApplicable("The reservoir adds no resolved climate forcing."), cover: Slot::NotApplicable("Ecology reads the flooded ground."), magic: Slot::Value(Rc::new(|_, place| Ok(settled::kept_line(place, place.anchor)))),
    }
}
fn counterpart(state: &impl State, carried: &Carried) -> io::Result<Option<usize>> {
    dam_reservoir::channel_near(state.field()?, carried.cell)
}
fn across<S: State + 'static, Schedule>(schedule: Schedule) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("A captured dam snaps to the nearby channel; the valley banks supply its crest and each water round fills the upstream basin.".into()), stands_on: Slot::Value(AreaKind::River), carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::Value(Rc::new(|state: &S, carried| {
            let Some(cell) = counterpart(state, carried)? else { return Ok(Vec::new()); };
            let field = state.field()?;
            Ok(vec![FieldChange::Physical(PhysicalChange { cell, band: PhysicalBand::WaterSurfaceElevations, change: Change::AtLeast(dam_reservoir::crest_at(field, cell, &Neighborhood::new(&field.mesh))?) })])
        })), counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
        settle: Slot::NotApplicable("The schedule writes the reservoir after each water round."), schedule: Slot::Value(schedule),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement { statement: Must::Value("The crest carries roads but bars boats; drainage and carried material still pass through.".into()), roads: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0))), boats: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, f64::INFINITY, 0.0))), drainage: Slot::NotApplicable("Water still reaches the cell; its level changes."), magic: Slot::NotApplicable("River material passes with released water."), links: Slot::NotApplicable("The crest is an ordinary crossing, not a distant join."), crosses: Slot::Value(Rc::new(|_, _| Ok(vec![Barrier::River]))) }
}
fn others<S: State + 'static>() -> Others<S> {
    Others { statement: Must::Value("A dam serves a town, holds a lake and supplies mills and irrigation, excluding a waterfall at its crest.".into()), needs: Slot::Value(vec![Relation { kind: Kind::Settlement, holds: Rc::new(|state, a, b| places::within(state, a, b, wanted_from(state)?)) }]), excludes: Slot::Value(vec![Relation { kind: Kind::Waterfall, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }]), contains: Slot::NotApplicable("A dam is one channel point."), pairs_with: Slot::Value(vec![cover_shared::near(Kind::Lake, 6.0), cover_shared::near(Kind::Mill, 6.0), cover_shared::near(Kind::Irrigation, 12.0)]) }
}
pub fn entry<S: DamState + 'static, Schedule>(
    schedule: impl FnOnce(ReservoirResponse<S>) -> Schedule,
) -> Entry<S, Schedule> {
    Entry {
        id: Kind::Dam, group: Group::Settlements, name: "Dam".into(), recognition: Recognition { distinct: Must::Value("A built channel barrier holds a reservoir; its lake is a separate catalogue place.".into()), is_a: Must::Value(Rc::new(|state, cell| places::holds_record(state, Kind::Dam, cell, || found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Publish remembered dams and site spaced works at narrow valleys near people.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(requires)), suitability: Slot::Value(Rc::new(suitable)), places: Must::Value(Rc::new(found)) }, publication: Publication { statement: Must::Value("Publish the located work; the owning water field supplies its lake.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(work_records::work_record)) }, across_maps: across(schedule(Rc::new(respond))), event: None,
        roles: Roles { true_size: super::true_sizes::sited(&super::true_sizes::DAM), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Dam), fields: fields(), movement: movement(), others: others(),
            people: People { statement: Must::Value("Dams provide water and power with a downstream failure risk.".into()), offers: Slot::Value(Rc::new(|state, place| { let size = magnitude(state, place)?; Ok([(Benefit::Water, size), (Benefit::Power, size)].into_iter().collect()) })), threatens: Slot::Value(Rc::new(|state: &S, place| Ok(vec![Hazard { hazard: "dam failure".into(), reach: state.field()?.scale.cells(12.0), severity: magnitude(state, place)? }]))) },
            time: ThroughTime { statement: Must::Value("A dam without nearby cultural attachment ends and leaves a breached ruin.".into()), fate: Slot::Value(Rc::new(|state, place| Ok(if cultural(state, place)? > 0.0 { Fate::Persists } else { Fate::Ends { leaves: Some(Kind::Ruin) } }))) }, visibility: visible(), naming: Naming { statement: Must::Value("Builders name the dam for their settlement, and its lake may take the dam's name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(vec![NameRelation { relation: cover_shared::near(Kind::Settlement, 6.0), chance: None }]), lends_name_to: Slot::Value(vec![cover_shared::near(Kind::Lake, 6.0)]), term: Slot::Unwritten },
        },
    }
}
