use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared as shared,
    kinds::{Group, Kind},
    map_records, places, reads,
    sites::{self, Sites},
    state::State,
    values::*,
    visibility,
};
use crate::{
    features::Feature,
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    hpc::BitSet,
    rock::ground::GroundField,
};
use std::{io, rc::Rc};

const WOODED_WATER: f64 = 0.4;
const WOODED_WARMTH: f64 = 2.0;
const FARTHEST_WORK: f64 = 0.00125;
const SITED_RADIUS: f64 = 0.000625;
const SITE_SPACING: f64 = 0.0075;
const STANDING: f64 = 0.05;
const FIELD_LANES: f64 = 0.8;
const FIELD_GRASS: f64 = 0.2;
const STEEPEST_FIELD: f64 = 0.12;
const ICE_ON_FIELD: f64 = 0.00000025;

fn number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(value) => value.as_f64(),
        serde_json::Value::String(value) => value.parse().ok(),
        serde_json::Value::Bool(value) => Some(f64::from(*value)),
        _ => None,
    }
}
fn radius_in(state: &impl State, feature: Option<&Feature>) -> io::Result<f64> {
    match feature
        .and_then(|f| f.attributes.get("radius"))
        .and_then(number)
        .filter(|v| *v != 0.0 && !v.is_nan())
    {
        Some(radius) => Ok(radius),
        None => measure(&state.field()?.scale, SITED_RADIUS, 1, 1.0),
    }
}
fn footprint(state: &impl State, cell: usize, radius: f64) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let mut cells = Vec::new();
    for other in sites::within(&field.mesh, cell, radius) {
        if field.water().column.kind.get(other)? == 0 {
            cells.push(other);
        }
    }
    Ok(cells)
}
fn worked_ground(state: &impl State) -> io::Result<Rc<BitSet>> {
    state.held().get("clearance:worked", || {
        let field = state.field()?;
        let mut cells = BitSet::new(field.mesh.len());
        let reach = measure(&field.scale, FARTHEST_WORK, 1, 1.0)?;
        for town in reads::settlements(state)?.iter() {
            if let Some(at) = reads::feature_cell(field, town) {
                for cell in sites::within(&field.mesh, at, reach) {
                    cells.add(cell);
                }
            }
        }
        Ok(cells)
    })
}
fn requires(state: &impl State, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    Ok(field.water().column.kind.get(cell)? == 0
        && shared::scalar(state, Scalar::Slope, cell)? <= STEEPEST_FIELD
        && shared::scalar(state, Scalar::IceThickness, cell)?
            < measure(&field.scale, ICE_ON_FIELD, 1, 0.5)?
        && shared::plant_water(state, cell)? >= WOODED_WATER
        && reads::celsius(field, cell)? >= WOODED_WARMTH
        && worked_ground(state)?.has(cell))
}
fn suitability(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let soil = field.ground().view(GroundField::SoilDepth).get(cell)?;
    Ok(
        (soil / measure(&field.scale, 0.000000125, 1, 0.5)?).clamp(0.0, 1.0)
            * (shared::plant_water(state, cell)? / 0.5).clamp(0.0, 1.0)
            * ((reads::celsius(field, cell)? + 2.0) / 16.0).clamp(0.0, 1.0)
            * (1.0 - shared::scalar(state, Scalar::Slope, cell)? / STEEPEST_FIELD).clamp(0.0, 1.0),
    )
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(state
        .held()
        .get("footprints:clearance", || {
            let field = state.field()?;
            let spacing = measure(&field.scale, SITE_SPACING, 1, 1.0)?;
            let recorded = places::record_places(state, Kind::Clearance, |feature| {
                feature.kind == "clearance"
            })?;
            let sited = places::sited_places(
                state,
                Kind::Clearance,
                |cell| requires(state, cell),
                |cell| suitability(state, cell),
                spacing,
            )?;
            let works = Sites::new(
                state.spatial(),
                &field.mesh,
                recorded.iter().map(|p| p.anchor).collect(),
            )?;
            let mut found = recorded.as_ref().clone();
            for place in sited.iter() {
                if works
                    .nearest(&field.mesh, place.anchor)?
                    .is_none_or(|cell| distance(&field.mesh, cell, place.anchor) >= spacing)
                {
                    found.push(place.clone());
                }
            }
            for place in &mut found {
                place.cells = footprint(
                    state,
                    place.anchor,
                    radius_in(state, place.feature.as_ref())?,
                )?;
            }
            Ok(found)
        })?
        .as_ref()
        .clone())
}
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state
        .held()
        .get("cells:clearance", || {
            let mut cells = BitSet::new(state.field()?.mesh.len());
            for place in found(state)? {
                for cell in place.cells {
                    cells.add(cell);
                }
            }
            Ok(cells)
        })?
        .has(cell))
}
fn radius(state: &impl State, place: &Place) -> io::Result<f64> {
    radius_in(state, place.feature.as_ref())
}
fn around(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok((2.0 * state.field()?.scale.cells(1.0)).max(2.0 * radius(state, place)?))
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        radius(state, place)?,
        measure(&state.field()?.scale, SITED_RADIUS, 1, 1.0)?,
    ))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state, place)?, |cell| {
        Ok(1.0 - shared::scalar(state, Scalar::TreeCover, cell)?)
    })
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state, place)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state, place)?)
}
fn opened(state: &impl State, cells: &[usize], radius: f64) -> io::Result<Vec<FieldChange>> {
    let mesh = &state.field()?.mesh;
    let ground: f64 = cells.iter().map(|&cell| mesh.area(cell)).sum();
    let share = if ground > 0.0 {
        (std::f64::consts::PI * radius * radius / ground).min(1.0)
    } else {
        0.0
    };
    let ceiling = 1.0 - share * (1.0 - STANDING);
    let mut changes = Vec::new();
    for &cell in cells {
        for band in [
            Scalar::BroadleafCover,
            Scalar::ConiferCover,
            Scalar::BroadleafSaplings,
            Scalar::ConiferSaplings,
        ] {
            changes.push(FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Scalar(band),
                change: Change::AtMost(ceiling),
            }));
        }
        changes.push(FieldChange::Physical(PhysicalChange {
            cell,
            band: PhysicalBand::Scalar(Scalar::TreeCover),
            change: Change::AtMost((2.0 * ceiling).min(1.0)),
        }));
        changes.push(FieldChange::Physical(PhysicalChange {
            cell,
            band: PhysicalBand::Scalar(Scalar::GrassCover),
            change: Change::AtLeast(share * FIELD_GRASS),
        }));
    }
    Ok(changes)
}
fn fields<S: State + 'static>() -> Fields<S> {
    let mut fields = shared::fields("People hold down trees and replace them with grass; soil and climate read the resulting cover.");
    fields.cover = Slot::Value(Rc::new(|state, place| {
        opened(state, &place.cells, radius(state, place)?)
    }));
    fields
}
fn movement<S: State + 'static>() -> Movement<S> {
    let mut movement = shared::movement(
        "Lanes lower road cost; channels and root carriers read the opened cover.",
    );
    movement.roads = Slot::Value(Rc::new(|state, place| {
        carry_rules::cost_near(state, place, FIELD_LANES, 0.0)
    }));
    movement
}
fn others<S: State + 'static>() -> Others<S> {
    let mut pairs = shared::borders(&[Kind::Forest]);
    pairs.push(shared::within_own(Kind::Mill, Rc::new(around)));
    Others { statement: Must::Value("Clearances require the community that works them and neighbour forests, irrigation and mills.".into()),
        needs: Slot::Value(vec![Relation { kind: Kind::Settlement, holds: Rc::new(|state, a, b| places::within(state, a, b, measure(&state.field()?.scale, FARTHEST_WORK, 1, 1.0)?)) }]),
        excludes: Slot::Value(shared::holds(&[Kind::Wetland, Kind::Lake])), contains: Slot::Value(shared::holds(&[Kind::Irrigation])), pairs_with: Slot::Value(pairs), }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Worked ground gives farm food and timber; sloping soil washes into the valley.".into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            Ok([
                (
                    Benefit::Food,
                    shared::mean(state, place, |cell| suitability(state, cell))?,
                ),
                (
                    Benefit::Materials,
                    0.3 * shared::mean_scalar(state, place, Scalar::TreeCover)?,
                ),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(|state, place| {
            let steep = shared::mean_scalar(state, place, Scalar::Slope)? / STEEPEST_FIELD;
            Ok(if steep > 0.0 {
                vec![Hazard {
                    hazard: "soil wash".into(),
                    reach: around(state, place)?,
                    severity: steep.clamp(0.0, 1.0),
                }]
            } else {
                Vec::new()
            })
        })),
    }
}
fn visible<S: State + 'static>() -> Visibility<S> {
    Visibility { statement: Must::Value("Openness against neighbouring trees and community attachment outweigh the clearing's radius.".into()), magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| Ok((0.25 * magnitude(state, place)? + 0.55 * local(state, place)? + 0.2 * isolation(state, place)?).max(cultural(state, place)?)))), }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Clearance, group: Group::Cover, name: "Clearance".into(),
        recognition: Recognition { distinct: Must::Value("A clearance work and the land within its radius, never merely low tree cover.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Recorded works persist; communities site additional clearances on the best suitable farming ground within working distance.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(requires)), suitability: Slot::Value(Rc::new(suitability)), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Keep a recorded work or publish a new land-use site with radius.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(|state: &S, place: &Place| {
            if let Some(feature) = &place.feature { return Ok(Some(feature.clone())); }
            let mut attributes = crate::features::records::Attributes::new(); attributes.insert("radius".into(), radius(state, place)?.into());
            map_records::site(state, place, "clearance", "landUse", "Clearance", attributes)
        })) },
        across_maps: AcrossMaps { statement: Must::Value("The captured work stays at its landing and holds its finer footprint open each round.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
            realize: Slot::Value(Rc::new(|state, carried| { let radius = radius_in(state, Some(&carried.feature))?; opened(state, &footprint(state, carried.cell, radius)?, radius) })),
            counterpart: Slot::Value(Rc::new(|_, carried| Ok(Some(carried.cell)))), unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))), settle: Slot::NotApplicable("Flooded works stay recorded even when their people leave."), schedule: Slot::NotApplicable("The work needs no additional refinement step."), }, event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten,
            fields: fields(), movement: movement(), others: others(), people: people(),
            time: ThroughTime { statement: Must::Value("A work no longer maintained regrows into forest.".into()), fate: Slot::Value(Rc::new(|_, place| Ok(if place.feature.as_ref().and_then(|f| f.attributes.get("maintained")).and_then(|v| v.as_bool()) == Some(false) { Fate::Becomes(Kind::Forest) } else { Fate::Persists }))) }, visibility: visible(),
            naming: Naming { statement: Must::Value("The work's community names it, falling back to nearby people.".into()), named_by: Slot::Value(Rc::new(|state, place| match place.feature.as_ref().and_then(|f| f.attributes.get("namingCulture")).and_then(|v| v.as_str()) { Some(culture) => Ok(Some(culture.into())), None => places::naming_culture_near(state, place) })),
                takes_name_from: Slot::Value(vec![NameRelation { relation: shared::within_own(Kind::Settlement, Rc::new(around)), chance: None }]), lends_name_to: Slot::NotApplicable("The work takes its community's name."), term: Slot::Unwritten },
        },
    }
}
