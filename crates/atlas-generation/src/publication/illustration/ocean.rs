use crate::{
    contours::{self, BoxFan, Options},
    field::inheritance::resources::Resource,
    reconstruction::{resample::Sampler, Layout},
    spatial::{Overlay, SpatialKernel},
    storage::Coverage,
};
use atlas_map::{Bounds, Geometry};
use std::io;

pub struct Ocean<'a> {
    pub field: &'a Resource,
    pub water: Option<&'a Resource>,
    pub footprint: &'a Geometry,
    /// None is a scalar-only map; Some(None) records an authoritative absence of ocean.
    pub recorded: Option<Option<&'a Geometry>>,
    pub precision: f64,
}
pub fn drawn_ocean(
    source: &Ocean<'_>,
    coverage: &mut Coverage,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    let mut ocean = match source.recorded {
        Some(value) => value.cloned(),
        None => contour(
            source.field,
            source.water,
            source.footprint,
            source.precision,
            coverage,
            spatial,
        )?,
    };
    for edit in &source.field.overlays {
        if !edit.channels.iter().any(|c| c == "Elevation") {
            continue;
        }
        let retained = ocean
            .map(|shape| {
                spatial
                    .overlay(&shape, &edit.footprint, Overlay::Difference)
                    .map_err(io::Error::other)
            })
            .transpose()?
            .flatten();
        let changed = contour(
            &edit.resource,
            source.water,
            &edit.footprint,
            source.precision,
            coverage,
            spatial,
        )?;
        ocean = spatial
            .union_all(&retained.into_iter().chain(changed).collect::<Vec<_>>())
            .map_err(io::Error::other)?;
    }
    Ok(ocean)
}
fn contour(
    field: &Resource,
    water: Option<&Resource>,
    footprint: &Geometry,
    precision: f64,
    coverage: &mut Coverage,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    let mut height = Sampler::new(field, "Elevation", false, false, coverage, spatial)?;
    let mut sea = water
        .filter(|water| water.channels.contains_key("EffectiveSeaLevel"))
        .map(|water| Sampler::new(water, "EffectiveSeaLevel", false, false, coverage, spatial))
        .transpose()?;
    let mut at = |point| {
        let level = sea
            .as_mut()
            .map(|sea| sea.batch(&[point], spatial).map(|v| v[0]))
            .transpose()?
            .unwrap_or(0.0);
        Ok(level - height.batch(&[point], spatial)?[0])
    };
    let [w, s, e, n] = field.grid.bounds;
    let options = Options {
        precision,
        level: 0.0,
        tolerance: 100.0,
    };
    let shape = match &field.grid.layout {
        Layout::Raster { width, height } => contours::regular(
            spatial,
            Bounds(w, s, e, n),
            [*width, *height],
            &mut at,
            options,
        )?,
        Layout::Adaptive(topology) => {
            let boxes = (0..topology.leaves.len()).map(|cell| {
                let bounds = topology.cell(cell)?;
                let adjacent = (topology.offsets.get(cell)?..topology.offsets.get(cell + 1)?)
                    .map(|edge| topology.cell(topology.neighbors.get(edge as usize)? as usize))
                    .collect::<io::Result<Vec<_>>>()?;
                Ok(BoxFan {
                    bounds: Bounds(bounds[0], bounds[1], bounds[2], bounds[3]),
                    boundary: boundary(bounds, &adjacent),
                })
            });
            contours::try_trace_boxes(spatial, Bounds(w, s, e, n), boxes, &mut at, options)?
        }
    };
    shape
        .map(|shape| {
            spatial
                .overlay(&shape, footprint, Overlay::Intersection)
                .map_err(io::Error::other)
        })
        .transpose()
        .map(Option::flatten)
}
fn boundary(b: [f64; 4], adjacent: &[[f64; 4]]) -> Vec<[f64; 2]> {
    let [w, s, e, n] = b;
    let center = [(w + e) / 2.0, (s + n) / 2.0];
    let mut points = vec![
        [w, s],
        [center[0], s],
        [e, s],
        [e, center[1]],
        [e, n],
        [center[0], n],
        [w, n],
        [w, center[1]],
    ];
    for other in adjacent {
        let vertical = other[2] == w || other[0] == e;
        let fixed = if vertical {
            if other[2] == w {
                w
            } else {
                e
            }
        } else if other[3] == s {
            s
        } else {
            n
        };
        let axis = usize::from(vertical);
        let low = b[axis].max(other[axis]);
        let high = b[axis + 2].min(other[axis + 2]);
        for value in [low, (low + high) / 2.0, high] {
            let point = if vertical {
                [fixed, value]
            } else {
                [value, fixed]
            };
            if !points.contains(&point) {
                points.push(point);
            }
        }
    }
    // hpc-exempt: one contour cell's conforming boundary stations, not a spatial search.
    points.sort_by(|a, b| {
        (a[1] - center[1])
            .atan2(a[0] - center[0])
            .total_cmp(&(b[1] - center[1]).atan2(b[0] - center[0]))
    });
    points
}
