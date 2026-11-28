//! Lines that wander.
use super::Warp;

/// A run of straight legs made to wander. The line is cut into steps of `spacing` and
/// each step is pulled by the warp, up to `reach` either way, less toward the two ends
/// so the line still begins and ends where it did and meets what it met. A boundary, a
/// track or a bank drawn between two known points gets its small turns from this; one
/// whose whole course is open is better walked by a [`super::Walker`].
pub fn wandering(line: &[[f64; 2]], warp: &Warp, spacing: f64, reach: f64) -> Vec<[f64; 2]> {
    let lengths: Vec<f64> = line
        .windows(2)
        .map(|pair| (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]))
        .collect();
    let whole: f64 = lengths.iter().sum();
    if line.len() < 2 || whole <= 0.0 || spacing <= 0.0 {
        return line.to_vec();
    }
    let mut out = Vec::new();
    let mut before = 0.0;
    for (pair, length) in line.windows(2).zip(&lengths) {
        let parts = (length / spacing).ceil().max(1.0) as usize;
        for part in 0..parts {
            let along = part as f64 / parts as f64;
            let point = [
                pair[0][0] + (pair[1][0] - pair[0][0]) * along,
                pair[0][1] + (pair[1][1] - pair[0][1]) * along,
            ];
            let travelled = before + length * along;
            // The pull fades over one reach from either end.
            let held = (travelled.min(whole - travelled) / reach.max(spacing)).min(1.0);
            let [east, north] = warp.pull(point);
            out.push([
                point[0] + east * reach * held,
                point[1] + north * reach * held,
            ]);
        }
        before += length;
    }
    out.push(line[line.len() - 1]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chance::Chance;

    fn warp(roll: i32) -> Warp {
        Warp::new(
            [
                Chance::named(roll, "test.line.east"),
                Chance::named(roll, "test.line.north"),
            ],
            400.,
            3,
        )
    }
    fn length(line: &[[f64; 2]]) -> f64 {
        line.windows(2)
            .map(|pair| (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]))
            .sum()
    }

    #[test]
    fn a_wandering_line_keeps_its_ends_strays_within_its_reach_and_runs_longer() {
        let straight = [[0., 0.], [3_000., 0.], [3_000., 2_000.]];
        let line = wandering(&straight, &warp(1), 50., 150.);
        assert_eq!(line[0], straight[0]);
        assert_eq!(line[line.len() - 1], straight[2]);
        assert!(line.len() > 90);
        // Every point lies within its reach of the straight run, and some lie well off.
        let off = |[x, y]: [f64; 2]| {
            if y <= 0. || x < 3_000. - 220. {
                y.abs().min((x - 3_000.).hypot(y))
            } else {
                (x - 3_000.).abs()
            }
        };
        assert!(line.iter().all(|p| off(*p) <= 150. * 1.5), "strays too far");
        assert!(line.iter().filter(|p| off(**p) > 30.).count() > 10);
        assert!(length(&line) > length(&straight) * 1.005);
        // Neighbouring steps move together: no step jumps.
        assert!(line
            .windows(2)
            .all(|pair| (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]) < 120.));
        // Another roll, another line; no reach, the same line.
        assert_ne!(line, wandering(&straight, &warp(2), 50., 150.));
        let still = wandering(&straight, &warp(1), 50., 0.);
        assert!(still.iter().all(|p| off(*p) < 1e-9));
    }
}
