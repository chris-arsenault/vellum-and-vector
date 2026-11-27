//! A settlement's street network: main streets carry the ways that enter it, lanes fill
//! between them, and a main street bridges narrow water and ends at wide water.
use super::{
    geometry::{at, cut, distance, line_length, offset, resample, Point},
    ground::{Ground, OUTSIDE, SQUARE, STEEP, WALL, WATER},
    scale::{Measure, TownScale},
    story::Size,
};

/// Street classes and their widths, shared with the town tools.
pub use atlas_map::town::StreetClass as Class;

/// A proposed corridor, evaluated alongside other demands for street investment.
pub struct StreetProposal {
    pub demand: &'static str,
    pub points: Vec<Point>,
    /// A shortcut earns its benefit only when both existing junctions connect.
    pub joins_junctions: bool,
    pub benefit: f64,
    pub class: Class,
}
/// A way entering the settlement, from its centre outward, and the place it leads to.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Arm {
    pub points: Vec<Point>,
    pub destination: Option<String>,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Street {
    /// Runs from the end nearest the settlement's centre, where numbering starts.
    pub points: Vec<Point>,
    pub widths: Vec<f64>,
    pub class: Class,
    pub destination: Option<String>,
    /// The built street connects to its approach or continues beyond the map.
    pub through_route: bool,
    /// Stretches over water, as metres along the street.
    pub bridges: Vec<(f64, f64)>,
}
impl Street {
    /// A way of `class` along `points` at street fidelity; town processes lay theirs with
    /// `new_at`, at their town's scale.
    pub fn new(points: Vec<Point>, class: Class, size: Size) -> Self {
        Self::new_at(points, class, size, TownScale::default())
    }
    /// A way of `class` along `points`, as wide as its class is in a place of `size` at
    /// `scale`.
    pub fn new_at(points: Vec<Point>, class: Class, size: Size, scale: TownScale) -> Self {
        let widths = vec![scale.street_width(class, size); points.len()];
        Self {
            points,
            widths,
            class,
            destination: None,
            through_route: false,
            bridges: Vec::new(),
        }
    }
    pub fn width(&self) -> f64 {
        self.widths.iter().copied().fold(0.0, f64::max)
    }
    pub fn width_at(&self, mut along: f64) -> f64 {
        for (leg, widths) in self.points.windows(2).zip(self.widths.windows(2)) {
            let span = distance(leg[0], leg[1]);
            if along <= span && span > 0. {
                return widths[0] + (widths[1] - widths[0]) * (along / span).clamp(0., 1.);
            }
            along -= span;
        }
        self.widths.last().copied().unwrap_or(0.)
    }
    pub fn corridor(
        &self,
        verge: f64,
        spatial: &dyn crate::spatial::SpatialKernel,
    ) -> Result<Option<atlas_map::Geometry>, String> {
        let Some(&width) = self.widths.first() else {
            return Ok(None);
        };
        if self.widths.iter().all(|w| *w == width) {
            return spatial.buffer(&super::edits::line(&self.points), width / 2. + verge);
        }
        let line: Vec<_> = self
            .points
            .iter()
            .map(|[x, y]| atlas_map::Position::xy(*x, *y))
            .collect();
        let widths = self
            .widths
            .iter()
            .map(|w| w + 2. * verge)
            .collect::<Vec<_>>();
        atlas_map::hexes::width_outline(&line, &widths, spatial)
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
pub use super::settings::VERTEX_STEP;
/// The vertex spacing of generated streets at `scale`.
pub fn vertex_step(scale: TownScale) -> f64 {
    scale.length(VERTEX_STEP, Measure::Layout)
}
/// The longest water a way of a place of `size` bridges at `scale`: a wider way bridges wider
/// water, so the span scales as the way's width does.
pub fn bridge_span(size: Size, scale: TownScale) -> f64 {
    scale.length(atlas_map::town::bridge_span(size), Measure::Width)
}
/// Whether ground stops a lane: water, steep ground, the map's edge, a square or a wall.
pub fn stops_lane(owner: u32) -> bool {
    matches!(owner, WATER | STEEP | OUTSIDE | SQUARE | WALL)
}
/// A main street along an arm, as far as `reach` from the centre, bridging water it can span
/// and ending before water it cannot.
pub fn main_street(
    arm: &Arm,
    reach: f64,
    size: Size,
    ground: &Ground,
    scale: TownScale,
) -> Option<Street> {
    let step = vertex_step(scale);
    let mut points = resample(&cut(&arm.points, reach), step);
    let edge = ground.reach(&points, |owner| matches!(owner, OUTSIDE | STEEP | WALL));
    let mut through_route = at(&points, edge).is_some_and(|(p, _)| ground.owner(p) != STEEP);
    let mut bridges = Vec::new();
    let mut end = edge;
    for (start, stop) in ground.wet_runs(&points) {
        if start >= end {
            break;
        }
        if stop - start > bridge_span(size, scale) || stop >= end {
            end = start;
            through_route = false;
            break;
        }
        bridges.push((start, stop));
    }
    points = resample(&cut(&points, end), step);
    if line_length(&points) < step {
        return None;
    }
    let mut street = Street::new_at(points, Class::Main, size, scale);
    street.destination.clone_from(&arm.destination);
    street.through_route = through_route;
    street.bridges = bridges;
    Some(street)
}
/// How a way is laid: its class, in a place of a size, at a town's scale.
#[derive(Clone, Copy, Debug)]
pub struct StreetForm {
    pub class: Class,
    pub size: Size,
    pub scale: TownScale,
}
impl StreetForm {
    /// The way's full width.
    pub fn width(self) -> f64 {
        self.scale.street_width(self.class, self.size)
    }
}
/// A lane along `points` until ground `stops` its line or either of its edges; shorter than
/// `least` metres, it is not laid.
pub fn lane(
    points: &[Point],
    form: StreetForm,
    ground: &Ground,
    stops: impl Fn(u32) -> bool,
    least: f64,
) -> Option<Street> {
    let StreetForm { class, size, scale } = form;
    // The lane's line and both its edges must stay clear, so it never clips a plot's corner.
    let width = form.width();
    let edge = width / 2.0;
    let reach = [0.0, edge, -edge]
        .into_iter()
        .map(|by| {
            let line = if by == 0.0 {
                points.to_vec()
            } else {
                offset(points, by)
            };
            let reach = ground.reach(&line, &stops);
            if reach >= line_length(&line) {
                line_length(points)
            } else {
                reach
            }
        })
        .fold(f64::INFINITY, f64::min);
    let end = if reach < line_length(points) {
        (reach - width).max(0.0)
    } else {
        reach
    };
    let points = resample(&cut(points, end), vertex_step(scale));
    (line_length(&points) >= least).then(|| Street::new_at(points, class, size, scale))
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
        let scale = TownScale::default();
        let street = main_street(&arm(), 250.0, Size::Town, &ground, scale).unwrap();
        assert_eq!(street.bridges.len(), 1);
        assert!((street.length() - 250.0).abs() < 1.0);
        assert_eq!(street.destination.as_deref(), Some("Elder Ford"));
        assert!(street.through_route);
        assert!(street
            .points
            .windows(2)
            .all(|p| distance(p[0], p[1]) <= VERTEX_STEP + 1e-6));
        assert_eq!(street.widths.len(), street.points.len());
        let hamlet = main_street(&arm(), 250.0, Size::Hamlet, &ground, scale).unwrap();
        assert!(hamlet.bridges.is_empty());
        assert!(hamlet.length() <= 100.0);
        assert!(!hamlet.through_route);
    }
    #[test]
    fn gates_pinch_widths_where_the_street_meets_the_wall() {
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
