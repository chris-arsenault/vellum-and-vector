use super::{
    sites,
    state::State,
    values::{Change, Fate, FieldChange, PhysicalBand, PhysicalChange, Place},
};
use crate::{
    field::{
        refinement::topology::distance,
        region_evidence::{region_evidence, Evidence},
        shared::Scalar,
        significance::measure,
    },
    lattice::sampling::Cache,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::{cell::RefCell, io, rc::Rc};

pub fn ring_heights(state: &impl State, cell: usize, radius: f64) -> io::Result<[f64; 16]> {
    let field = state.field()?;
    let sampler = state.held().get("relief:elevation", || {
        Ok(RefCell::new(Cache::new(field.mesh.len())))
    })?;
    let mut sampler = sampler.borrow_mut();
    let height = field.ground().view(GroundField::Elevation);
    let [x, y] = field.mesh.position(cell);
    let mut values = [0.0; 16];
    for (direction, value) in values.iter_mut().enumerate() {
        let angle = direction as f64 * std::f64::consts::PI / 8.0;
        *value = sampler.sample(
            &field.mesh,
            [x + angle.cos() * radius, y + angle.sin() * radius],
            |cell| height.get(cell),
        )?;
    }
    Ok(values)
}
fn fall_on(here: f64, a: f64, b: f64) -> f64 {
    if a.is_finite() && b.is_finite() {
        (here - a).min(here - b)
    } else {
        f64::NEG_INFINITY
    }
}
pub struct Section {
    pub crest: f64,
    pub along: f64,
    pub trough: f64,
}
pub fn section_at(state: &impl State, cell: usize) -> io::Result<Section> {
    let field = state.field()?;
    let here = field.ground().view(GroundField::Elevation).get(cell)?;
    let ring = ring_heights(state, cell, field.scale.cells(2.0))?;
    let (mut crest, mut axis, mut trough) = (f64::NEG_INFINITY, 0, f64::NEG_INFINITY);
    for direction in 0..8 {
        let fall = fall_on(here, ring[direction], ring[direction + 8]);
        if fall > crest {
            crest = fall;
            axis = direction;
        }
        trough = trough.max(fall_on(-here, -ring[direction], -ring[direction + 8]));
    }
    let along = fall_on(here, ring[(axis + 4) % 16], ring[(axis + 12) % 16]);
    Ok(Section {
        crest: MapScale::metres(crest, LengthUnit::Native),
        along: MapScale::metres(along, LengthUnit::Native),
        trough: MapScale::metres(trough, LengthUnit::Native),
    })
}
pub fn evidence(state: &impl State, place: &Place) -> io::Result<Rc<Evidence>> {
    state
        .held()
        .get(&format!("relief:evidence:{}", place.id), || {
            region_evidence(state.field()?, &place.cells, |_| Ok(1.0), |_| true)
        })
}
pub fn alone_within(
    state: &impl State,
    place: &Place,
    radius: f64,
    is_a: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<f64> {
    let field = state.field()?;
    let nearest =
        sites::nearest_where(&field.mesh, state.spatial(), place.anchor, radius, |cell| {
            Ok(cell != place.anchor && is_a(cell)?)
        })?;
    let distance = nearest.map_or(radius, |cell| distance(&field.mesh, place.anchor, cell));
    Ok(distance / (distance + radius))
}
pub fn bare(cells: &[usize]) -> Vec<FieldChange> {
    cells
        .iter()
        .flat_map(|&cell| {
            [
                Scalar::BroadleafCover,
                Scalar::ConiferCover,
                Scalar::TreeCover,
                Scalar::GrassCover,
            ]
            .map(|band| {
                FieldChange::Physical(PhysicalChange {
                    band: PhysicalBand::Scalar(band),
                    cell,
                    change: Change::AtMost(0.0),
                })
            })
        })
        .collect()
}
const THIN_SOIL: f64 = 0.000000125;
pub fn thin_soil(state: &impl State, cells: &[usize]) -> io::Result<Vec<FieldChange>> {
    let value = measure(&state.field()?.scale, THIN_SOIL, 1, 0.5)?;
    Ok(cells
        .iter()
        .map(|&cell| {
            FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::Ground(GroundField::SoilDepth),
                cell,
                change: Change::AtMost(value),
            })
        })
        .collect())
}
pub fn hold_gradient(
    state: &impl State,
    cells: &[usize],
    ceiling: f64,
) -> io::Result<Vec<FieldChange>> {
    let slope = state.field()?.shared.scalar(Scalar::Slope);
    cells
        .iter()
        .map(|&cell| {
            Ok(FieldChange::GradeGround {
                cell,
                gradient: ceiling.min(slope.get(cell)?),
            })
        })
        .collect()
}
pub fn extreme_near(
    state: &impl State,
    cell: usize,
    parent_span: f64,
    sign: f64,
) -> io::Result<usize> {
    let field = state.field()?;
    let elevation = field.ground().view(GroundField::Elevation);
    let mut best = cell;
    for other in sites::within(&field.mesh, cell, parent_span) {
        if sign * elevation.get(other)? > sign * elevation.get(best)? {
            best = other;
        }
    }
    Ok(best)
}
pub fn nearest_or_extreme(
    state: &impl State,
    cell: usize,
    parent_span: f64,
    sign: f64,
    is_a: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<usize> {
    match sites::nearest_where(
        &state.field()?.mesh,
        state.spatial(),
        cell,
        parent_span,
        is_a,
    )? {
        Some(cell) => Ok(cell),
        None => extreme_near(state, cell, parent_span, sign),
    }
}
pub fn lasts_while(is_a: bool, leaves: Option<super::kinds::Kind>) -> Fate {
    if is_a {
        Fate::Persists
    } else {
        Fate::Ends { leaves }
    }
}
