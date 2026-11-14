use crate::spatial::{SpatialKernel, SpatialResult};
use atlas_map::{Bounds, Position};

pub struct Territories {
    pub areas: Vec<f64>,
    pub adjacent: Vec<u8>,
}
fn images(sites: &[[f64; 2]], width: f64) -> Vec<Position> {
    let offsets: &[f64] = if width == 0.0 {
        &[0.0]
    } else {
        &[-width, 0.0, width]
    };
    offsets
        .iter()
        .flat_map(|offset| sites.iter().map(move |p| Position::xy(p[0] + offset, p[1])))
        .collect()
}
pub fn adjacency(
    kernel: &dyn SpatialKernel,
    sites: &[[f64; 2]],
    width: f64,
) -> SpatialResult<Vec<u8>> {
    let n = sites.len();
    let mut adjacent = vec![
        0;
        n.checked_mul(n)
            .ok_or("Province adjacency exceeds address space")?
    ];
    if n == 0 {
        return Ok(adjacent);
    }
    let start = if width == 0.0 { 0 } else { n };
    for [a, b] in kernel.delaunay_edges(&images(sites, width))? {
        if !(start..start + n).contains(&a) && !(start..start + n).contains(&b) {
            continue;
        }
        let (i, j) = (a % n, b % n);
        if i != j {
            adjacent[i * n + j] = 1;
            adjacent[j * n + i] = 1;
        }
    }
    Ok(adjacent)
}
pub fn areas(
    kernel: &dyn SpatialKernel,
    sites: &[[f64; 2]],
    bounds: Bounds,
    width: f64,
) -> SpatialResult<Vec<f64>> {
    if sites.is_empty() {
        return Ok(Vec::new());
    }
    let cells = kernel.voronoi_cells(
        &images(sites, width),
        Bounds(bounds.0 - width, bounds.1, bounds.2 + width, bounds.3),
    )?;
    let offset = if width == 0.0 { 0 } else { sites.len() };
    sites
        .iter()
        .enumerate()
        .map(|(i, site)| {
            if sites[..i].contains(site) {
                return Ok(0.0);
            }
            cells
                .get(offset + i)
                .and_then(Option::as_ref)
                .map_or(Ok(0.0), |cell| kernel.area(cell))
        })
        .collect()
}
pub fn territories(
    kernel: &dyn SpatialKernel,
    sites: &[[f64; 2]],
    bounds: Bounds,
    width: f64,
) -> SpatialResult<Territories> {
    Ok(Territories {
        areas: areas(kernel, sites, bounds, width)?,
        adjacent: adjacency(kernel, sites, width)?,
    })
}
