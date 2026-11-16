//! Wards: the quarters between a town's main streets, inside and outside its wall.
use super::geometry::{angle, sub, Point};
use std::f64::consts::{FRAC_PI_2, TAU};

pub struct Wards {
    centre: Point,
    /// Headings, rising, where one ward meets the next.
    bounds: Vec<f64>,
    /// A walled town's wall ring; its suburbs outside the ring are wards of their own.
    wall: Option<Vec<Point>>,
}
fn turn(value: f64) -> f64 {
    value.rem_euclid(TAU)
}
/// Whether a point lies inside a closed ring.
fn inside(p: Point, ring: &[Point]) -> bool {
    let mut within = false;
    for pair in ring.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
        {
            within = !within;
        }
    }
    within
}
impl Wards {
    /// Wards bounded by the main streets' headings; with fewer than three main streets the
    /// town divides into quarters turned to its first.
    pub fn new(centre: Point, headings: &[f64], wall: Option<Vec<Point>>) -> Self {
        let mut bounds = if headings.len() >= 3 {
            headings.iter().copied().map(turn).collect::<Vec<_>>()
        } else {
            let first = headings.first().copied().unwrap_or(0.0);
            (0..4)
                .map(|i| turn(first + f64::from(i) * FRAC_PI_2))
                .collect()
        };
        // hpc-exempt: orders a handful of ward bounds around the centre.
        bounds.sort_by(f64::total_cmp);
        Self {
            centre,
            bounds,
            wall,
        }
    }
    pub fn count(&self) -> usize {
        self.bounds.len() * if self.wall.is_some() { 2 } else { 1 }
    }
    /// The ward a point belongs to.
    pub fn of(&self, p: Point) -> usize {
        let heading = turn(angle(sub(p, self.centre)));
        let sector = self
            .bounds
            .iter()
            .rposition(|&b| b <= heading)
            .unwrap_or(self.bounds.len() - 1);
        let outside = self.wall.as_ref().is_some_and(|ring| !inside(p, ring));
        sector + if outside { self.bounds.len() } else { 0 }
    }
    /// Whether a ward lies outside the wall.
    pub fn suburb(&self, ward: usize) -> bool {
        ward >= self.bounds.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wards_lie_between_main_streets_and_beyond_the_wall() {
        let wards = Wards::new([0.0, 0.0], &[0.0, FRAC_PI_2, std::f64::consts::PI], None);
        assert_eq!(wards.count(), 3);
        assert_eq!(wards.of([1.0, 1.0]), 0);
        assert_eq!(wards.of([-1.0, 1.0]), 1);
        assert_eq!(wards.of([0.0, -1.0]), 2);
        let ring = vec![
            [-10.0, -10.0],
            [10.0, -10.0],
            [10.0, 10.0],
            [-10.0, 10.0],
            [-10.0, -10.0],
        ];
        let walled = Wards::new([0.0, 0.0], &[0.0], Some(ring));
        assert_eq!(walled.count(), 8);
        assert_eq!(walled.of([1.0, 1.0]), 0);
        assert_eq!(walled.of([20.0, 1.0]), 4);
        assert!(walled.suburb(walled.of([20.0, 1.0])));
        assert!(!walled.suburb(walled.of([-1.0, -1.0])));
    }
}
