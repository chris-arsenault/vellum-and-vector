use super::{
    super::{
        fabric::{polygon, HoldingId, Town},
        geometry::sub,
        ground::SQUARE,
    },
    Commission,
};
use crate::processes::town::Frontage;
use atlas_map::{spatial::Overlay, Bounds, Geometry};
use std::io;

fn outline(work: &Commission) -> Geometry {
    let vertices = &work.design.reserve;
    let points = vertices
        .iter()
        .chain(vertices.first())
        .map(|&p| work.position(p))
        .collect::<Vec<_>>();
    polygon(&points)
}

pub(super) fn claim(
    town: &mut Town,
    index: usize,
    first: HoldingId,
    context: &mut Frontage<'_>,
) -> io::Result<()> {
    let place = town.holdings()[first.0 as usize].slot.front;
    let work = &mut town.works.commissions[index];
    let first_offset = work.design.parts[0].offset;
    let shift = sub(work.position(first_offset), work.anchor);
    work.frame = Some(sub(place, shift));
    let shape = outline(work);
    let spatial = context.spatial;
    let [x, y] = context.ground.origin;
    let frame = atlas_map::regions::rectangle(Bounds(
        x,
        y,
        x + context.ground.columns as f64 * context.ground.cell,
        y + context.ground.rows as f64 * context.ground.cell,
    ));
    let Some(mut ground) = spatial
        .overlay(&shape, &frame, Overlay::Intersection)
        .map_err(io::Error::other)?
        .and_then(atlas_map::regions::polygon)
    else {
        return Ok(());
    };
    let bounds = spatial.bounds(&ground).map_err(io::Error::other)?;
    let mut existing = town
        .nearby_holdings(bounds, spatial)?
        .into_iter()
        .map(|i| town.holdings()[i].outline.clone())
        .collect::<Vec<_>>();
    for road in town.nearby_roads(bounds, spatial)? {
        existing.extend(
            town.streets()[road]
                .corridor(0., spatial)
                .map_err(io::Error::other)?,
        );
    }
    existing.extend(
        town.works
            .commissions
            .iter()
            .filter_map(|w| w.grounds.clone()),
    );
    let protected = if existing.is_empty() {
        None
    } else {
        spatial.union_all(&existing).map_err(io::Error::other)?
    };
    if let Some(protected) = protected {
        let Some(free) = spatial
            .overlay(&ground, &protected, Overlay::Difference)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        else {
            return Ok(());
        };
        ground = free;
    }
    context
        .ground
        .mark_shapes(std::slice::from_ref(&ground), SQUARE, spatial)?;
    town.works.commissions[index].grounds_bounds =
        Some(spatial.bounds(&ground).map_err(io::Error::other)?);
    town.works.commissions[index].grounds = Some(ground);
    Ok(())
}
