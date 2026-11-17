use super::{map_records::MapState, reads, relief_shape, state::State};
use crate::{
    field::{
        geographic_regions::{self, Components},
        region_evidence::region_evidence,
        significance::{self, measure},
    },
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};
pub trait RangeState: MapState {
    fn relief_radius(&self) -> f64;
    fn mountain_elevation(&self) -> f64;
    fn hill_elevation(&self) -> f64;
    fn mountain_local_relief(&self) -> f64;
    fn range_minimum_area(&self) -> f64;
    fn retained_continental_domains(&self, count: usize);
}
pub struct Group {
    pub members: Vec<usize>,
    pub relief: f64,
}
fn local_relief(state: &impl State, cell: usize, radius: f64) -> io::Result<f64> {
    let here = state
        .field()?
        .ground()
        .view(GroundField::Elevation)
        .get(cell)?;
    let (mut low, mut high) = (here, here);
    for height in relief_shape::ring_heights(state, cell, radius)? {
        if height.is_finite() {
            low = low.min(height);
            high = high.max(height);
        }
    }
    Ok(MapScale::metres(high - low, LengthUnit::Native))
}
pub fn mountain(state: &impl RangeState, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    if field.water().column.kind.get(cell)? != 0 {
        return Ok(false);
    }
    let height = reads::height(field, cell)?;
    let radius = field.scale.supported(
        state
            .relief_radius()
            .max(measure(&field.scale, 0.0125, 1, 1.0)?),
        1.0,
    );
    Ok(height >= state.mountain_elevation()
        || (height >= state.hill_elevation()
            && local_relief(state, cell, radius)? >= state.mountain_local_relief()))
}
pub fn groups(state: &impl RangeState) -> io::Result<Rc<Vec<Group>>> {
    state.held().get("ranges", || {
        let field = state.field()?;
        let regions = geographic_regions::components(
            state,
            &|cell| mountain(state, cell),
            Components {
                polygonal: false,
                splits: true,
            },
            None,
        )?;
        if regions.retained_continental_domains > 0 {
            state.retained_continental_domains(regions.retained_continental_domains);
        }
        let mut groups = Vec::new();
        for region in regions.regions {
            let area: f64 = region
                .members
                .iter()
                .map(|&cell| field.mesh.area(cell))
                .sum();
            if area < state.range_minimum_area() {
                continue;
            }
            let evidence = region_evidence(field, &region.members, |_| Ok(1.0), |_| true)?;
            if significance::range(&evidence, &field.scale)?.publish {
                groups.push(Group {
                    members: region.members,
                    relief: evidence.relief,
                });
            }
        }
        Ok(groups)
    })
}
pub fn is_range(state: &impl RangeState, members: &[usize]) -> io::Result<bool> {
    let field = state.field()?;
    let area: f64 = members.iter().map(|&cell| field.mesh.area(cell)).sum();
    if area < state.range_minimum_area() {
        return Ok(false);
    }
    let evidence = region_evidence(field, members, |_| Ok(1.0), |_| true)?;
    Ok(significance::range(&evidence, &field.scale)?.publish)
}
