use super::{
    carry::{carried_places, CarryState},
    catalogue::Catalogue,
    fall_forms::{self, Form, Readings},
    fall_size::{self, FallState, Size},
    kinds::Kind,
    reads, relief_shape,
    state::State,
    values::{Change, FieldChange, PhysicalBand, PhysicalChange, Place},
    visibility::sized,
    water_reads::flow_target,
};
use crate::{
    field::{
        significance::{self, measure},
        Field,
    },
    hpc::BitSet,
    noise::hash_unit,
    rock::ground::{queries::SurfaceResponse, GroundField},
    scale::MapScale,
};
use std::io;
pub fn captured_size<S: CarryState<Schedule>, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
    cell: usize,
) -> io::Result<Option<Size>> {
    if !state.regional() {
        return Ok(None);
    }
    for item in carried_places(state, catalogue)?.iter() {
        if item.kind != Kind::Waterfall || state.hosted_cell(&item.carried.feature)? != Some(cell) {
            continue;
        }
        let attributes = &item.carried.feature.attributes;
        let Some(size) = attributes.get("trueSize") else {
            return Ok(None);
        };
        let mut size = size.clone();
        size["members"] = attributes.get("members").cloned().unwrap_or(1.into());
        return Ok(Some(serde_json::from_value(size)?));
    }
    Ok(None)
}
pub fn choose_form(state: &impl FallState, place: &Place) -> io::Result<Form> {
    let field = state.field()?;
    let readings = Readings {
        hardness: reads::rock(field, place.anchor, SurfaceResponse::Hardness)?,
        fracture: reads::rock(field, place.anchor, SurfaceResponse::Openness)?,
        tall: sized(
            fall_size::of(state, place)?.height,
            measure(&field.scale, significance::FALLS_DROP, 1, 0.5)?,
        ),
        broad: sized(
            reads::discharge(field, place.anchor)?,
            measure(&field.scale, significance::FALLS_DISCHARGE, 3, 1.0)?,
        ),
    };
    Ok(fall_forms::choose(
        &readings,
        hash_unit(0x7042, place.anchor as f64, 0.0),
    ))
}
pub fn form_in(state: &impl FallState, place: &Place) -> io::Result<Form> {
    let name = state
        .varieties()
        .get_or_choose(&place.id, || Ok(choose_form(state, place)?.name().into()))?;
    Form::named(&name).ok_or_else(|| io::Error::other("Unknown waterfall form"))
}
fn land(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.water().column.kind.get(cell)? == 0)
}
fn ground_change(band: GroundField, cell: usize, change: Change) -> FieldChange {
    FieldChange::Physical(PhysicalChange {
        band: PhysicalBand::Ground(band),
        cell,
        change,
    })
}
fn drop(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(field
        .with_landscape(|land| land.river_drop(cell))?
        .max(measure(&field.scale, 0.0000025, 1, 1.0)?))
}
pub fn step(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let Some(target) = flow_target(field, place.anchor)? else {
        return Ok(Vec::new());
    };
    if !land(field, place.anchor)? || !land(field, target)? {
        return Ok(Vec::new());
    }
    let lip = field
        .ground()
        .view(GroundField::Elevation)
        .get(place.anchor)?;
    Ok(vec![
        ground_change(GroundField::Elevation, place.anchor, Change::AtLeast(lip)),
        ground_change(
            GroundField::Elevation,
            target,
            Change::AtMost(lip - MapScale::native(drop(field, place.anchor)?)),
        ),
    ])
}
fn reach_below(field: &Field, cell: usize, length: usize) -> io::Result<Vec<usize>> {
    let mut reach = vec![cell];
    let mut seen = BitSet::new(field.mesh.len());
    seen.add(cell);
    while reach.len() < length {
        let Some(next) = flow_target(field, *reach.last().unwrap())? else {
            break;
        };
        if !land(field, next)? || seen.has(next) {
            break;
        }
        seen.add(next);
        reach.push(next);
    }
    Ok(reach)
}
const LARGEST_CARRIED_DROP: f64 = 0.000025;
const CARRIED_GRADE: usize = 40;
const GRADED_FALL: f64 = 0.000000125;
pub fn carried_step(
    state: &impl State,
    cell: usize,
    parent_drop: f64,
) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let elevation = field.ground().view(GroundField::Elevation);
    let lip = elevation.get(cell)?;
    let drop = measure(&field.scale, LARGEST_CARRIED_DROP, 1, 0.5)?.min(parent_drop.max(measure(
        &field.scale,
        0.0000025,
        1,
        1.0,
    )?));
    let floor = lip - MapScale::native(drop);
    let below = reach_below(field, cell, CARRIED_GRADE)?;
    let mut changes = vec![ground_change(
        GroundField::Elevation,
        cell,
        Change::AtLeast(lip),
    )];
    for (k, &cell) in below.iter().enumerate().skip(1) {
        let value =
            floor - MapScale::native(measure(&field.scale, GRADED_FALL, 1, 0.5)? * (k - 1) as f64);
        if elevation.get(cell)? <= value {
            break;
        }
        changes.push(ground_change(
            GroundField::Elevation,
            cell,
            Change::AtMost(value),
        ));
    }
    Ok(changes)
}
fn banks(field: &Field, cell: usize, reach: &[usize]) -> io::Result<Vec<usize>> {
    let mut banks = Vec::new();
    for edge in 0..3 {
        let Some(next) = field.mesh.neighbor(cell, edge) else {
            continue;
        };
        if land(field, next)? && !reads::has_channel(field, next)? && !reach.contains(&next) {
            banks.push(next);
        }
    }
    Ok(banks)
}
fn raised_banks(
    state: &impl FallState,
    place: &Place,
    changes: &mut Vec<FieldChange>,
) -> io::Result<()> {
    let shape = form_in(state, place)?.shape();
    let field = state.field()?;
    let reach = reach_below(field, place.anchor, shape.banks.len())?;
    let lip = field
        .ground()
        .view(GroundField::Elevation)
        .get(place.anchor)?;
    let drop = MapScale::native(drop(field, place.anchor)?);
    for (k, &cell) in reach.iter().enumerate() {
        for near in banks(field, cell, &reach)? {
            changes.push(ground_change(
                GroundField::Elevation,
                near,
                Change::AtLeast(lip - drop + shape.banks[k] * drop),
            ));
        }
    }
    Ok(())
}
fn broad_lip(
    state: &impl FallState,
    place: &Place,
    changes: &mut Vec<FieldChange>,
) -> io::Result<()> {
    if !form_in(state, place)?.shape().broad_lip {
        return Ok(());
    }
    let field = state.field()?;
    let lip = field
        .ground()
        .view(GroundField::Elevation)
        .get(place.anchor)?;
    for cell in banks(field, place.anchor, &[place.anchor])? {
        changes.push(ground_change(
            GroundField::Elevation,
            cell,
            Change::AtMost(lip),
        ));
    }
    Ok(())
}
fn bed(state: &impl FallState, place: &Place, changes: &mut Vec<FieldChange>) -> io::Result<()> {
    let shape = form_in(state, place)?.shape();
    let field = state.field()?;
    let below = reach_below(field, place.anchor, shape.banks.len())?;
    let fallen = MapScale::native(shape.debris * drop(field, place.anchor)?);
    for &cell in below.iter().skip(1) {
        if shape.scoured {
            changes.push(ground_change(
                GroundField::SedimentThickness,
                cell,
                Change::AtMost(0.0),
            ));
        }
        if shape.debris != 0.0 {
            changes.push(ground_change(
                GroundField::SedimentThickness,
                cell,
                Change::Add(fallen),
            ));
        }
    }
    Ok(())
}
pub fn shaped(state: &impl FallState, place: &Place) -> io::Result<Vec<FieldChange>> {
    let mut changes = step(state, place)?;
    raised_banks(state, place, &mut changes)?;
    broad_lip(state, place, &mut changes)?;
    bed(state, place, &mut changes)?;
    Ok(changes)
}
pub fn wet_rock(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let walls = banks(state.field()?, place.anchor, &[place.anchor])?;
    let mut changes = relief_shape::bare(&walls);
    changes.extend(relief_shape::thin_soil(state, &walls)?);
    Ok(changes)
}
