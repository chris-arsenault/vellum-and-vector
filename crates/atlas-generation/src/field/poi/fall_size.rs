use crate::{field::significance::measure, scale::MapScale};
use serde::{Deserialize, Serialize};
use std::io;
// hpc-exempt: one settled size per persistent waterfall identity.
use std::{cell::RefCell, collections::BTreeMap};
const HEIGHTS: [[f64; 2]; 7] = [
    [0.0, 0.00000075],
    [0.5, 0.00000375],
    [0.85, 0.0000075],
    [0.93, 0.0000125],
    [0.99, 0.000027],
    [0.998, 0.00004],
    [1.0, 0.000054],
];
const CREST_PER_FLOW: f64 = 24000.0;
const WIDEST_CREST: f64 = 0.00085;
const NARROWEST: f64 = 0.6;
const WIDEST_SHARE: f64 = 2.4;
const LARGEST_SYSTEM: f64 = 40.0;
const MEMBER_SPACING: f64 = 0.00025;
const LEAST_HEIGHT: f64 = 0.00000075;
pub fn fall_height(roll: f64, scale: &MapScale) -> io::Result<f64> {
    for pair in HEIGHTS.windows(2) {
        let [[from_share, from_height], [to_share, to_height]] = [pair[0], pair[1]];
        if roll <= to_share {
            let t = (roll - from_share) / (to_share - from_share);
            return measure(
                scale,
                from_height * (to_height / from_height).powf(t),
                1,
                0.5,
            );
        }
    }
    measure(scale, HEIGHTS[HEIGHTS.len() - 1][1], 1, 0.5)
}
pub struct Facts {
    pub budget: f64,
    pub discharge: f64,
    pub fracture: f64,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Size {
    pub height: f64,
    pub width: f64,
    pub length: f64,
    pub members: f64,
}
#[derive(Default)]
pub struct Sizes {
    // hpc-exempt: persistent place identities, not a cell-indexed numerical field.
    kept: RefCell<BTreeMap<String, Size>>,
}
pub trait FallState: super::state::State {
    fn fall_sizes(&self) -> &Sizes;
    fn captured_fall_size(&self, cell: usize) -> io::Result<Option<Size>>;
}
pub fn at_cell(state: &impl super::state::State, cell: usize) -> io::Result<Size> {
    let field = state.field()?;
    let facts = Facts {
        budget: field.with_landscape(|land| land.river_drop(cell))?,
        discharge: super::reads::discharge(field, cell)?,
        fracture: super::reads::rock(
            field,
            cell,
            crate::rock::ground::queries::SurfaceResponse::Openness,
        )?,
    };
    true_size(
        &facts,
        crate::noise::hash_unit(0x7043, cell as f64, 0.0),
        crate::noise::hash_unit(0x7044, cell as f64, 0.0),
        &field.scale,
    )
}
pub fn of(state: &impl FallState, place: &super::values::Place) -> io::Result<Size> {
    if let Some(size) = state.fall_sizes().kept.borrow().get(&place.id) {
        return Ok(*size);
    }
    let inherited = if place.origin.as_deref() == Some("carried") {
        state.captured_fall_size(place.anchor)?
    } else {
        None
    };
    let size = match inherited {
        Some(size) => size,
        None => at_cell(state, place.anchor)?,
    };
    state
        .fall_sizes()
        .kept
        .borrow_mut()
        .insert(place.id.clone(), size);
    Ok(size)
}
pub fn true_size(
    facts: &Facts,
    height_roll: f64,
    width_roll: f64,
    scale: &MapScale,
) -> io::Result<Size> {
    let budget = facts.budget.max(measure(scale, LEAST_HEIGHT, 1, 0.5)?);
    let height = fall_height(height_roll, scale)?.min(budget);
    let spare = budget / height - 1.0;
    let members = (1.0 + (spare * facts.fracture).floor()).min(LARGEST_SYSTEM);
    let spread = NARROWEST + width_roll * width_roll * WIDEST_SHARE;
    let crest = scale
        .resolve(
            crate::scale::RelativeMeasure::new(
                CREST_PER_FLOW,
                -0.5,
                1.0,
                crate::scale::LengthUnit::Metre,
            )
            .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    let width =
        measure(scale, WIDEST_CREST, 1, 1.0)?.min(crest * facts.discharge.max(0.0).sqrt() * spread);
    Ok(Size {
        height,
        width,
        length: (members - 1.0) * measure(scale, MEMBER_SPACING, 1, 1.0)?,
        members,
    })
}
