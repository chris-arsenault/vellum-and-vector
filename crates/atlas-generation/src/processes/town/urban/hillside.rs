//! Survey successive elevations of a climb in world metres.
use super::grades::{Survey, DESIGN_GRADE};
use crate::town::geometry::{add, distance, dot, left, resample, scale, sub, unit, Point};

const STATION: f64 = 24.;

fn gradient(s: &Survey<'_>, p: Point) -> Point {
    let h = STATION * 0.5;
    [0, 1].map(|i| {
        let mut d = [0.; 2];
        d[i] = h;
        ((s.elevation)(add(p, d)) - (s.elevation)(sub(p, d))) / (2. * h)
    })
}

// Follow the surveyed contour from its intersection with the original corridor.
// Correct the tangent step for curvature using the local fall line.
fn contour(s: &Survey<'_>, start: Point, direction: Point, reach: f64) -> Vec<Point> {
    let height = (s.elevation)(start);
    let mut line = vec![start];
    let mut forward = direction;
    while (line.len() - 1) as f64 * STATION < reach {
        let p = *line.last().unwrap();
        let slope = gradient(s, p);
        if dot(slope, slope) < 0.0001 {
            break;
        }
        let tangent = left(unit(slope));
        let along = if dot(tangent, forward) >= 0. {
            tangent
        } else {
            scale(tangent, -1.)
        };
        let mut next = add(p, scale(along, STATION));
        for _ in 0..3 {
            let miss = height - (s.elevation)(next);
            if miss.abs() < 0.12 {
                break;
            }
            let g = gradient(s, next);
            let sq = dot(g, g);
            if sq < 0.0001 {
                break;
            }
            next = add(next, scale(g, miss / sq));
        }
        if !(s.open)(next)
            || ((s.elevation)(next) - height).abs() > 0.6
            || distance(p, next) > 1.5 * STATION
            || dot(sub(next, p), along) <= 0.
        {
            break;
        }
        forward = along;
        line.push(next);
    }
    line
}

fn station(curve: &[Point], offset: f64) -> Option<Point> {
    let index = offset.abs() / STATION;
    let i = index.floor() as usize;
    let a = *curve.get(i)?;
    if index.fract() < 1e-8 {
        return Some(a);
    }
    Some(add(a, scale(sub(*curve.get(i + 1)?, a), index.fract())))
}

fn course_quality(s: &Survey<'_>, path: &[Point], direction: f64) -> Option<(f64, f64)> {
    let stations = resample(path, STATION * 0.5);
    if stations.iter().any(|&p| !(s.open)(p)) {
        return None;
    }
    let mut risk = 0.;
    let mut peak = 0.0_f64;
    let mut z = (s.elevation)(stations[0]);
    for pair in stations.windows(2) {
        let next = (s.elevation)(pair[1]);
        let run = distance(pair[0], pair[1]);
        if run > 0.01 {
            let grade = direction * (next - z) / run;
            let excess = (grade.abs() / DESIGN_GRADE - 1.).max(0.);
            risk += run * (1. + 12. * excess.powi(2) + 8. * (-grade / DESIGN_GRADE).max(0.));
            peak = peak.max(grade.abs());
        }
        z = next;
    }
    Some((risk, peak))
}

fn round_turns(path: &[Point]) -> Vec<Point> {
    let mut result = vec![path[0]];
    for pts in path.windows(3) {
        let [a, b, c] = [pts[0], pts[1], pts[2]];
        let u = unit(sub(a, b));
        let v = unit(sub(c, b));
        if dot(u, v) < -0.65 {
            result.push(b);
            continue;
        }
        let trim = (0.30 * distance(a, b).min(distance(b, c))).min(STATION);
        let enter = add(b, scale(u, trim));
        let leave = add(b, scale(v, trim));
        for t in [0., 0.25, 0.5, 0.75, 1.] {
            result.push(add(
                add(
                    scale(enter, (1. - t) * (1. - t)),
                    scale(b, 2. * t * (1. - t)),
                ),
                scale(leave, t * t),
            ));
        }
    }
    result.push(*path.last().unwrap());
    result
}

// owner-direction(2026-11-25): a switchback follows the elevation on both legs of the hillside.
pub(super) fn traverse(s: &Survey<'_>, run: &[Point], heights: &[f64]) -> Option<Vec<Point>> {
    let (a, b) = (run[0], *run.last()?);
    let rise = heights.last()? - heights[0];
    // Place a station at each reversal, including the midpoint of each leg.
    let steps = 12 * (rise.abs() / (12. * STATION * DESIGN_GRADE)).ceil().max(1.) as usize;
    let direction = rise.signum();
    let along = unit(sub(b, a));
    let reach = rise.abs() / DESIGN_GRADE;
    if reach < distance(a, b) {
        return None;
    }
    let (mut best, original_peak) = course_quality(s, run, direction)?;
    let mut levels = Vec::new();
    let mut i = 0;
    for k in 1..steps {
        let z = heights[0] + rise * k as f64 / steps as f64;
        while i + 1 < heights.len() && direction * (heights[i + 1] - z) < 0. {
            i += 1;
        }
        let j = i + 1;
        let t = ((z - heights[i]) / (heights.get(j)? - heights[i])).clamp(0., 1.);
        let p = add(run[i], scale(sub(run[j], run[i]), t));
        let side = left(along);
        levels.push([
            contour(s, p, side, reach * 0.8),
            contour(s, p, scale(side, -1.), reach * 0.8),
        ]);
    }
    let mut winner = None;
    for turns in [1, 2, 3] {
        for factor in [0.65, 0.85, 1., 1.25, 1.55] {
            for sign in [1., -1.] {
                let mut path = vec![a];
                for (k, level) in levels.iter().enumerate() {
                    let phase = (k + 1) as f64 / steps as f64 * turns as f64;
                    let wave = (1. - (2. * phase.rem_euclid(1.) - 1.).abs())
                        * if phase.floor() as usize % 2 == 0 {
                            1.
                        } else {
                            -1.
                        };
                    let offset = sign * wave * reach * factor / (2. * turns as f64);
                    let Some(p) = station(&level[usize::from(offset < 0.)], offset) else {
                        break;
                    };
                    path.push(p);
                }
                if path.len() != steps {
                    continue;
                }
                path.push(b);
                let rounded = round_turns(&path);
                for candidate in [&rounded, &path] {
                    let Some((cost, peak)) = course_quality(s, candidate, direction) else {
                        continue;
                    };
                    let cost = cost + turns as f64 * STATION;
                    if cost < best && peak < original_peak * 0.85 && peak < DESIGN_GRADE * 1.65 {
                        best = cost;
                        winner = Some(candidate.clone());
                    }
                }
            }
        }
    }
    winner
}
