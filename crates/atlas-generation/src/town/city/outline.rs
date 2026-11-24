//! Trace the named settlement's connected extent in its parent map.
use crate::{contours, spatial::SpatialKernel};
use atlas_map::{Bounds, Geometry, Position};
use std::io;

// Distances relative to the square root of settled area, in map metres.
const OUTSKIRTS_SHARE: f64 = 0.05;
const INLET_REACH_SHARE: f64 = 0.28;

// owner-direction(2026-11-24): the city map has a margin around the settled outline for outskirts and natural areas.
pub fn surroundings(kernel: &dyn SpatialKernel, settled: &Geometry) -> io::Result<Geometry> {
    let span = kernel.area(settled).map_err(io::Error::other)?.sqrt();
    let reach = span * INLET_REACH_SHARE;
    let margin = span * OUTSKIRTS_SHARE;
    // Outward then inward offsets span narrow inlets between settled arms.
    // Leave a smaller margin along the exposed edges. Only the map takes this shape.
    let outer = kernel
        .buffer(settled, reach)
        .map_err(io::Error::other)?
        .ok_or_else(|| io::Error::other("City surroundings need a settled area"))?;
    kernel
        .buffer(&outer, margin - reach)
        .map_err(io::Error::other)?
        .ok_or_else(|| io::Error::other("City surroundings have no area"))
}

#[derive(Default)]
pub struct Ground {
    pub residents_per_km2: f64,
    pub built_share: f64,
    pub slope: f64,
    pub water: bool,
}
impl Ground {
    fn settlement_support(&self) -> f64 {
        if self.water {
            return 0.;
        }
        // The same density and built cover that distinguish urban ground inside City.
        (self.residents_per_km2 / 1200. + self.built_share / 0.12) / (1. + self.slope / 0.25)
    }
}

// owner-direction(2026-11-24): the city edge is defined by its settled extent, population density and geography.
pub fn trace(
    kernel: &dyn SpatialKernel,
    anchor: Position,
    parent: Bounds,
    span: f64,
    precision: f64,
    mut read: impl FnMut(Position) -> io::Result<Option<Ground>>,
) -> io::Result<Geometry> {
    let [x, y, _] = anchor.coordinates();
    let Bounds(w, s, e, n) = parent;
    if !span.is_finite() || span <= 0. || !(w..=e).contains(&x) || !(s..=n).contains(&y) {
        return Err(io::Error::other(
            "City settlement lies outside its parent field",
        ));
    }
    let left = ((x - w) / span).ceil() as usize + 1;
    let below = ((y - s) / span).ceil() as usize + 1;
    let width = left + ((e - x) / span).ceil() as usize + 2;
    let height = below + ((n - y) / span).ceil() as usize + 2;
    let point = |col: usize, row: usize| {
        Position::xy(
            x + (col as f64 - left as f64) * span,
            y + (row as f64 - below as f64) * span,
        )
    };
    let seed = below * width + left;
    let origin = read(anchor)?
        .ok_or_else(|| io::Error::other("No settlement field covers the City location"))?;
    // A harbour's marker may occupy a mixed coastal pixel. Start on the named
    // site and use the best adjacent dry land to judge its local settlement density.
    let mut local_support = origin.settlement_support();
    if origin.water {
        for (col, row) in [
            (left - 1, below),
            (left + 1, below),
            (left, below - 1),
            (left, below + 1),
        ] {
            if let Some(ground) = read(point(col, row))? {
                local_support = local_support.max(ground.settlement_support());
            }
        }
    }
    // A sparse settlement can still be distinguished from the countryside around it.
    let threshold = (local_support * 0.5).clamp(0.1, 1.);
    let mut score = vec![f64::NAN; width * height];
    let mut pending = vec![seed];
    let (mut west, mut east, mut south, mut north) = (left, left, below, below);
    while let Some(i) = pending.pop() {
        if !score[i].is_nan() {
            continue;
        }
        let (c, r) = (i % width, i / width);
        let p = point(c, r);
        let [px, py, _] = p.coordinates();
        let mut v = if (w..=e).contains(&px) && (s..=n).contains(&py) {
            read(p)?.map_or(0., |g| g.settlement_support())
        } else {
            0.
        };
        // The named place locates settlement within its donor cell even below raster resolution.
        if i == seed {
            v = v.max(threshold * 2.);
        }
        score[i] = v / (v + threshold);
        if v <= threshold {
            continue;
        }
        west = west.min(c);
        east = east.max(c);
        south = south.min(r);
        north = north.max(r);
        pending.extend([i - 1, i + 1, i - width, i + width]);
    }
    let value = |c: usize, r: usize| {
        let v = score[r * width + c];
        if v.is_nan() {
            0.
        } else {
            v
        }
    };
    let [ox, oy, _] = point(0, 0).coordinates();
    let mut interpolated = |[px, py]: [f64; 2]| {
        let gx = ((px - ox) / span).clamp(0., (width - 1) as f64);
        let gy = ((py - oy) / span).clamp(0., (height - 1) as f64);
        let (c, r) = (gx.floor() as usize, gy.floor() as usize);
        let (cc, rr) = ((c + 1).min(width - 1), (r + 1).min(height - 1));
        let (tx, ty) = (gx - c as f64, gy - r as f64);
        Ok((1. - ty) * ((1. - tx) * value(c, r) + tx * value(cc, r))
            + ty * ((1. - tx) * value(c, rr) + tx * value(cc, rr)))
    };
    let [w, s, _] = point(west - 1, south - 1).coordinates();
    let [e, n, _] = point(east + 1, north + 1).coordinates();
    let shape = contours::regular(
        kernel,
        Bounds(w, s, e, n),
        [east - west + 3, north - south + 3],
        &mut interpolated,
        contours::Options {
            precision,
            level: 0.5,
            tolerance: span / 12.,
        },
    )?;
    shape.ok_or_else(|| io::Error::other("The settlement has no resolvable City outline"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn map_includes_open_ground_between_settled_arms_and_an_outer_margin() {
        use atlas_map::regions::rectangle;
        let kernel = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let settled = kernel
            .union_all(&[
                rectangle(Bounds(0., 0., 4000., 1000.)),
                rectangle(Bounds(0., 0., 1300., 3200.)),
                rectangle(Bounds(2700., 0., 4000., 3200.)),
            ])
            .unwrap()
            .unwrap();
        let map = surroundings(&kernel, &settled).unwrap();
        let probes = [
            Position::xy(2000., 2000.),
            Position::xy(-80., 1500.),
            Position::xy(4800., 1500.),
        ];
        assert!(kernel
            .relation(&map, &settled, crate::spatial::Predicate::Covers)
            .unwrap());
        assert_eq!(kernel.covers_points(&settled, &probes).unwrap(), [false; 3]);
        assert_eq!(
            kernel.covers_points(&map, &probes).unwrap(),
            [true, true, false]
        );
    }

    #[test]
    fn follows_the_settled_corridor_and_stops_at_water() {
        let kernel = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let city = trace(
            &kernel,
            Position::xy(0., 0.),
            Bounds(-5000., -5000., 5000., 5000.),
            250.,
            1e-6,
            |p| {
                let [x, y, _] = p.coordinates();
                let built = x >= -2500. && (y + 0.2 * x).abs() < 420.;
                Ok(Some(Ground {
                    residents_per_km2: if built { 2600. } else { 20. },
                    water: x > 800. && x < 1200.,
                    ..Ground::default()
                }))
            },
        )
        .unwrap();
        assert_eq!(
            kernel
                .covers_points(
                    &city,
                    &[
                        Position::xy(-2000., 400.),
                        Position::xy(1500., -300.),
                        Position::xy(0., 1500.)
                    ]
                )
                .unwrap(),
            [true, false, false]
        );
    }
}
