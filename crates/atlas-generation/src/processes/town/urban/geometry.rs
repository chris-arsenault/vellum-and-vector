//! Divide land along access lines. Both sides reuse the identical cut, including its bend.
use crate::{
    spatial::{Overlay, SpatialKernel},
    town::geometry::{add, dot, heading, left, scale, Point},
};
use atlas_map::{
    regions::{boundary_lines, parts, polygon},
    Geometry, Position,
};
use std::io;

pub fn xy(p: Position) -> Point {
    let [x, y, _] = p.coordinates();
    [x, y]
}
pub fn pos(p: Point) -> Position {
    Position::xy(p[0], p[1])
}
pub fn line(points: &[Point]) -> Geometry {
    Geometry::LineString {
        coordinates: points.iter().copied().map(pos).collect(),
    }
}
pub fn ring(points: &[Point]) -> Geometry {
    Geometry::Polygon {
        coordinates: vec![points
            .iter()
            .copied()
            .chain(points.first().copied())
            .map(pos)
            .collect()],
    }
}
pub fn sample(key: u64) -> f64 {
    let mut x = key.wrapping_add(0x9e3779b97f4a7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d049bb133111eb);
    ((x ^ (x >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

pub struct Division {
    pub faces: Vec<Geometry>,
    pub ways: Vec<Geometry>,
}

/// Each cut connects to the boundary access of its parent face. Changes in frontage
/// direction and block depth accumulate locally across the network.
pub fn divide(
    kernel: &dyn SpatialKernel,
    land: &Geometry,
    target_area: f64,
    angle: f64,
    seed: u64,
) -> io::Result<Division> {
    divide_by(kernel, land, angle, seed, |_| Ok((target_area, None)))
}

/// Each new face can support a different amount of access. A supplied centre of
/// demand attracts the cut while its ends still meet the face boundary.
pub fn divide_by(
    kernel: &dyn SpatialKernel,
    land: &Geometry,
    angle: f64,
    seed: u64,
    demand: impl Fn(&Geometry) -> io::Result<(f64, Option<Point>)>,
) -> io::Result<Division> {
    let mut result = Division {
        faces: Vec::new(),
        ways: Vec::new(),
    };
    let mut queue: Vec<_> = parts(land)
        .into_iter()
        .enumerate()
        .map(|(i, g)| (g, angle, seed.wrapping_add(i as u64)))
        .collect();
    while let Some((face, angle, key)) = queue.pop() {
        let area = kernel.area(&face).map_err(io::Error::other)?;
        let (target_area, focus) = demand(&face)?;
        if area <= target_area * (0.8 + sample(key) * 0.6) {
            result.faces.push(face);
            continue;
        }
        let axis = heading(angle);
        let cross = left(axis);
        let mut lo = [f64::INFINITY; 2];
        let mut hi = [f64::NEG_INFINITY; 2];
        for point in boundary_lines(&face).iter().flatten() {
            for (i, v) in [axis, cross].iter().enumerate() {
                let u = dot(xy(*point), *v);
                lo[i] = lo[i].min(u);
                hi[i] = hi[i].max(u);
            }
        }
        let span = [hi[0] - lo[0], hi[1] - lo[1]];
        let k = usize::from(span[1] > span[0]);
        let across = [axis, cross][k];
        let along = [axis, cross][1 - k];
        let middle = lo[k] + span[k] * (0.39 + 0.22 * sample(key ^ 19));
        let station = focus.map_or(middle, |p| 0.35 * middle + 0.65 * dot(p, across));
        let center = add(
            scale(across, station),
            scale(along, (hi[1 - k] + lo[1 - k]) * 0.5),
        );
        let point = |u, v| add(center, add(scale(across, u), scale(along, v)));
        let extent = span[0] + span[1] + 1.;
        let bend = span[k].min(span[1 - k]) * (sample(key ^ 35) - 0.5) * 0.15;
        let cut = [point(-bend, -extent), point(bend, 0.), point(-bend, extent)];
        let half = ring(&[
            cut[0],
            cut[1],
            cut[2],
            point(-extent, extent),
            point(-extent, -extent),
        ]);
        let mut children = Vec::new();
        for op in [Overlay::Intersection, Overlay::Difference] {
            if let Some(g) = kernel
                .overlay(&face, &half, op)
                .map_err(io::Error::other)?
                .and_then(polygon)
            {
                children.extend(parts(&g));
            }
        }
        if children.len() < 2
            || children
                .iter()
                .any(|c| kernel.area(c).is_ok_and(|a| a >= area - 0.01))
        {
            result.faces.push(face);
            continue;
        }
        if let Some(way) = kernel
            .clip_trace(&line(&cut), &face)
            .map_err(io::Error::other)?
        {
            result.ways.extend(
                boundary_lines(&way)
                    .into_iter()
                    .filter(|l| l.len() >= 2)
                    .map(|coordinates| Geometry::LineString { coordinates }),
            );
        }
        for (i, child) in children.into_iter().enumerate() {
            let next = key.wrapping_mul(3).wrapping_add(i as u64 + 1);
            queue.push((child, angle + (sample(next) - 0.5) * 0.22, next));
        }
    }
    Ok(result)
}

pub fn faces(
    kernel: &dyn SpatialKernel,
    land: &Geometry,
    ways: &[Geometry],
) -> io::Result<Vec<Geometry>> {
    let mut edges = boundary_lines(land);
    for way in ways {
        edges.extend(boundary_lines(way));
    }
    let Some(noded) = kernel
        .node_lines(&Geometry::MultiLineString { coordinates: edges })
        .map_err(io::Error::other)?
    else {
        return Ok(parts(land));
    };
    let faces = kernel.polygonize(&noded).map_err(io::Error::other)?;
    let points = kernel.interiors(&faces).map_err(io::Error::other)?;
    Ok(faces
        .into_iter()
        .zip(
            kernel
                .covers_points(land, &points)
                .map_err(io::Error::other)?,
        )
        .filter_map(|(g, inside)| inside.then_some(g))
        .collect())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use atlas_gis::geometry::NativeGeos;
    #[test]
    fn routes_partition_both_banks_and_leave_a_reserved_court_open() {
        let kernel = NativeGeos::new(1e-6).unwrap();
        let outer = ring(&[[0., 0.], [620., 0.], [620., 430.], [0., 430.]]);
        let court = ring(&[[150., 90.], [210., 90.], [210., 130.], [150., 130.]]);
        let land = kernel
            .overlay(&outer, &court, Overlay::Difference)
            .unwrap()
            .unwrap();
        let arterial = line(&[[285., 0.], [285., 430.]]);
        let districts = faces(&kernel, &land, &[arterial]).unwrap();
        assert_eq!(districts.len(), 2);
        for district in districts {
            let division = divide(&kernel, &district, 1600., 0.42, 31).unwrap();
            assert!(division.faces.len() > 2);
            let districts_from_routes = faces(&kernel, &district, &division.ways).unwrap();
            assert!(districts_from_routes.len() > 2);
            for parcel in division.faces {
                assert_eq!(
                    kernel
                        .covers_points(&parcel, &[Position::xy(180., 110.)])
                        .unwrap(),
                    [false]
                );
            }
            assert!(!division.ways.is_empty());
        }
    }
}
