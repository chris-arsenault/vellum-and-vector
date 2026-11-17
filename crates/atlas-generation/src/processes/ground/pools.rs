//! Pools along a channel. Water deepens where it slackens on a stretch much gentler than its
//! reach, where two streams meet and scour the bed, and on the outside of a tight bend where
//! the flow is thrown against the bank. Pools and riffles alternate, so pools keep apart.
use super::{
    distance,
    settings::{
        BEND_OFFSET, BEND_WINDOW, GRADIENT_WINDOW, JUNCTION_REACH, POOL_BREADTH, POOL_DEEPENING,
        POOL_LENGTH, POOL_SIDES, POOL_SPACING, REACH_WINDOW, SLACK_SHARE, TIGHT_BEND,
    },
    stations,
};

/// One channel as drawn, from its source downstream, in the map's metres.
pub struct Course<'a> {
    pub points: &'a [[f64; 2]],
    /// Bed elevation at each vertex, metres.
    pub beds: &'a [f64],
    pub widths: &'a [f64],
    pub depths: &'a [f64],
    /// Where tributaries join it.
    pub junctions: &'a [[f64; 2]],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Cause {
    /// The flow slackens on a stretch much gentler than its reach.
    Slack,
    /// The flow scours the outside of a tight bend.
    Bend,
    /// Two streams meet and scour the bed.
    Confluence,
}
impl Cause {
    pub fn id(self) -> &'static str {
        match self {
            Self::Slack => "slack",
            Self::Bend => "bend",
            Self::Confluence => "confluence",
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Pool {
    pub cause: Cause,
    pub centre: [f64; 2],
    /// Unit direction of the flow through the pool.
    pub bearing: [f64; 2],
    pub length: f64,
    pub breadth: f64,
    pub depth: f64,
    /// The channel vertex the pool sits at.
    pub vertex: usize,
}
struct Candidate {
    cause: Cause,
    score: f64,
    vertex: usize,
    outside: Option<[f64; 2]>,
}
/// The vertex at least `reach` metres back along the line, or the source.
fn back(along: &[f64], at: usize, reach: f64) -> usize {
    (0..at)
        .rev()
        .find(|&j| along[at] - along[j] >= reach)
        .unwrap_or(0)
}
/// The vertex at least `reach` metres ahead along the line, or the end.
fn ahead(along: &[f64], at: usize, reach: f64) -> usize {
    (at + 1..along.len())
        .find(|&k| along[k] - along[at] >= reach)
        .unwrap_or(along.len() - 1)
}
/// Fall per metre between two vertices, downstream positive.
fn fall(course: &Course<'_>, along: &[f64], j: usize, k: usize) -> Option<f64> {
    let run = along[k] - along[j];
    (k > j && run > 0.0).then(|| (course.beds[j] - course.beds[k]) / run)
}
fn unit(v: [f64; 2]) -> [f64; 2] {
    let length = v[0].hypot(v[1]);
    if length > 0.0 {
        [v[0] / length, v[1] / length]
    } else {
        [1.0, 0.0]
    }
}
fn bearing(points: &[[f64; 2]], j: usize, k: usize) -> [f64; 2] {
    unit([points[k][0] - points[j][0], points[k][1] - points[j][1]])
}
/// A stretch whose own gradient falls well below its reach's mean.
fn slack(course: &Course<'_>, along: &[f64], at: usize) -> Option<Candidate> {
    let width = course.widths[at];
    let window = |share: f64| {
        let reach = share * width / 2.0;
        let j = back(along, at, reach).min(at.saturating_sub(1));
        let k = ahead(along, at, reach).max((at + 1).min(along.len() - 1));
        fall(course, along, j, k)
    };
    let (local, reach) = (window(GRADIENT_WINDOW)?, window(REACH_WINDOW)?);
    (reach > 0.0 && local < SLACK_SHARE * reach).then(|| Candidate {
        cause: Cause::Slack,
        score: 1.0 - local / reach,
        vertex: at,
        outside: None,
    })
}
/// A bend tighter than the declared radius, with the direction of its outside bank.
fn bend(course: &Course<'_>, along: &[f64], at: usize) -> Option<Candidate> {
    let width = course.widths[at];
    let (j, k) = (
        back(along, at, BEND_WINDOW * width),
        ahead(along, at, BEND_WINDOW * width),
    );
    if j >= at || k <= at {
        return None;
    }
    let [a, b, c] = [course.points[j], course.points[at], course.points[k]];
    let turn = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if turn == 0.0 {
        return None;
    }
    let radius = distance(a, b) * distance(b, c) * distance(a, c) / (2.0 * turn.abs());
    if radius >= TIGHT_BEND * width {
        return None;
    }
    let [x, y] = bearing(course.points, j, k);
    // The bend's centre lies on the inside, toward which the line turns; the outside is opposite.
    let outside = if turn > 0.0 { [y, -x] } else { [-y, x] };
    Some(Candidate {
        cause: Cause::Bend,
        score: TIGHT_BEND * width / radius,
        vertex: at,
        outside: Some(outside),
    })
}
/// How far a point lies from the line, and the vertex nearest where it comes closest.
fn nearest_on(points: &[[f64; 2]], p: [f64; 2]) -> Option<(f64, usize)> {
    points
        .windows(2)
        .enumerate()
        .map(|(i, pair)| {
            let [a, b] = [pair[0], pair[1]];
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let run = dx * dx + dy * dy;
            let t = if run > 0.0 {
                (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / run).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let off = distance(p, [a[0] + t * dx, a[1] + t * dy]);
            (off, if t < 0.5 { i } else { i + 1 })
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
}
fn confluences(course: &Course<'_>) -> Vec<Candidate> {
    course
        .junctions
        .iter()
        .filter_map(|&junction| {
            let (off, vertex) = nearest_on(course.points, junction)?;
            // A junction farther off than this lies on another piece of the river.
            (off <= JUNCTION_REACH * course.widths[vertex]).then_some(Candidate {
                cause: Cause::Confluence,
                score: 1.0,
                vertex,
                outside: None,
            })
        })
        .collect()
}
fn pool(course: &Course<'_>, along: &[f64], candidate: &Candidate) -> Pool {
    let at = candidate.vertex;
    let width = course.widths[at];
    let (j, k) = (
        back(along, at, width).min(at.saturating_sub(1)),
        ahead(along, at, width).max((at + 1).min(along.len() - 1)),
    );
    let [x, y] = course.points[at];
    let [ox, oy] = candidate.outside.map_or([0.0, 0.0], |[ox, oy]| {
        [ox * BEND_OFFSET * width, oy * BEND_OFFSET * width]
    });
    Pool {
        cause: candidate.cause,
        centre: [x + ox, y + oy],
        bearing: bearing(course.points, j, k),
        length: POOL_LENGTH * width,
        breadth: POOL_BREADTH * width,
        depth: POOL_DEEPENING * course.depths[at],
        vertex: at,
    }
}
/// The pools along one channel: confluences first, then tight bends, then slack stretches,
/// each kept only where no stronger pool already stands within the pool spacing.
pub fn pools(course: &Course<'_>) -> Vec<Pool> {
    let n = course.points.len();
    if n < 3 || course.beds.len() != n || course.widths.len() != n || course.depths.len() != n {
        return Vec::new();
    }
    let along = stations(course.points);
    let mut candidates = confluences(course);
    for at in 1..n - 1 {
        if course.widths[at] <= 0.0 {
            continue;
        }
        candidates.extend(bend(course, &along, at));
        candidates.extend(slack(course, &along, at));
    }
    // hpc-exempt: ranking a channel's few pool candidates, not a cell ordering.
    candidates.sort_by(|a, b| {
        b.cause
            .cmp(&a.cause)
            .then(b.score.total_cmp(&a.score))
            .then(a.vertex.cmp(&b.vertex))
    });
    let mut kept: Vec<Pool> = Vec::new();
    for candidate in &candidates {
        let at = candidate.vertex;
        let apart = POOL_SPACING * course.widths[at];
        if course.widths[at] > 0.0
            && kept
                .iter()
                .all(|p| (along[p.vertex] - along[at]).abs() >= apart)
        {
            kept.push(pool(course, &along, candidate));
        }
    }
    // hpc-exempt: a channel's few pools in downstream order.
    kept.sort_by_key(|p| p.vertex);
    kept
}
/// A pool's outline: an ellipse along the flow, closed.
pub fn outline(pool: &Pool) -> Vec<[f64; 2]> {
    let [bx, by] = pool.bearing;
    let [cx, cy] = pool.centre;
    let mut ring: Vec<[f64; 2]> = (0..POOL_SIDES)
        .map(|i| {
            let angle = i as f64 * std::f64::consts::TAU / POOL_SIDES as f64;
            let (along, across) = (
                pool.length / 2.0 * angle.cos(),
                pool.breadth / 2.0 * angle.sin(),
            );
            [cx + along * bx - across * by, cy + along * by + across * bx]
        })
        .collect();
    ring.push(ring[0]);
    ring
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Line {
        points: Vec<[f64; 2]>,
        beds: Vec<f64>,
        widths: Vec<f64>,
        depths: Vec<f64>,
    }
    impl Line {
        fn new(points: Vec<[f64; 2]>, bed: impl Fn(f64) -> f64) -> Self {
            let along = stations(&points);
            let n = points.len();
            Self {
                beds: along.iter().map(|&s| bed(s)).collect(),
                points,
                widths: vec![4.0; n],
                depths: vec![0.5; n],
            }
        }
        fn pools(&self, junctions: &[[f64; 2]]) -> Vec<Pool> {
            pools(&Course {
                points: &self.points,
                beds: &self.beds,
                widths: &self.widths,
                depths: &self.depths,
                junctions,
            })
        }
    }
    fn straight() -> Vec<[f64; 2]> {
        (0..=500).map(|i| [f64::from(i) * 2.0, 0.0]).collect()
    }
    #[test]
    fn an_even_channel_holds_no_pools() {
        let line = Line::new(straight(), |s| 100.0 - 0.01 * s);
        assert!(line.pools(&[]).is_empty());
    }
    #[test]
    fn a_flat_stretch_in_a_falling_reach_holds_slack_water() {
        let line = Line::new(straight(), |s| {
            if s < 400.0 {
                100.0 - 0.01 * s
            } else if s < 440.0 {
                96.0
            } else {
                96.0 - 0.01 * (s - 440.0)
            }
        });
        let found = line.pools(&[]);
        assert!(!found.is_empty());
        assert!(found.iter().all(|p| p.cause == Cause::Slack));
        assert!(found.iter().all(|p| (390.0..=450.0).contains(&p.centre[0])));
        // A pool is two and a half channel widths long and one and a half across.
        assert!((found[0].length - 10.0).abs() < 1e-9 && (found[0].breadth - 6.0).abs() < 1e-9);
        assert!((found[0].depth - 1.0).abs() < 1e-9);
    }
    #[test]
    fn a_tight_bend_scours_a_pool_on_its_outside() {
        // A straight run, a half circle of radius 8 m (two widths) turning left, and back.
        let mut points: Vec<[f64; 2]> = (0..50).map(|i| [f64::from(i) * 2.0, 0.0]).collect();
        let centre = [98.0, 8.0];
        for step in 1..=24 {
            let angle =
                -std::f64::consts::FRAC_PI_2 + f64::from(step) * std::f64::consts::PI / 24.0;
            points.push([centre[0] + 8.0 * angle.cos(), centre[1] + 8.0 * angle.sin()]);
        }
        for i in 1..50 {
            points.push([98.0 - f64::from(i) * 2.0, 16.0]);
        }
        let line = Line::new(points, |s| 100.0 - 0.01 * s);
        let bends: Vec<_> = line
            .pools(&[])
            .into_iter()
            .filter(|p| p.cause == Cause::Bend)
            .collect();
        assert!(!bends.is_empty());
        for pool in &bends {
            assert!(distance(pool.centre, centre) > 8.0);
        }
    }
    #[test]
    fn streams_meeting_scour_a_pool_and_pools_keep_apart() {
        let line = Line::new(straight(), |s| 100.0 - 0.01 * s);
        let found = line.pools(&[[500.0, 3.0], [510.0, -2.0]]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].cause, Cause::Confluence);
        assert!((found[0].centre[0] - 500.0).abs() <= 2.0);
    }
    #[test]
    fn a_junction_on_another_piece_of_the_river_makes_no_pool_here() {
        let line = Line::new(straight(), |s| 100.0 - 0.01 * s);
        assert!(line.pools(&[[500.0, 50.0], [2_000.0, 0.0]]).is_empty());
    }
    #[test]
    fn an_outline_runs_along_the_flow() {
        let pool = Pool {
            cause: Cause::Slack,
            centre: [0.0, 0.0],
            bearing: [0.0, 1.0],
            length: 10.0,
            breadth: 6.0,
            depth: 1.0,
            vertex: 0,
        };
        let ring = outline(&pool);
        assert_eq!(ring.first(), ring.last());
        let reach_y = ring.iter().map(|p| p[1].abs()).fold(0.0, f64::max);
        let reach_x = ring.iter().map(|p| p[0].abs()).fold(0.0, f64::max);
        assert!((reach_y - 5.0).abs() < 1e-9 && (reach_x - 3.0).abs() < 0.01);
    }
}
