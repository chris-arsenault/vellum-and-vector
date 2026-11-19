use super::{display, Fields};
use crate::{
    features::chart::working,
    field::{inheritance::resources::Resource, projection::channels::Quantity},
    publication::{
        raster::Resampling,
        sampling::{self, Source},
        upload::{PublicationPlane, RasterPublicationInput},
    },
    reconstruction::grid_build::cell_bounds,
    spatial::{Overlay, Predicate, SpatialKernel},
};
use atlas_map::{regions::rectangle, Bounds, Category, Geometry, RasterBand};
// hpc-exempt: distinct categorical codes in map legends, not cell membership.
use std::collections::{BTreeMap, BTreeSet};
use std::io;

pub fn layer_id(channel: &str) -> String {
    if channel == "Elevation" {
        "terrain".into()
    } else {
        format!("raster:{channel}")
    }
}
pub fn input(
    fields: &Fields<'_>,
    source: &Source<'_>,
    asset_id: String,
    spatial: &dyn SpatialKernel,
) -> io::Result<RasterPublicationInput> {
    let channel = source
        .field
        .channels
        .get(source.channel)
        .ok_or_else(|| io::Error::other("Missing raster channel"))?;
    let terrain = source.channel == "Elevation";
    let definitions: &[(&str, &str)] = if terrain {
        &[
            ("value", &channel.unit),
            ("relative-height", "metre"),
            ("water", "category"),
            ("ice", "ratio"),
            ("sample-span", "metre"),
            ("surface", "category"),
            ("natural-surface", "category"),
            ("display-height", "metre"),
            ("east-gradient", "ratio"),
            ("north-gradient", "ratio"),
            ("log-value", "log-value"),
            ("paint-red", "color"),
            ("paint-green", "color"),
            ("paint-blue", "color"),
            ("paint-alpha", "ratio"),
        ]
    } else {
        &[("value", &channel.unit), ("log-value", "log-value")]
    };
    let mut planes = Vec::new();
    for (index, &(id, unit)) in definitions.iter().enumerate() {
        let field = if id.contains("surface") {
            source.surface.unwrap_or(source.field)
        } else {
            source.field
        };
        let name = match id {
            "surface" => "finalSurface",
            "natural-surface" => "naturalSurface",
            _ => source.channel,
        };
        let categories = if index == 0 || id.contains("surface") {
            categories(fields, field, name, source.footprint, spatial)?
        } else {
            Vec::new()
        };
        let band = RasterBand {
            id: id.into(),
            name: if index == 0 {
                fields.label(source.channel)
            } else {
                id.replace('-', " ")
            },
            unit: unit.into(),
            display: display(unit),
            nodata: None,
            categories,
            range: if index == 0 {
                Some(range(source.field, source.channel)?)
            } else {
                None
            },
        };
        let discrete = unit == "category"
            || (index == 0
                && (channel.unit == "cell-index" || channel.quantity == Quantity::Category));
        planes.push(PublicationPlane {
            band,
            resampling: if discrete {
                Resampling::Category
            } else {
                Resampling::Mean
            },
        });
    }
    Ok(RasterPublicationInput {
        asset_id,
        grid: sampling::grid(source)?,
        planes,
    })
}
fn range(field: &Resource, channel: &str) -> io::Result<(f64, f64)> {
    fn include(field: &Resource, channel: &str, range: &mut (f64, f64)) -> io::Result<()> {
        if let Some(values) = field.channels.get(channel) {
            let support = field
                .surface_support
                .as_ref()
                .and_then(|s| s.channel(channel));
            for i in 0..values.values.len() {
                let value = values.values.get(i)?;
                if field.active.get(i)? != 0 && value.is_finite() {
                    range.0 = range.0.min(value);
                    range.1 = range.1.max(value);
                    if let Some(support) = &support {
                        crate::field::projection::support::visit(support, i, |code, _| {
                            range.0 = range.0.min(f64::from(code));
                            range.1 = range.1.max(f64::from(code));
                        })?;
                    }
                }
            }
        }
        for overlay in &field.overlays {
            if overlay.channels.iter().any(|c| c == channel) {
                include(&overlay.resource, channel, range)?;
            }
        }
        Ok(())
    }
    let mut limits = (f64::INFINITY, f64::NEG_INFINITY);
    include(field, channel, &mut limits)?;
    Ok(if limits.0.is_finite() {
        limits
    } else {
        (0.0, 1.0)
    })
}
fn categories(
    fields: &Fields<'_>,
    field: &Resource,
    channel: &str,
    footprint: &Geometry,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Category>> {
    let mut result = fields.categories(channel);
    if result.is_empty() {
        return Ok(result);
    }
    // hpc-exempt: distinct categorical codes in map legends, not cell membership.
    let mut present = BTreeSet::new();
    collect(field, channel, footprint, spatial, &mut present)?;
    for entry in &mut result {
        entry.present = present.contains(&entry.value);
    }
    Ok(result)
}
fn collect(
    field: &Resource,
    channel: &str,
    footprint: &Geometry,
    spatial: &dyn SpatialKernel,
    // hpc-exempt: distinct categorical codes in map legends, not cell membership.
    result: &mut BTreeSet<i32>,
) -> io::Result<()> {
    let [w, s, e, n] = field.grid.bounds;
    let shape = working(
        footprint,
        Bounds(w, s, e, n),
        field.grid.periodic_width,
        spatial,
    )
    .map_err(io::Error::other)?;
    let mut remaining = spatial
        .overlay(
            &shape,
            &rectangle(Bounds(w, s, e, n)),
            Overlay::Intersection,
        )
        .map_err(io::Error::other)?;
    for overlay in field
        .overlays
        .iter()
        .rev()
        .filter(|o| o.channels.iter().any(|c| c == channel))
    {
        let Some(shape) = remaining else {
            return Ok(());
        };
        let patch = working(
            &overlay.footprint,
            Bounds(w, s, e, n),
            field.grid.periodic_width,
            spatial,
        )
        .map_err(io::Error::other)?;
        if let Some(covered) = spatial
            .overlay(&shape, &patch, Overlay::Intersection)
            .map_err(io::Error::other)?
        {
            collect(&overlay.resource, channel, &covered, spatial, result)?;
        }
        remaining = spatial
            .overlay(&shape, &patch, Overlay::Difference)
            .map_err(io::Error::other)?;
    }
    let (Some(remaining), Some(values)) = (remaining, field.channels.get(channel)) else {
        return Ok(());
    };
    let complete = spatial
        .relation(
            &remaining,
            &rectangle(Bounds(w, s, e, n)),
            Predicate::Covers,
        )
        .map_err(io::Error::other)?;
    let active = field.active.read_values()?;
    let values = values.values.read_values()?;
    let support = field
        .surface_support
        .as_ref()
        .and_then(|s| s.channel(channel));
    // hpc-exempt: legend categories index packed candidate cell IDs, not cell objects.
    let mut candidates: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
    for i in 0..field.active.len() {
        let code = values.get(i)?;
        if active.get(i)? == 0 || !code.is_finite() {
            continue;
        }
        for code in class_codes(code, support.as_ref(), i)? {
            if result.contains(&code) {
                continue;
            }
            if complete {
                result.insert(code);
            } else {
                candidates.entry(code).or_default().push(i);
            }
        }
    }
    for (code, indices) in candidates {
        // A legend needs one positive-area cell, not the clipped area of every cell.
        // Small batches retain mask reuse without thousands of redundant intersections.
        for batch in indices.chunks(64) {
            let cells = batch
                .iter()
                .map(|&i| {
                    let [w, s, e, n] = cell_bounds(&field.grid, i)?;
                    Ok(rectangle(Bounds(w, s, e, n)))
                })
                .collect::<io::Result<Vec<_>>>()?;
            if spatial
                .intersection_areas(&remaining, &cells)
                .map_err(io::Error::other)?
                .into_iter()
                .any(|area| area > 0.0)
            {
                result.insert(code);
                break;
            }
        }
    }
    Ok(())
}
fn class_codes(
    value: f64,
    evidence: Option<&crate::storage::ReadBand<f64>>,
    cell: usize,
) -> io::Result<smallvec::SmallVec<[i32; 8]>> {
    let mut result = smallvec::smallvec![value as i32];
    if let Some(evidence) = evidence {
        crate::field::projection::support::visit(evidence, cell, |code, _| {
            if !result.contains(&code) {
                result.push(code);
            }
        })?;
    }
    Ok(result)
}
