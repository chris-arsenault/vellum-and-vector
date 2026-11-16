//! A settlement's street network: main streets carry the ways that enter it, lanes fill
//! between them, and a main street bridges narrow water and ends at wide water.
use super::{
    geometry::{at, cut, distance, line_length, resample, Point},
    ground::{Ground, FIRST_STREET, OUTSIDE, SQUARE, STEEP, WALL, WATER},
    story::Size,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    /// A way as it runs through the built place.
    Main,
    /// The same way beyond the built edge, out through the fields.
    Road,
    Street,
    Lane,
    Alley,
}
impl Class {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Main => "mainStreet",
            Self::Road => "road",
            Self::Street => "street",
            Self::Lane => "lane",
            Self::Alley => "alley",
        }
    }
    /// The full width in metres of a street of this class in a place of `size`.
    pub fn width(self, size: Size) -> f64 {
        match (self, size) {
            (Self::Main, Size::Farmstead | Size::Hamlet) => 4.0,
            (Self::Main, Size::Village) => 6.0,
            (Self::Main, Size::Town) => 8.0,
            (Self::Main, Size::City) => 10.0,
            (Self::Road, Size::Town | Size::City) => 5.0,
            (Self::Road, _) => 4.0,
            (Self::Street, Size::Town | Size::City) => 6.0,
            (Self::Street, _) => 5.0,
            (Self::Lane, _) => 3.5,
            (Self::Alley, _) => 2.5,
        }
    }
}
/// A way entering the settlement, from its centre outward, and the place it leads to.
#[derive(Clone, Debug)]
pub struct Arm {
    pub points: Vec<Point>,
    pub destination: Option<String>,
}
#[derive(Clone, Debug)]
pub struct Street {
    /// Runs from the end nearest the settlement's centre, where numbering starts.
    pub points: Vec<Point>,
    pub widths: Vec<f64>,
    pub class: Class,
    pub destination: Option<String>,
    /// Stretches over water, as metres along the street.
    pub bridges: Vec<(f64, f64)>,
}
impl Street {
    pub fn new(points: Vec<Point>, class: Class, size: Size) -> Self {
        let widths = vec![class.width(size); points.len()];
        Self {
            points,
            widths,
            class,
            destination: None,
            bridges: Vec::new(),
        }
    }
    pub fn width(&self) -> f64 {
        self.widths.iter().copied().fold(0.0, f64::max)
    }
    pub fn length(&self) -> f64 {
        line_length(&self.points)
    }
    /// Narrows the street to `width` at vertices within `reach` metres of each gate.
    pub fn pinch(&mut self, gates: &[Point], reach: f64, width: f64) {
        for (point, w) in self.points.iter().zip(self.widths.iter_mut()) {
            if gates.iter().any(|g| distance(*g, *point) <= reach) {
                *w = w.min(width);
            }
        }
    }
}
/// Vertex spacing of generated streets, in metres, so widths can vary along them.
pub const VERTEX_STEP: f64 = 10.0;
/// The longest water a place of this size bridges; wider water ends its streets.
pub fn bridge_span(size: Size) -> f64 {
    match size {
        Size::Farmstead | Size::Hamlet => 12.0,
        Size::Village => 30.0,
        Size::Town => 80.0,
        Size::City => 160.0,
    }
}
/// Whether ground stops a lane: water, steep ground, the map's edge, a square or a wall.
pub fn stops_lane(owner: u32) -> bool {
    matches!(owner, WATER | STEEP | OUTSIDE | SQUARE | WALL)
}
/// A main street along an arm, as far as `reach` from the centre, bridging water it can span
/// and ending before water it cannot.
pub fn main_street(arm: &Arm, reach: f64, size: Size, ground: &Ground) -> Option<Street> {
    let mut points = resample(&cut(&arm.points, reach), VERTEX_STEP);
    let edge = ground.reach(&points, |owner| owner == OUTSIDE || owner == STEEP);
    let mut bridges = Vec::new();
    let mut end = edge.max(VERTEX_STEP);
    for (start, stop) in ground.wet_runs(&points) {
        if start >= end {
            break;
        }
        if stop - start > bridge_span(size) || stop >= end {
            end = start;
            break;
        }
        bridges.push((start, stop));
    }
    points = resample(&cut(&points, end), VERTEX_STEP);
    if line_length(&points) < VERTEX_STEP {
        return None;
    }
    let mut street = Street::new(points, Class::Main, size);
    street.destination.clone_from(&arm.destination);
    street.bridges = bridges;
    Some(street)
}
/// Whether ground stops a lane branching from street `parent`: what stops any lane, and any
/// other street, so branches end in T-junctions.
pub fn stops_branch(parent: u32) -> impl Fn(u32) -> bool {
    move |owner| stops_lane(owner) || (owner >= FIRST_STREET && owner != parent)
}
/// A lane along `points` until ground `stops` it; shorter than `least` metres, it is not laid.
pub fn lane(
    points: &[Point],
    class: Class,
    size: Size,
    ground: &Ground,
    stops: impl Fn(u32) -> bool,
    least: f64,
) -> Option<Street> {
    let reach = ground.reach(points, stops);
    let points = resample(
        &cut(points, (reach - class.width(size)).max(0.0)),
        VERTEX_STEP,
    );
    (line_length(&points) >= least).then(|| Street::new(points, class, size))
}
/// Where a line first meets a closed ring, as a point.
pub fn meets(line: &[Point], ring: &[Point]) -> Vec<Point> {
    let mut found = Vec::new();
    for a in line.windows(2) {
        for b in ring.windows(2) {
            if let Some(t) = super::geometry::crossing(a[0], a[1], b[0], b[1]) {
                found.push([
                    a[0][0] + (a[1][0] - a[0][0]) * t,
                    a[0][1] + (a[1][1] - a[0][1]) * t,
                ]);
            }
        }
    }
    found
}
/// The point `along` metres down a street, if the street is that long.
pub fn point_on(street: &Street, along: f64) -> Option<(Point, Point)> {
    (along <= street.length())
        .then(|| at(&street.points, along))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::town::ground::WATER;
    fn river(ground: &mut Ground, from: f64, to: f64) {
        for i in 0..ground.count() {
            if (from..to).contains(&ground.centre(i)[0]) {
                ground.withhold(i, WATER);
            }
        }
    }
    fn arm() -> Arm {
        Arm {
            points: vec![[0.0, 50.0], [300.0, 50.0]],
            destination: Some("Elder Ford".into()),
        }
    }
    #[test]
    fn main_streets_bridge_narrow_water_and_end_at_wide_water() {
        let mut ground = Ground::new([0.0, 0.0, 300.0, 100.0], 1.0);
        river(&mut ground, 100.0, 120.0);
        let street = main_street(&arm(), 250.0, Size::Town, &ground).unwrap();
        assert_eq!(street.bridges.len(), 1);
        assert!((street.length() - 250.0).abs() < 1.0);
        assert_eq!(street.destination.as_deref(), Some("Elder Ford"));
        assert!(street
            .points
            .windows(2)
            .all(|p| distance(p[0], p[1]) <= VERTEX_STEP + 1e-6));
        assert_eq!(street.widths.len(), street.points.len());
        let hamlet = main_street(&arm(), 250.0, Size::Hamlet, &ground).unwrap();
        assert!(hamlet.bridges.is_empty());
        assert!(hamlet.length() <= 100.0);
    }
    #[test]
    fn lanes_stop_at_other_streets_and_gates_pinch_widths() {
        let mut ground = Ground::new([0.0, 0.0, 100.0, 100.0], 1.0);
        ground.take_line(&[[0.0, 80.0], [100.0, 80.0]], 6.0, FIRST_STREET + 1);
        let lane = lane(
            &[[50.0, 0.0], [50.0, 100.0]],
            Class::Lane,
            Size::Village,
            &ground,
            stops_branch(FIRST_STREET),
            10.0,
        )
        .unwrap();
        assert!(lane.length() < 80.0 && lane.length() > 70.0);
        let mut street = Street::new(
            vec![[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]],
            Class::Main,
            Size::Town,
        );
        street.pinch(&[[10.0, 1.0]], 2.0, 3.5);
        assert_eq!(street.widths, vec![8.0, 3.5, 8.0]);
        let gates = meets(
            &[[0.0, 0.0], [10.0, 0.0]],
            &[[5.0, -1.0], [5.0, 1.0], [6.0, 1.0], [5.0, -1.0]],
        );
        assert_eq!(gates.len(), 2);
    }
}
