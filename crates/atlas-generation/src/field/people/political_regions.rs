//! Geographic parts of continental possessions, all retaining the same polity.
use crate::{
    features::{Feature, Relation},
    field::{
        geographic_contours,
        geographic_regions::{self, Components},
        poi::map_records::{self, MapState, PlaceRecord},
        region_partition, significance,
    },
    lattice::sampling::Sampler,
    spatial::Overlay,
};
use serde_json::json;
use std::io;

pub fn records(state: &impl MapState, parent: &Feature) -> io::Result<(Vec<Feature>, usize)> {
    let field = state.field()?;
    let bounds = state
        .spatial()
        .bounds(&parent.geometry)
        .map_err(io::Error::other)?;
    let span = (bounds.2 - bounds.0).hypot(bounds.3 - bounds.1);
    let scale = field.scale();
    if span < significance::measure(&scale, significance::LARGE_DOMAIN_SPAN, 1, 1.0)? {
        return Ok((Vec::new(), 0));
    }
    let land = region_partition::land_area(field)?;
    if !significance::large_domain(
        state
            .spatial()
            .area(&parent.geometry)
            .map_err(io::Error::other)?,
        span,
        land,
        &scale,
    )? {
        return Ok((Vec::new(), 0));
    }
    let positions = (0..field.mesh.len())
        .map(|cell| map_records::native_position(state, cell))
        .collect::<io::Result<Vec<_>>>()?;
    let covered = state
        .spatial()
        .covers_points(&parent.geometry, &positions)
        .map_err(io::Error::other)?;
    let connected = geographic_regions::components(
        state,
        &|cell| Ok(covered[cell]),
        Components {
            polygonal: false,
            splits: false,
        },
        None,
    )?;
    let mut labels = field.coverage.borrow_mut().allocate(-1i32);
    let mut records = Vec::new();
    let mut retained = 0;
    for region in connected.regions {
        let pieces = region_partition::partition(field, &region.members, land, || retained += 1)?;
        if pieces.len() < 2 {
            continue;
        }
        for (index, piece) in pieces.iter().enumerate() {
            for &cell in piece {
                labels.set(cell, index as i32)?;
            }
        }
        for (index, piece) in pieces.iter().enumerate() {
            let mut samplers = pieces
                .iter()
                .map(|_| Sampler::new(&field.mesh))
                .collect::<Vec<_>>();
            let [ox, oy] = field.mesh.origin();
            let shape = geographic_contours::geographic(
                state,
                piece,
                &mut |[x, y]| {
                    let mut own = 0.0;
                    let mut other = 0.1f64;
                    for (j, sampler) in samplers.iter_mut().enumerate() {
                        let share = sampler.sample([x - ox, y - oy], |cell| {
                            Ok(f64::from(labels.get(cell)? == j as i32))
                        })?;
                        if j == index {
                            own = share;
                        } else {
                            other = other.max(share);
                        }
                    }
                    Ok(own - other)
                },
                0.0,
            )?;
            let Some(shape) = shape else {
                continue;
            };
            let Some(clipped) = state
                .spatial()
                .overlay(&shape, &parent.geometry, Overlay::Intersection)
                .map_err(io::Error::other)?
            else {
                continue;
            };
            let mut relations = vec![Relation {
                target_id: parent.id,
                kind: "partOf".into(),
            }];
            relations.extend(parent.relations.clone());
            if let Some(record) = map_records::place_feature(
                state,
                PlaceRecord {
                    kind: "politicalRegion",
                    name: &format!("{} region", parent.name),
                    members: piece,
                    layer: &parent.layer_id,
                    attributes: serde_json::from_value(json!({
                        "parentTerritory": parent.id, "polity": parent.relations.first().map(|r| &r.target_id),
                        "boundaryDerivation": "supported-reach", "geometryMeaning": "geographic part of a continental territory"
                    }))?,
                    extent: Some(clipped),
                    placement: None,
                    relations,
                },
            )? {
                records.push(record);
            }
        }
        for cell in region.members {
            labels.set(cell, -1)?;
        }
    }
    Ok((records, retained))
}
