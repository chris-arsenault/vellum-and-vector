//! Application rules resolved from private map metadata, shared by native and WASM jobs.
use crate::generation_frame::{Geography, Prepared};
use atlas_generation::{
    atlas::{
        resolution::Profile,
        validation::{boundary::Sample, SurfaceRules},
    },
    field::landmarks::catalogue::Landmark,
    spatial::{Predicate, SpatialKernel},
};
use std::io;

pub fn located_sources<'a>(
    sources: &'a [atlas_generation::field::landmarks::magic::Source],
    frame: &Prepared,
    epochs: usize,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<&'a atlas_generation::field::landmarks::magic::Source>> {
    use atlas_generation::spatial::Overlay;
    use atlas_map::{Geometry, Position};
    let mut selected = Vec::new();
    for source in sources {
        if source.system_id.is_some()
            || source.strength == 0.0
            || i64::from(source.starts_at_epoch) >= epochs as i64
            || source
                .space_id
                .as_ref()
                .is_some_and(|id| id != &frame.scope.located.space_id)
        {
            continue;
        }
        let target = match &source.scope {
            Some(scope) => spatial
                .overlay(scope, &frame.scope.footprint, Overlay::Intersection)
                .map_err(io::Error::other)?,
            None => Some(frame.scope.footprint.clone()),
        };
        if let Some(target) = target {
            let point = Geometry::Point {
                coordinates: Position::xy(source.source.x, source.source.y),
            };
            if spatial
                .distance(&point, &target)
                .map_err(io::Error::other)?
                < source.radius
            {
                selected.push(source);
            }
        }
    }
    Ok(selected)
}

pub fn interfaces(geography: &Geography) -> atlas_generation::atlas::validation::interfaces::Rules {
    atlas_generation::atlas::validation::interfaces::Rules {
        context: geography.context(),
        boundaries: geography
            .areas
            .iter()
            .filter_map(|(id, area)| {
                area.boundary
                    .as_ref()
                    .map(|boundary| (*id, boundary.crossings.clone()))
            })
            .collect(),
        network_layers: geography
            .layers
            .values()
            .filter(|layer| layer.representation == "network")
            .map(|layer| layer.id.clone())
            .collect(),
    }
}

pub fn surface(geography: &Geography, frame: &Prepared) -> SurfaceRules {
    let selected = &geography.areas[&frame.scope.located.area_id];
    SurfaceRules {
        traits: selected.traits.clone(),
        boundary: if selected.area.parent_id.is_some() && selected.area.profile == Profile::Region {
            Vec::new()
        } else {
            selected
                .boundary
                .iter()
                .flat_map(|boundary| &boundary.samples)
                .map(|sample| Sample {
                    point: [sample.point.x, sample.point.y],
                    values: sample.values.clone(),
                })
                .collect()
        },
        facts: geography
            .layers
            .values()
            .flat_map(|layer| {
                std::iter::once(layer.id.clone()).chain(layer.facts.iter().flatten().cloned())
            })
            .map(|name| (name.clone(), name))
            .collect(),
    }
}

pub fn landmarks(
    records: Vec<Landmark>,
    frame: &Prepared,
    epochs: usize,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Landmark>> {
    let mut selected = Vec::new();
    for landmark in records {
        if landmark
            .space_id
            .as_ref()
            .is_some_and(|space| space != &frame.scope.located.space_id)
            || i64::from(landmark.emplaced_at_epoch) >= epochs as i64
        {
            continue;
        }
        if landmark
            .kind
            .parameters()
            .iter()
            .any(|p| !landmark.parameters.contains_key(p.key))
        {
            return Err(io::Error::other("Landmarks retain their declared measures"));
        }
        let footprint = spatial
            .buffer(
                &landmark.geometry,
                landmark.kind.reach(&landmark.parameters),
            )
            .map_err(io::Error::other)?
            .unwrap_or_else(|| landmark.geometry.clone());
        if spatial
            .relation(&footprint, &frame.scope.footprint, Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            selected.push(landmark);
        }
    }
    Ok(selected)
}
