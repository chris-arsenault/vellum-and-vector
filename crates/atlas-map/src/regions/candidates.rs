use super::{districts, geometry, RegionContext};
use crate::spatial::{Predicate, SpatialResult};
use crate::{Geometry, RegionCandidate};
use std::collections::BTreeSet;

const DISTRICT_PREFERENCE_PENALTY: f64 = 0.2;
const SPARSE_FOOTPRINT_PENALTY: f64 = 0.75;
pub struct Source {
    pub name: String,
    pub shape: Geometry,
    pub district: bool,
}
pub fn candidates(
    context: &RegionContext<'_>,
    sources: Vec<Source>,
) -> SpatialResult<Vec<RegionCandidate>> {
    let mut unique = BTreeSet::new();
    let mut result = Vec::new();
    let space = context
        .input
        .map
        .spaces
        .iter()
        .find(|space| space.id == context.query.space_id)
        .unwrap();
    for source in sources {
        let Some(available) = context.available(&source.shape)? else {
            continue;
        };
        for piece in context.split(&available)? {
            for shape in geometry::connected(space, &piece, context.query.position, context.kernel)?
            {
                let area = context.kernel.area(&shape)?;
                if area >= context.parent_area
                    || 2.0 * area / context.kernel.length(&shape)?
                        < context.input.map.region_scale.minimum_width
                {
                    continue;
                }
                if let Some(position) = context.query.position {
                    if !context.kernel.relation(
                        &shape,
                        &geometry::point(position),
                        Predicate::Covers,
                    )? {
                        continue;
                    }
                }
                let canonical = geometry::canonical(space, &shape, context.kernel)?;
                let key = serde_json::to_string(&canonical).map_err(|error| error.to_string())?;
                if !unique.insert(key) {
                    continue;
                }
                let bounds = context.kernel.bounds(&shape)?;
                let frame_area = (bounds.2 - bounds.0) * (bounds.3 - bounds.1);
                let score = (frame_area / context.target_area).ln().abs()
                    + (frame_area / area).max(1.0).ln() * SPARSE_FOOTPRINT_PENALTY
                    + if source.district {
                        DISTRICT_PREFERENCE_PENALTY
                    } else {
                        0.0
                    };
                result.push((
                    score,
                    RegionCandidate {
                        name: source.name.clone(),
                        geometry: geometry::as_region(canonical)?,
                    },
                ));
            }
        }
    }
    result.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(result.into_iter().map(|(_, candidate)| candidate).collect())
}
pub fn with_districts(
    context: &RegionContext<'_>,
    mut sources: Vec<Source>,
) -> SpatialResult<Vec<Source>> {
    let space = context
        .input
        .map
        .spaces
        .iter()
        .find(|space| space.id == context.query.space_id)
        .unwrap();
    let position = context.query.position.ok_or("Choose a location")?;
    let mut additions = Vec::new();
    for source in &sources {
        for shape in geometry::connected(space, &source.shape, Some(position), context.kernel)? {
            if !context
                .kernel
                .relation(&shape, &geometry::point(position), Predicate::Covers)?
            {
                continue;
            }
            let bounds = context.kernel.bounds(&shape)?;
            let centre = (bounds.0 + bounds.2) / 2.0;
            let anchors: Vec<_> = context
                .input
                .anchors
                .iter()
                .map(|p| {
                    let [x, y, z] = p.coordinates();
                    let x = space
                        .periodic_width
                        .map_or(x, |width| x + ((centre - x) / width).round() * width);
                    crate::Position::XYZ([x, y, z])
                })
                .collect();
            for footprint in
                districts::districts(&shape, context.target_area, &anchors, context.kernel)?
            {
                let [x, y, _] = context.kernel.interior_position(&footprint)?.coordinates();
                let x = (x - bounds.0) / (bounds.2 - bounds.0);
                let y = (y - bounds.1) / (bounds.3 - bounds.1);
                let horizontal = if x < 1.0 / 3.0 {
                    "west"
                } else if x > 2.0 / 3.0 {
                    "east"
                } else {
                    ""
                };
                let vertical = if y < 1.0 / 3.0 {
                    "south"
                } else if y > 2.0 / 3.0 {
                    "north"
                } else {
                    ""
                };
                let direction = format!("{vertical}{horizontal}");
                additions.push(Source {
                    name: format!(
                        "{} · {}",
                        source.name,
                        if direction.is_empty() {
                            "central"
                        } else {
                            &direction
                        }
                    ),
                    shape: geometry::canonical(space, &footprint, context.kernel)?,
                    district: true,
                });
            }
        }
    }
    sources.extend(additions);
    Ok(sources)
}
