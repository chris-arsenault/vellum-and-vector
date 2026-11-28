use super::{poi::map_records::MapState, Field};
use crate::{
    contours::{self, Linear, Options, Point},
    lattice::{fans, sampling::Sampler},
    rock::ground::GroundField,
    spatial::{Overlay, SpatialKernel},
};
use atlas_map::{Bounds, Geometry, Position};
use std::io;
pub type ReadCell<'a> = &'a dyn Fn(usize) -> io::Result<f64>;

pub fn area_geometry(
    kernel: &dyn SpatialKernel,
    shape: Option<Geometry>,
) -> io::Result<Option<Geometry>> {
    match shape {
        Some(shape @ (Geometry::Polygon { .. } | Geometry::MultiPolygon { .. })) => Ok(Some(shape)),
        Some(Geometry::GeometryCollection { geometries }) => {
            let mut polygons = Vec::new();
            for geometry in geometries {
                if let Some(area) = area_geometry(kernel, Some(geometry))? {
                    polygons.push(area);
                }
            }
            if polygons.is_empty() {
                Ok(None)
            } else {
                kernel.union_all(&polygons).map_err(io::Error::other)
            }
        }
        _ => Ok(None),
    }
}
pub fn intersect_areas(
    kernel: &dyn SpatialKernel,
    a: Option<Geometry>,
    b: Option<Geometry>,
) -> io::Result<Option<Geometry>> {
    let (Some(a), Some(b)) = (area_geometry(kernel, a)?, area_geometry(kernel, b)?) else {
        return Ok(None);
    };
    area_geometry(
        kernel,
        kernel
            .overlay(&a, &b, Overlay::Intersection)
            .map_err(io::Error::other)?,
    )
}
pub fn clip(state: &impl MapState, shape: Option<Geometry>) -> io::Result<Option<Geometry>> {
    let shape = shape
        .map(|shape| {
            state
                .chart()
                .geometry(&shape, state.spatial())
                .map_err(io::Error::other)
        })
        .transpose()?;
    intersect_areas(state.spatial(), shape, Some(state.footprint().clone()))
}
/// The lattice a contour is traced on, the kernel that joins its pieces and the precision
/// its coordinates keep: all a contour needs of a map.
pub struct Sheet<'a> {
    pub mesh: &'a crate::lattice::TriangularLattice,
    pub spatial: &'a dyn SpatialKernel,
    pub precision: f64,
}
impl<'a> Sheet<'a> {
    pub fn of(state: &'a impl MapState) -> io::Result<Self> {
        Ok(Self {
            mesh: &state.field()?.mesh,
            spatial: state.spatial(),
            precision: state.geometry_precision(),
        })
    }
}
pub fn geographic(
    state: &impl MapState,
    members: &[usize],
    value_at: &mut dyn FnMut(Point) -> io::Result<f64>,
    level: f64,
) -> io::Result<Option<Geometry>> {
    geographic_on(&Sheet::of(state)?, members, value_at, level)
}
fn geographic_on(
    sheet: &Sheet<'_>,
    members: &[usize],
    value_at: &mut dyn FnMut(Point) -> io::Result<f64>,
    level: f64,
) -> io::Result<Option<Geometry>> {
    let mesh = sheet.mesh;
    let [ox, oy] = mesh.origin();
    let (mut west, mut south, mut east, mut north) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for &cell in members {
        let [x, y] = mesh.position(cell);
        west = west.min(x + ox);
        east = east.max(x + ox);
        south = south.min(y + oy);
        north = north.max(y + oy);
    }
    let pad = 2.0 * mesh.spacing();
    let bounds = Bounds(west - pad, south - pad, east + pad, north + pad);
    let spacing = mesh.spacing() / 2.0;
    let dimensions = [
        ((east - west + 2.0 * pad) / spacing).ceil() as usize + 1,
        ((north - south + 2.0 * pad) / spacing).ceil() as usize + 1,
    ];
    contours::regular(
        sheet.spatial,
        bounds,
        dimensions,
        value_at,
        Options {
            precision: sheet.precision,
            level,
            tolerance: 100.0,
        },
    )
}
pub fn membership(
    state: &impl MapState,
    members: &[usize],
    includes: ReadCell<'_>,
) -> io::Result<Option<Geometry>> {
    membership_on(&Sheet::of(state)?, members, includes)
}
/// The outline of `members` where `includes` passes one half, traced on a bare lattice.
pub fn membership_on(
    sheet: &Sheet<'_>,
    members: &[usize],
    includes: ReadCell<'_>,
) -> io::Result<Option<Geometry>> {
    let mesh = sheet.mesh;
    let [ox, oy] = mesh.origin();
    let mut sampler = Sampler::new(mesh);
    let mut at = |[x, y]: Point| sampler.sample([x - ox, y - oy], includes);
    if members
        .iter()
        .any(|&cell| fans::touches_boundary(mesh, cell))
    {
        return geographic_on(sheet, members, &mut at, 0.5);
    }
    let support = fans::support(mesh, members);
    if support
        .iter()
        .any(|&cell| fans::touches_boundary(mesh, cell))
    {
        return geographic_on(sheet, members, &mut at, 0.5);
    }
    let mut trace = Linear::new(sheet.precision, 0.5);
    for cell in support {
        for triangle in fans::cell_fans(mesh, cell, includes)? {
            trace.triangle(triangle);
        }
    }
    trace.finish(sheet.spatial, &mut at)
}
pub fn combined(
    state: &impl MapState,
    members: &[usize],
    terms: &[ReadCell<'_>],
    combine: &dyn Fn(&[f64]) -> f64,
) -> io::Result<Option<Geometry>> {
    let mesh = &state.field()?.mesh;
    let [ox, oy] = mesh.origin();
    let mut samplers = terms.iter().map(|_| Sampler::new(mesh)).collect::<Vec<_>>();
    let mut values = vec![0.0; terms.len()];
    let mut at = |[x, y]: Point| {
        for ((sampler, term), value) in samplers.iter_mut().zip(terms).zip(&mut values) {
            *value = sampler.sample([x - ox, y - oy], term)?;
        }
        Ok(combine(&values))
    };
    if members
        .iter()
        .any(|&cell| fans::touches_boundary(mesh, cell))
    {
        return geographic(state, members, &mut at, 0.0);
    }
    let support = fans::support(mesh, members);
    if support
        .iter()
        .any(|&cell| fans::touches_boundary(mesh, cell))
    {
        return geographic(state, members, &mut at, 0.0);
    }
    let mut trace = Linear::new(state.geometry_precision(), 0.0);
    let mut samples = vec![0.0; terms.len()];
    for cell in support {
        let triangles = terms
            .iter()
            .map(|term| fans::cell_fans(mesh, cell, term))
            .collect::<io::Result<Vec<_>>>()?;
        for fan in 0..6 {
            let mut triangle = triangles[0][fan];
            for corner in 0..3 {
                for (sample, triangles) in samples.iter_mut().zip(&triangles) {
                    *sample = triangles[fan][corner][2];
                }
                triangle[corner][2] = combine(&samples);
            }
            trace.triangle(triangle);
        }
    }
    trace.finish(state.spatial(), &mut at)
}
pub fn lake_footprint(
    state: &impl MapState,
    members: &[usize],
    body: i32,
    level: f64,
) -> io::Result<Option<Geometry>> {
    let field = state.field()?;
    let mesh = &field.mesh;
    let [ox, oy] = mesh.origin();
    let elevation = field.ground().view(GroundField::Elevation);
    let bodies = field.water().column.body;
    let in_body = |cell| Ok(f64::from(bodies.get(cell)? == body));
    let depth = |cell| Ok(level - elevation.get(cell)?);
    let support = fans::support(mesh, members);
    let mut footprint = Linear::new(state.geometry_precision(), 0.0);
    let mut membership = Linear::new(state.geometry_precision(), 0.1);
    for &cell in &support {
        for triangle in fans::cell_fans(mesh, cell, &depth)? {
            footprint.triangle(triangle);
        }
        for triangle in fans::cell_fans(mesh, cell, &in_body)? {
            membership.triangle(triangle);
        }
    }
    fans::boundary(mesh, &support, true, &depth, |edge| {
        footprint.boundary(edge)
    })?;
    fans::boundary(mesh, &support, true, &in_body, |edge| {
        membership.boundary(edge)
    })?;
    let mut sampler = Sampler::new(mesh);
    let footprint = footprint.finish(state.spatial(), &mut |[x, y]| {
        Ok(level - sampler.sample([x - ox, y - oy], |cell| elevation.get(cell))?)
    })?;
    let membership = membership.finish(state.spatial(), &mut |[x, y]| {
        sampler.sample([x - ox, y - oy], in_body)
    })?;
    intersect_areas(state.spatial(), footprint, membership)
}
pub fn ocean_footprint(state: &impl MapState) -> io::Result<Option<Geometry>> {
    let field = state.field()?;
    let mesh = &field.mesh;
    let [ox, oy] = mesh.origin();
    let elevation = field.ground().view(GroundField::Elevation);
    let water = field.water();
    let mut depths = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..mesh.len() {
        let depth = water.effective_sea_level - elevation.get(cell)?;
        depths.set(
            cell,
            if water.column.kind.get(cell)? == 1 {
                depth
            } else {
                -depth.abs()
            },
        )?;
    }
    let read = |cell| depths.get(cell);
    let cells = (0..mesh.len()).collect::<Vec<_>>();
    let mut trace = Linear::new(state.geometry_precision(), 0.0);
    for &cell in &cells {
        for triangle in fans::cell_fans(mesh, cell, &read)? {
            trace.triangle(triangle);
        }
    }
    fans::boundary(mesh, &cells, false, &read, |edge| trace.boundary(edge))?;
    let mut sampler = Sampler::new(mesh);
    clip(
        state,
        trace.finish(state.spatial(), &mut |[x, y]| {
            sampler.sample([x - ox, y - oy], read)
        })?,
    )
}
pub fn fill_holes(
    kernel: &dyn SpatialKernel,
    shape: Geometry,
    maximum: f64,
    blocked: &mut dyn FnMut(&Geometry) -> io::Result<bool>,
) -> io::Result<Geometry> {
    let single = matches!(shape, Geometry::Polygon { .. });
    let polygons = match shape {
        Geometry::Polygon { coordinates } => vec![coordinates],
        Geometry::MultiPolygon { coordinates } => coordinates,
        _ => return Ok(shape),
    };
    let mut filled = Vec::new();
    for polygon in polygons {
        let mut rings = Vec::new();
        for (at, ring) in polygon.into_iter().enumerate() {
            let hole = Geometry::Polygon {
                coordinates: vec![ring.clone()],
            };
            if at == 0
                || kernel.area(&hole).map_err(io::Error::other)? >= maximum
                || blocked(&hole)?
            {
                rings.push(ring);
            }
        }
        filled.push(Geometry::Polygon { coordinates: rings });
    }
    if single {
        Ok(filled.remove(0))
    } else {
        kernel
            .union_all(&filled)
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Filled contour polygons have no area"))
    }
}
fn blocked_hole(
    field: &Field,
    kernel: &dyn SpatialKernel,
    hole: &Geometry,
    blocks: &dyn Fn(usize) -> io::Result<bool>,
) -> io::Result<bool> {
    let mesh = &field.mesh;
    let [ox, oy] = mesh.origin();
    let mut points = Vec::new();
    for cell in mesh.window_cells(kernel.bounds(hole).map_err(io::Error::other)?) {
        if blocks(cell)? {
            let [x, y] = mesh.position(cell);
            points.push(Position::xy(x + ox, y + oy));
        }
    }
    Ok(kernel
        .covers_points(hole, &points)
        .map_err(io::Error::other)?
        .into_iter()
        .any(|covered| covered))
}
pub fn fill_small_holes(
    state: &impl MapState,
    shape: Geometry,
    maximum: f64,
    blocks: &dyn Fn(usize) -> io::Result<bool>,
) -> io::Result<Geometry> {
    fill_holes(state.spatial(), shape, maximum, &mut |hole| {
        blocked_hole(state.field()?, state.spatial(), hole, blocks)
    })
}
