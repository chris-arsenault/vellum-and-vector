//! Flood-floor sampling and profile transport for the source river-meander process.
use super::{meanders, Drawing, Paths, Point};
use crate::{
    chance::Chance,
    field::{significance::measure, Field},
    hpc::IntPairIndex,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Position};
// hpc-exempt: named longitudinal profiles with typed values.
use std::{collections::BTreeMap, io};
const WIDTH_PER_ROOT_DISCHARGE: f64 = 8000.0;
const WAVELENGTH_WIDTHS: f64 = 11.0;
const RESOLVED_WAVELENGTH: f64 = 0.1;
const MEANDERING_GRADIENT: f64 = 0.004;
const FLOOD_RELIEF: f64 = 0.0000005;
const FLOOD_RELIEF_PER_LOG: f64 = 0.00000075;
const MASK_CELL: f64 = 0.00000625;
const PAGE_WIDTH: usize = 64;
const FLOODPLAIN_STEPS: usize = 240;

pub struct Meandered {
    pub drawing: Drawing,
    pub oxbows: Vec<Vec<Position>>,
}
pub fn meander(
    field: &Field,
    paths: &Paths,
    drawing: &Drawing,
    start: usize,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Meandered>> {
    let discharge = drawing
        .profiles
        .get("discharges")
        .into_iter()
        .flatten()
        .copied()
        .fold(0.0, f64::max);
    let width = field
        .scale
        .resolve(
            RelativeMeasure::new(WIDTH_PER_ROOT_DISCHARGE, -0.5, 1.0, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value()
        * discharge.sqrt();
    if WAVELENGTH_WIDTHS * width < field.scale.cells(RESOLVED_WAVELENGTH) {
        return Ok(None);
    }
    let [ox, oy] = field.mesh.origin();
    let valley = drawing
        .coordinates
        .iter()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x - ox, y - oy]
        })
        .collect::<Vec<_>>();
    if gradient(&valley, drawing.profiles.get("bedElevations")) > MEANDERING_GRADIENT {
        return Ok(None);
    }
    let relief = measure(&field.scale, FLOOD_RELIEF, 1, 1.0)?
        + measure(&field.scale, FLOOD_RELIEF_PER_LOG, 1, 1.0)?
            * (1.0 + discharge / measure(&field.scale, 1.5625e-20, 3, 1.0)?).log10();
    let salt = start as i32 ^ 0x6d2b;
    let result = floor_work(
        FloorInput {
            scale: &field.scale,
            valley: &valley,
            relief,
            width,
        },
        |p| {
            paths
                .elevation_at(field, p)
                .map(|h| MapScale::metres(h, LengthUnit::Native))
        },
        spatial,
        |floor| {
            meanders::migrate(
                &valley,
                width,
                FLOODPLAIN_STEPS,
                floor,
                |k| Chance::of(salt, 0).unit([k as f64, 0.0]),
                spatial,
            )
        },
    )?;
    Ok(Some(Meandered {
        drawing: Drawing {
            coordinates: result
                .line
                .iter()
                .map(|p| Position::xy(p[0] + ox, p[1] + oy))
                .collect(),
            profiles: carry_profiles(&valley, &drawing.profiles, &result.line),
        },
        oxbows: result
            .oxbows
            .iter()
            .map(|line| {
                line.iter()
                    .map(|p| Position::xy(p[0] + ox, p[1] + oy))
                    .collect()
            })
            .collect(),
    }))
}
fn along(line: &[Point]) -> Vec<f64> {
    let mut out = vec![0.0];
    for pair in line.windows(2) {
        out.push(out.last().unwrap() + (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]));
    }
    out
}
fn carry_profiles(
    valley: &[Point],
    // hpc-exempt: names select profile channels; distance and values remain numerical arrays.
    profiles: &BTreeMap<String, Vec<f64>>,
    course: &[Point],
    // hpc-exempt: output retains the same named numerical profiles.
) -> BTreeMap<String, Vec<f64>> {
    let from = along(valley);
    let to = along(course);
    let total = *from.last().filter(|&&v| v != 0.0).unwrap_or(&1.0);
    let length = *to.last().filter(|&&v| v != 0.0).unwrap_or(&1.0);
    let mut k = 0;
    let positions = to
        .iter()
        .map(|d| {
            let target = d / length * total;
            while k < from.len() - 2 && from[k + 1] < target {
                k += 1;
            }
            let span = from[k + 1] - from[k];
            (
                k,
                if span > 0.0 {
                    ((target - from[k]) / span).clamp(0.0, 1.0)
                } else {
                    0.0
                },
            )
        })
        .collect::<Vec<_>>();
    profiles
        .iter()
        .map(|(key, values)| {
            (
                key.clone(),
                positions
                    .iter()
                    .map(|&(k, t)| {
                        let a = values
                            .get(k)
                            .or_else(|| values.last())
                            .copied()
                            .unwrap_or(f64::NAN);
                        let b = values.get(k + 1).copied().unwrap_or(a);
                        a + (b - a) * t
                    })
                    .collect(),
            )
        })
        .collect()
}
fn gradient(line: &[Point], beds: Option<&Vec<f64>>) -> f64 {
    let Some(beds) = beds.filter(|b| b.len() >= 2) else {
        return 0.0;
    };
    let length = along(line).last().copied().unwrap_or(0.0);
    if length > 0.0 {
        (beds[0] - beds.last().unwrap()).abs() / length
    } else {
        0.0
    }
}
struct Pages {
    addresses: IntPairIndex,
    values: Vec<Vec<u8>>,
    span: f64,
}
impl Pages {
    fn at(
        &mut self,
        [x, y]: Point,
        mut reaches: impl FnMut(Point) -> io::Result<bool>,
    ) -> io::Result<bool> {
        let column = (x / self.span).floor();
        let row = (y / self.span).floor();
        let px = (column / PAGE_WIDTH as f64).floor();
        let py = (row / PAGE_WIDTH as f64).floor();
        if px < i32::MIN as f64
            || px > i32::MAX as f64
            || py < i32::MIN as f64
            || py > i32::MAX as f64
        {
            return Err(io::Error::other(
                "Flood floor page exceeds integer address representation",
            ));
        }
        let key = self.addresses.include(px as i32, py as i32);
        if key == self.values.len() {
            self.values.push(vec![0; PAGE_WIDTH * PAGE_WIDTH]);
        }
        let page = &mut self.values[key];
        let at = (row - py * PAGE_WIDTH as f64) as usize * PAGE_WIDTH
            + (column - px * PAGE_WIDTH as f64) as usize;
        if page[at] == 0 {
            page[at] = if reaches([(column + 0.5) * self.span, (row + 0.5) * self.span])? {
                2
            } else {
                1
            };
        }
        Ok(page[at] == 2)
    }
}
struct FloorInput<'a> {
    scale: &'a MapScale,
    valley: &'a [Point],
    relief: f64,
    width: f64,
}
fn floor_work<T>(
    input: FloorInput<'_>,
    mut height: impl FnMut(Point) -> io::Result<f64>,
    spatial: &dyn SpatialKernel,
    work: impl FnOnce(&mut dyn FnMut(Point) -> io::Result<bool>) -> io::Result<T>,
) -> io::Result<T> {
    let span = measure(input.scale, MASK_CELL, 1, 1.0)?
        .max((input.width / 4.0).min(input.scale.cells(1.0 / 64.0)));
    let beds = input
        .valley
        .iter()
        .map(|&p| height(p))
        .collect::<io::Result<Vec<_>>>()?;
    let points = input
        .valley
        .iter()
        .map(|&[x, y]| Geometry::Point {
            coordinates: Position::xy(x, y),
        })
        .collect::<Vec<_>>();
    let index = spatial.index(&points).map_err(io::Error::other)?;
    let mut pages = Pages {
        addresses: IntPairIndex::default(),
        values: Vec::new(),
        span,
    };
    work(&mut |point| {
        pages.at(point, |point| {
            let nearest = index
                .nearest(Position::xy(point[0], point[1]))
                .map_err(io::Error::other)?;
            match nearest {
                Some(at) => Ok(height(point)? <= beds[at] + input.relief),
                None => Ok(false),
            }
        })
    })
}
