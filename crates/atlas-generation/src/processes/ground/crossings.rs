//! Where ways meet water. A way crossing a channel shallow enough to wade fords it; a road or
//! street crossing deeper water is carried on a bridge; a crossing beside an existing bridge or
//! ford uses that one.
use super::{
    channels::depth,
    distance,
    settings::{CROSSING_REACH, CROSSING_REACH_WIDTHS, FORD_DEPTH},
};
use crate::field::poi::true_sizes::{ABUTMENT_SHARE, LEAST_CROSSING};

/// A way as drawn, with its width at each vertex when it states one.
pub struct Way<'a> {
    pub points: &'a [[f64; 2]],
    pub widths: Option<&'a [f64]>,
    /// Metres along the line supported by bridge works. Captured regional roads can
    /// realize a crossing anywhere; paths without a deck have an empty slice.
    pub bridge_spans: Option<&'a [(f64, f64)]>,
}
/// A channel as drawn, with its width and mean discharge at each vertex.
pub struct Water<'a> {
    pub points: &'a [[f64; 2]],
    pub widths: &'a [f64],
    pub discharges: &'a [f64],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Form {
    Ford,
    Bridge,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Crossing {
    pub way: usize,
    pub water: usize,
    pub at: [f64; 2],
    /// The channel's width and mean depth where the way meets it.
    pub width: f64,
    pub depth: f64,
    pub form: Form,
    /// Unit direction of the way through the crossing and its width there.
    pub bearing: [f64; 2],
    pub way_width: Option<f64>,
}

/// Survey an alignment before movement commits it. Each wet reach needs dry banks,
/// a known channel and room for the settlement's works. Deep reaches need a deck.
pub(crate) fn survey(
    course: &mut crate::town::network::Street,
    ground: &crate::town::ground::Ground,
    span: f64,
    channel_depth: &dyn Fn([f64; 2]) -> std::io::Result<Option<f64>>,
) -> std::io::Result<bool> {
    let length = course.length();
    let reaches = ground.wet_runs(&course.points);
    if reaches.is_empty() {
        return Ok(false);
    }
    let mut bridges = Vec::new();
    for (start, end) in reaches {
        if start < ground.cell || end + ground.cell >= length || end - start > span {
            return Ok(false);
        }
        let Some((centre, _)) = crate::town::geometry::at(&course.points, (start + end) / 2.)
        else {
            return Ok(false);
        };
        let Some(depth) = channel_depth(centre)? else {
            return Ok(false);
        };
        if depth >= FORD_DEPTH {
            bridges.push((start, end));
        }
    }
    course.bridges = bridges;
    Ok(true)
}
/// Where two segments meet: the point and the fraction along each.
fn meet(a: [[f64; 2]; 2], b: [[f64; 2]; 2]) -> Option<([f64; 2], f64, f64)> {
    let r = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
    let s = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
    let cross = r[0] * s[1] - r[1] * s[0];
    if cross == 0.0 {
        return None;
    }
    let q = [b[0][0] - a[0][0], b[0][1] - a[0][1]];
    let t = (q[0] * s[1] - q[1] * s[0]) / cross;
    let u = (q[0] * r[1] - q[1] * r[0]) / cross;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u))
        .then(|| ([a[0][0] + t * r[0], a[0][1] + t * r[1]], t, u))
}
fn bounds(points: &[[f64; 2]]) -> [f64; 4] {
    points.iter().fold(
        [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ],
        |[w, s, e, n], [x, y]| [w.min(*x), s.min(*y), e.max(*x), n.max(*y)],
    )
}
fn overlaps(a: [f64; 4], b: [f64; 4]) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}
fn between(values: &[f64], at: usize, fraction: f64) -> f64 {
    values[at] * (1.0 - fraction) + values[(at + 1).min(values.len() - 1)] * fraction
}
fn unit(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    let length = distance(a, b);
    if length > 0.0 {
        [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    } else {
        [1.0, 0.0]
    }
}
/// Where a way's segment meets a channel's segment, and how far along each.
struct Meeting {
    way_segment: usize,
    water_segment: usize,
    at: [f64; 2],
    along_way: f64,
    along_water: f64,
}
/// Every point where a way meets a channel, before deciding how it crosses.
fn meetings(way: &Way<'_>, water: &Water<'_>) -> Vec<Meeting> {
    let mut found = Vec::new();
    if !overlaps(bounds(way.points), bounds(water.points)) {
        return found;
    }
    for i in 0..way.points.len().saturating_sub(1) {
        let a = [way.points[i], way.points[i + 1]];
        let box_a = bounds(&a);
        for j in 0..water.points.len().saturating_sub(1) {
            let b = [water.points[j], water.points[j + 1]];
            if !overlaps(box_a, bounds(&b)) {
                continue;
            }
            if let Some((at, t, u)) = meet(a, b) {
                found.push(Meeting {
                    way_segment: i,
                    water_segment: j,
                    at,
                    along_way: t,
                    along_water: u,
                });
            }
        }
    }
    found
}
fn decide(way: &Way<'_>, water: &Water<'_>, meeting: &Meeting) -> Option<(f64, f64, Form)> {
    let (j, u) = (meeting.water_segment, meeting.along_water);
    let width = between(water.widths, j, u);
    let discharge = between(water.discharges, j, u);
    if width <= 0. || discharge <= 0. {
        return None;
    }
    let deep = depth(discharge, width);
    let form = if deep < FORD_DEPTH {
        Form::Ford
    } else if way.bridge_spans.is_none_or(|spans| {
        let i = meeting.way_segment;
        let station = crate::town::geometry::line_length(&way.points[..=i])
            + meeting.along_way * distance(way.points[i], way.points[i + 1]);
        spans.iter().any(|&(a, b)| (a..=b).contains(&station))
    }) {
        Form::Bridge
    } else {
        return None;
    };
    Some((width, deep, form))
}
/// How every way crosses every channel it meets, skipping crossings beside an existing bridge
/// or ford (`existing`) or beside one found earlier, so ways meeting water at one place share
/// one crossing.
pub fn crossings(ways: &[Way<'_>], waters: &[Water<'_>], existing: &[[f64; 2]]) -> Vec<Crossing> {
    let mut result: Vec<Crossing> = Vec::new();
    for (w, way) in ways.iter().enumerate() {
        for (r, water) in waters.iter().enumerate() {
            if water.widths.len() != water.points.len()
                || water.discharges.len() != water.points.len()
            {
                continue;
            }
            for meeting in meetings(way, water) {
                let (i, at, t) = (meeting.way_segment, meeting.at, meeting.along_way);
                let Some((width, deep, form)) = decide(way, water, &meeting) else {
                    continue;
                };
                let reach = CROSSING_REACH + CROSSING_REACH_WIDTHS * width;
                let near = |p: [f64; 2]| distance(p, at) < reach;
                if existing
                    .iter()
                    .chain(result.iter().map(|c| &c.at))
                    .any(|&p| near(p))
                {
                    continue;
                }
                result.push(Crossing {
                    way: w,
                    water: r,
                    at,
                    width,
                    depth: deep,
                    form,
                    bearing: unit(way.points[i], way.points[i + 1]),
                    way_width: way
                        .widths
                        .filter(|v| v.len() == way.points.len())
                        .map(|v| between(v, i, t)),
                });
            }
        }
    }
    result
}
/// A bridge's span: across the channel and an abutment on each bank, along the way.
pub fn span(crossing: &Crossing) -> [[f64; 2]; 2] {
    let abutment = (crossing.width * ABUTMENT_SHARE).max(LEAST_CROSSING);
    let half = crossing.width / 2.0 + abutment;
    let [x, y] = crossing.at;
    let [bx, by] = crossing.bearing;
    [
        [x - bx * half, y - by * half],
        [x + bx * half, y + by * half],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A channel's points, widths and discharges.
    type Channel = (Vec<[f64; 2]>, Vec<f64>, Vec<f64>);
    fn river(discharge: f64, width: f64) -> Channel {
        let points: Vec<[f64; 2]> = (0..=10).map(|i| [f64::from(i) * 20.0, 0.0]).collect();
        let n = points.len();
        (points, vec![width; n], vec![discharge; n])
    }
    fn cross(
        water: &Channel,
        spans: Option<&[(f64, f64)]>,
        existing: &[[f64; 2]],
    ) -> Vec<Crossing> {
        let way = [[50.0, -30.0], [50.0, 30.0]];
        crossings(
            &[Way {
                points: &way,
                widths: Some(&[4.0, 4.0]),
                bridge_spans: spans,
            }],
            &[Water {
                points: &water.0,
                widths: &water.1,
                discharges: &water.2,
            }],
            existing,
        )
    }
    #[test]
    fn a_way_wades_shallow_water() {
        let found = cross(&river(2.0, 6.0), Some(&[]), &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].form, Form::Ford);
        assert!((found[0].at[0] - 50.0).abs() < 1e-9 && found[0].at[1].abs() < 1e-9);
        assert!(found[0].depth < FORD_DEPTH);
        assert_eq!(found[0].way_width, Some(4.0));
    }
    #[test]
    fn roads_bridge_deep_water_and_trails_do_not() {
        let deep = river(100.0, 45.0);
        let road = cross(&deep, None, &[]);
        assert_eq!(road.len(), 1);
        assert_eq!(road[0].form, Form::Bridge);
        let [a, b] = span(&road[0]);
        assert!((distance(a, b) - (45.0 + 2.0 * 4.5)).abs() < 1e-9);
        assert!(cross(&deep, Some(&[]), &[]).is_empty());
        assert!(cross(&deep, Some(&[(5., 15.)]), &[]).is_empty());
        assert_eq!(cross(&deep, Some(&[(25., 35.)]), &[]).len(), 1);
    }
    #[test]
    fn an_existing_bridge_carries_the_crossing() {
        assert!(cross(&river(2.0, 6.0), None, &[[52.0, 3.0]]).is_empty());
        assert_eq!(cross(&river(2.0, 6.0), None, &[[150.0, 0.0]]).len(), 1);
    }
    #[test]
    fn local_alignment_needs_a_known_channel_and_passable_banks() {
        use crate::town::{
            ground::{Ground, WATER},
            network::{Class, Street},
            story::Size,
        };
        let mut ground = Ground::new([0., 0., 30., 10.], 1.);
        for x in 12..17 {
            ground.withhold(ground.index([f64::from(x), 5.]).unwrap(), WATER);
        }
        let mut way = Street::new(vec![[1., 5.], [28., 5.]], Class::Lane, Size::Town);
        assert!(!survey(&mut way, &ground, 10., &|_| Ok(None)).unwrap());
        assert!(!survey(&mut way, &ground, 4., &|_| Ok(Some(1.))).unwrap());
        assert!(survey(&mut way, &ground, 10., &|_| Ok(Some(FORD_DEPTH / 2.))).unwrap());
        assert!(way.bridges.is_empty());
        assert!(survey(&mut way, &ground, 10., &|_| Ok(Some(FORD_DEPTH * 2.))).unwrap());
        assert_eq!(way.bridges.len(), 1);
    }
}
