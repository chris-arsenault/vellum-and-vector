//! Curvature-driven bank migration and neck/chute cutoffs from world/meanders.ts.
use super::Point;
use crate::spatial::SpatialKernel;
use atlas_map::{Bounds, Geometry, Position};
use std::io;
const LOCAL_WEIGHT: f64 = -1.0;
const UPSTREAM_WEIGHT: f64 = 2.5;
const UPSTREAM_REACH: f64 = 5.0;
const EROSION_PER_STEP: f64 = 0.05;
const LARGEST_SHIFT: f64 = 0.05;
const CURVATURE_SMOOTHING: usize = 4;
const STATION_SPACING: f64 = 0.5;
const CUTOFF_WIDTH: f64 = 1.0;
const BEND_ROOM: f64 = 2.0;
const CHUTE_REACH: f64 = 3.0;
const CHUTE_RATIO: f64 = 6.0;
const CUTOFF_INTERVAL: usize = 4;
const HELD_ENDS: usize = 3;
const INITIAL_UNEVENNESS: f64 = 0.02;
pub struct Result {
    pub line: Vec<Point>,
    pub oxbows: Vec<Vec<Point>>,
}
pub fn migrate(
    input: &[Point],
    width: f64,
    steps: usize,
    mut floor: impl FnMut(Point) -> io::Result<bool>,
    draw: impl Fn(usize) -> f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<Result> {
    let spacing = STATION_SPACING * width;
    let mut line = resample(input, spacing);
    let mut oxbows = Vec::new();
    if line.len() < 2 * HELD_ENDS + 3 {
        return Ok(Result {
            line: input.to_vec(),
            oxbows,
        });
    }
    let mut perturbed = line.clone();
    for k in HELD_ENDS..line.len() - HELD_ENDS {
        let n = normal(&line, k);
        let offset = (draw(k) * 2.0 - 1.0) * INITIAL_UNEVENNESS * width;
        let moved = [line[k][0] + n[0] * offset, line[k][1] + n[1] * offset];
        if floor(moved)? {
            perturbed[k] = moved;
        }
    }
    line = perturbed;
    for at in 0..steps {
        line = step(&line, width, &mut floor)?;
        if at % CUTOFF_INTERVAL == CUTOFF_INTERVAL - 1 {
            line = cutoffs(line, width, &mut oxbows, spatial)?;
        }
        line = resample(&line, spacing);
    }
    Ok(Result {
        line: resample(&cutoffs(line, width, &mut oxbows, spatial)?, spacing),
        oxbows,
    })
}
fn step(
    line: &[Point],
    width: f64,
    floor: &mut impl FnMut(Point) -> io::Result<bool>,
) -> io::Result<Vec<Point>> {
    let curvature = smoothed_curvature(line, width);
    let fade = (-mean_spacing(line) / (UPSTREAM_REACH * width)).exp();
    let room = BEND_ROOM * width;
    let mut next = line.to_vec();
    let (mut carried, mut weight) = (0.0, 0.0);
    for k in 0..line.len() {
        let rate = LOCAL_WEIGHT * curvature[k]
            + UPSTREAM_WEIGHT * if weight != 0.0 { carried / weight } else { 0.0 };
        carried = carried * fade + curvature[k];
        weight = weight * fade + 1.0;
        if k < HELD_ENDS || k >= line.len() - HELD_ENDS {
            continue;
        }
        let [nx, ny] = normal(line, k);
        let shift = (EROSION_PER_STEP * rate).clamp(-LARGEST_SHIFT, LARGEST_SHIFT) * width;
        if floor([line[k][0] + nx * room, line[k][1] + ny * room])?
            && floor([line[k][0] - nx * room, line[k][1] - ny * room])?
        {
            next[k] = [line[k][0] + nx * shift, line[k][1] + ny * shift];
        }
    }
    Ok(next)
}
fn smoothed_curvature(line: &[Point], width: f64) -> Vec<f64> {
    let mut out = vec![0.0; line.len()];
    let mut spare = out.clone();
    for k in 1..line.len() - 1 {
        let [a, b, c] = [line[k - 1], line[k], line[k + 1]];
        let (ux, uy, vx, vy) = (b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]);
        let turn = (ux * vy - uy * vx).atan2(ux * vx + uy * vy);
        let length = (ux.hypot(uy) + vx.hypot(vy)) / 2.0;
        out[k] = if length > 0.0 {
            turn / length * width
        } else {
            0.0
        };
    }
    for _ in 0..CURVATURE_SMOOTHING {
        spare[0] = out[0];
        spare[line.len() - 1] = out[line.len() - 1];
        for k in 1..line.len() - 1 {
            spare[k] = 0.25 * out[k - 1] + 0.5 * out[k] + 0.25 * out[k + 1];
        }
        std::mem::swap(&mut out, &mut spare);
    }
    out
}
fn cutoffs(
    mut line: Vec<Point>,
    width: f64,
    oxbows: &mut Vec<Vec<Point>>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Point>> {
    loop {
        let spacing = mean_spacing(&line);
        let reach = CHUTE_REACH * width;
        let points = line
            .iter()
            .map(|&[x, y]| Geometry::Point {
                coordinates: Position::xy(x, y),
            })
            .collect::<Vec<_>>();
        let index = spatial.index(&points).map_err(io::Error::other)?;
        let mut cut = None;
        for a in 0..line.len() {
            let [x, y] = line[a];
            let mut found = None;
            for b in index
                .query(Bounds(x - reach, y - reach, x + reach, y + reach))
                .map_err(io::Error::other)?
            {
                if b <= a + 2 || found.is_some_and(|found| b <= found) {
                    continue;
                }
                let across = (line[b][0] - x).hypot(line[b][1] - y);
                let along = (b - a) as f64 * spacing;
                if (across < CUTOFF_WIDTH * width
                    && along > std::f64::consts::PI * CUTOFF_WIDTH * width)
                    || (across < reach && along > CHUTE_RATIO * across)
                {
                    found = Some(b);
                }
            }
            if let Some(b) = found {
                cut = Some((a, b));
                break;
            }
        }
        drop(index);
        let Some((a, b)) = cut else {
            return Ok(line);
        };
        oxbows.push(line[a..=b].to_vec());
        line.drain(a + 1..b);
    }
}
fn normal(line: &[Point], k: usize) -> Point {
    let a = line[k.saturating_sub(1)];
    let b = line[(k + 1).min(line.len() - 1)];
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx.hypot(dy);
    let length = if length == 0.0 { 1.0 } else { length };
    [-dy / length, dx / length]
}
fn mean_spacing(line: &[Point]) -> f64 {
    line.windows(2)
        .map(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1]))
        .sum::<f64>()
        / line.len().saturating_sub(1).max(1) as f64
}
pub fn resample(line: &[Point], spacing: f64) -> Vec<Point> {
    let Some(&first) = line.first() else {
        return Vec::new();
    };
    let mut out = vec![first];
    let mut carry = 0.0;
    for pair in line.windows(2) {
        let [a, b] = [pair[0], pair[1]];
        let length = (b[0] - a[0]).hypot(b[1] - a[1]);
        let mut at = spacing - carry;
        while at <= length {
            out.push(super::curves::mix(a, b, at / length));
            at += spacing;
        }
        carry = length - (at - spacing);
    }
    let last = *line.last().unwrap();
    let end = out.last_mut().unwrap();
    if (last[0] - end[0]).hypot(last[1] - end[1]) > spacing * 0.25 {
        out.push(last);
    } else {
        *end = last;
    }
    out
}
