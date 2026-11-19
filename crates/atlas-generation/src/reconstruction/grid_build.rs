//! Initial sampled-field masks and cell measures from grids.ts and adaptiveField.ts.
use super::{Grid, Layout};
use crate::{
    spatial::{Predicate, SpatialKernel},
    storage::{Band, Coverage, SharedCache},
};
use atlas_map::{regions::rectangle, Bounds, Geometry, Position};
use std::{io, rc::Rc};

pub struct Sampled {
    pub grid: Rc<Grid>,
    pub active: Band<u8>,
    pub resolution: f64,
    pub coverage: Coverage,
}
pub struct Frame<'a> {
    pub bounds: [f64; 4],
    pub footprint: &'a Geometry,
    pub periodic_width: Option<f64>,
    pub precision: f64,
}
pub fn create(
    frame: Frame<'_>,
    layout: Layout,
    spatial: &dyn SpatialKernel,
    cache: SharedCache,
) -> io::Result<Sampled> {
    let Frame {
        bounds,
        footprint,
        periodic_width,
        precision,
    } = frame;
    if !bounds.iter().all(|n| n.is_finite())
        || bounds[2] <= bounds[0]
        || bounds[3] <= bounds[1]
        || !spatial
            .relation(&rectangle(box_bounds(bounds)), footprint, Predicate::Covers)
            .map_err(io::Error::other)?
    {
        return Err(io::Error::other(
            "A numerical grid requires a positive footprint within its sample bounds",
        ));
    }
    let count = sample_count(&layout)?;
    let mut coverage = Coverage::samples(count, cache);
    let mut measures = coverage.allocate(0.0);
    let mut active = coverage.allocate(0u8);
    let adaptive = matches!(layout, Layout::Adaptive(_));
    let extent = spatial.bounds(footprint).map_err(io::Error::other)?;
    let grid = Grid {
        bounds: if adaptive {
            [extent.0, extent.1, extent.2, extent.3]
        } else {
            bounds
        },
        periodic_width,
        layout,
        measures: measures.read_only(),
        donors: Default::default(),
    };
    let rectangle_bounds = if adaptive { extent } else { box_bounds(bounds) };
    let rectangular = spatial
        .relation(footprint, &rectangle(rectangle_bounds), Predicate::Covers)
        .map_err(io::Error::other)?;
    let mut resolution: f64 = 0.0;
    for start in (0..count).step_by(4096) {
        let end = (start + 4096).min(count);
        let boxes = (start..end)
            .map(|i| cell_bounds(&grid, i))
            .collect::<io::Result<Vec<_>>>()?;
        let areas = if rectangular {
            boxes
                .iter()
                .map(|&b| rectangular_area(b, rectangle_bounds, adaptive, precision))
                .collect::<io::Result<Vec<_>>>()?
        } else {
            spatial
                .intersection_areas(
                    footprint,
                    &boxes
                        .iter()
                        .map(|&b| rectangle(box_bounds(b)))
                        .collect::<Vec<_>>(),
                )
                .map_err(io::Error::other)?
        };
        let covered = if adaptive || rectangular {
            None
        } else {
            let positions = (start..end)
                .map(|i| grid.position(i).map(|[x, y]| Position::xy(x, y)))
                .collect::<io::Result<Vec<_>>>()?;
            Some(
                spatial
                    .covers_points(footprint, &positions)
                    .map_err(io::Error::other)?,
            )
        };
        for (offset, (&area, b)) in areas.iter().zip(&boxes).enumerate() {
            measures.set(start + offset, area)?;
            active.set(
                start + offset,
                u8::from(covered.as_ref().map_or(area > 0.0, |c| c[offset])),
            )?;
            if adaptive && area > 0.0 {
                resolution = resolution.max(b[2] - b[0]).max(b[3] - b[1]);
            }
        }
    }
    if let Layout::Raster { width, height } = grid.layout {
        resolution = ((bounds[2] - bounds[0]) / (width - 1) as f64)
            .max((bounds[3] - bounds[1]) / (height - 1) as f64);
    }
    Ok(Sampled {
        grid: Rc::new(grid),
        active,
        resolution,
        coverage,
    })
}
fn sample_count(layout: &Layout) -> io::Result<usize> {
    match layout {
        Layout::Raster { width, height } if *width >= 2 && *height >= 2 => width
            .checked_mul(*height)
            .ok_or_else(|| io::Error::other("Raster dimensions exceed index representation")),
        Layout::Raster { .. } => Err(io::Error::other(
            "Raster dimensions require at least two samples",
        )),
        Layout::Adaptive(t) => Ok(t.leaves.len()),
    }
}
fn box_bounds([w, s, e, n]: [f64; 4]) -> Bounds {
    Bounds(w, s, e, n)
}
pub fn cell_bounds(grid: &Grid, cell: usize) -> io::Result<[f64; 4]> {
    match &grid.layout {
        Layout::Adaptive(t) => t.cell(cell),
        Layout::Raster { width, height } => {
            let [x, y] = grid.position(cell)?;
            let [w, s, e, n] = grid.bounds;
            let dx = (e - w) / (width - 1) as f64 / 2.0;
            let dy = (n - s) / (height - 1) as f64 / 2.0;
            Ok([w.max(x - dx), s.max(y - dy), e.min(x + dx), n.min(y + dy)])
        }
    }
}
fn rectangular_area(
    b: [f64; 4],
    extent: Bounds,
    adaptive: bool,
    precision: f64,
) -> io::Result<f64> {
    if adaptive {
        return Ok((b[2].min(extent.2) - b[0].max(extent.0)).max(0.0)
            * (b[3].min(extent.3) - b[1].max(extent.1)).max(0.0));
    }
    let precise = |n: f64| (n / precision + 0.5).floor() * precision;
    let width = precise(b[2]) - precise(b[0]);
    let height = precise(b[3]) - precise(b[1]);
    if width <= 0.0 || height <= 0.0 {
        return Err(io::Error::other(
            "Grid cells collapse at the declared precision",
        ));
    }
    Ok(width * height)
}
