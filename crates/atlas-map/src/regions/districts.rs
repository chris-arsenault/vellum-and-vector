use super::geometry::{point, polygon, rectangle};
use crate::spatial::{Overlay, Predicate, SpatialKernel, SpatialResult};
use crate::{Bounds, Geometry, Position};

const OVERSIZED_REGION_RATIO: f64 = 1.8;
const SETTLEMENT_ATTRACTION: f64 = 0.25;

/// Spaced geographic centres, clipped to the shore and attracted to nearby settlements.
pub fn districts(
    shape: &Geometry,
    target_area: f64,
    anchors: &[Position],
    kernel: &dyn SpatialKernel,
) -> SpatialResult<Vec<Geometry>> {
    let bounds = kernel.bounds(shape)?;
    let width = bounds.2 - bounds.0;
    let height = bounds.3 - bounds.1;
    if width * height < target_area * OVERSIZED_REGION_RATIO
        && width.max(height) < target_area.sqrt() * OVERSIZED_REGION_RATIO
    {
        return Ok(vec![]);
    }
    let covered = kernel.covers_points(shape, anchors)?;
    let anchors: Vec<_> = anchors
        .iter()
        .zip(covered)
        .filter_map(|(p, inside)| inside.then_some(*p))
        .collect();
    let mut seeds = centres(shape, bounds, target_area, &anchors, kernel)?;
    if seeds.is_empty() {
        seeds.push(kernel.interior_position(shape)?);
    }
    let mut result = Vec::new();
    for cell in kernel.voronoi_cells(&seeds, bounds)?.into_iter().flatten() {
        if let Some(clipped) = kernel
            .overlay(&cell, shape, Overlay::Intersection)?
            .and_then(polygon)
        {
            result.push(clipped);
        }
    }
    Ok(result)
}
fn centres(
    shape: &Geometry,
    Bounds(w, s, e, n): Bounds,
    target_area: f64,
    anchors: &[Position],
    kernel: &dyn SpatialKernel,
) -> SpatialResult<Vec<Position>> {
    let spacing = target_area.sqrt();
    let columns = (((e - w) / spacing).round() as usize).max(1);
    let rows = (((n - s) / spacing).round() as usize).max(1);
    let points: Vec<_> = anchors.iter().map(|p| point(*p)).collect();
    let index = kernel.index(&points)?;
    let mut seeds = Vec::new();
    for y in 0..rows {
        for x in 0..columns {
            let mut centre = Position::xy(
                w + (x as f64 + 0.5) * (e - w) / columns as f64,
                s + (y as f64 + 0.5) * (n - s) / rows as f64,
            );
            if !kernel.relation(shape, &point(centre), Predicate::Covers)? {
                let patch = kernel
                    .overlay(
                        shape,
                        &rectangle(Bounds(
                            w + x as f64 * (e - w) / columns as f64,
                            s + y as f64 * (n - s) / rows as f64,
                            w + (x + 1) as f64 * (e - w) / columns as f64,
                            s + (y + 1) as f64 * (n - s) / rows as f64,
                        )),
                        Overlay::Intersection,
                    )?
                    .and_then(polygon);
                let Some(patch) = patch else { continue };
                if kernel.area(&patch)? == 0.0 {
                    continue;
                }
                centre = kernel.interior_position(&patch)?;
            }
            if let Some(nearest) = index.nearest(centre)? {
                let [x, y, _] = centre.coordinates();
                let [ax, ay, _] = anchors[nearest].coordinates();
                if (ax - x).hypot(ay - y) < spacing * SETTLEMENT_ATTRACTION {
                    centre = anchors[nearest];
                }
            }
            seeds.push(centre);
        }
    }
    Ok(seeds)
}
