//! A walk that holds a heading and wanders.
use super::{best, Chance};
use std::io;

/// A walker: where it stands and the way it faces, in radians.
#[derive(Clone, Copy, Debug)]
pub struct Walker {
    pub point: [f64; 2],
    pub heading: f64,
}

/// How a walker steps.
#[derive(Clone, Copy, Debug)]
pub struct Stride<'a> {
    /// The turns a step may take off the heading, in radians.
    pub fan: &'a [f64],
    /// How much chance counts in choosing a turn. Holding the heading counts one, and
    /// the ground counts whatever the rule says it is worth.
    pub whim: f64,
    /// How far the heading may drift after each step, in radians either way.
    pub drift: f64,
    /// The distance over which a walker's chance holds before it is drawn afresh. Over
    /// less than a span a walk keeps its bias; over many spans it wanders.
    pub span: f64,
}

/// The chance a walk draws on: one purpose for which way a step turns and one for how
/// the heading drifts.
#[derive(Clone, Copy, Debug)]
pub struct Whims {
    pub turn: Chance,
    pub drift: Chance,
}

impl Walker {
    /// Takes one step of length `reach`. The walker weighs each turn of its fan by how
    /// nearly it holds the heading, by what the ground there is worth to it, and by
    /// chance; it goes the best way, the first of the fan among equals, and its heading
    /// then drifts a little. `walker` numbers it among its fellows and `travelled` is
    /// how far it has come. `worth` is nothing where the walker cannot go. The step is
    /// not taken, and the walker stays, where it can go nowhere.
    ///
    /// Fractures grow this way: the ground is worth more where no fault runs yet and
    /// where the crust is strained, so a fault runs on, seeks strain and avoids its
    /// fellows, and no two take the same course.
    pub fn step(
        &mut self,
        stride: &Stride<'_>,
        whims: Whims,
        [walker, travelled]: [f64; 2],
        reach: f64,
        mut worth: impl FnMut([f64; 2]) -> io::Result<Option<f64>>,
    ) -> io::Result<bool> {
        let spans = (travelled / stride.span).floor();
        let mut ways = Vec::with_capacity(stride.fan.len());
        for &turn in stride.fan {
            let heading = self.heading + turn;
            let point = [
                self.point[0] + heading.cos() * reach,
                self.point[1] + heading.sin() * reach,
            ];
            let Some(ground) = worth(point)? else {
                continue;
            };
            // Chance holds over a span of the walk and a span of the ground, so a walker
            // is drawn one way for a while and another walker there is drawn otherwise.
            let patch = ((point[0] / stride.span).floor() as i32)
                ^ ((point[1] / stride.span).floor() as i32);
            let whim = whims.turn.signed([walker + spans, f64::from(patch)]) * stride.whim;
            ways.push((turn.cos() + ground + whim, point, heading));
        }
        let Some((_, point, heading)) = best(ways, |way| way.0) else {
            return Ok(false);
        };
        self.point = point;
        self.heading = heading + whims.drift.signed([walker, spans]) * stride.drift;
        Ok(true)
    }
    /// Walks up to `steps` steps of `reach` and returns the course: where the walker
    /// began and where each step left it. The walk ends early where the walker can go
    /// nowhere. `worth` is asked afresh at every step, so a walker that marks the ground
    /// it crosses can be kept off its own course, or drawn along another's.
    pub fn walk(
        &mut self,
        stride: &Stride<'_>,
        whims: Whims,
        walker: f64,
        [steps, reach]: [f64; 2],
        mut worth: impl FnMut([f64; 2]) -> io::Result<Option<f64>>,
    ) -> io::Result<Vec<[f64; 2]>> {
        let mut course = vec![self.point];
        let mut travelled = 0.0;
        while (course.len() as f64) <= steps {
            if !self.step(stride, whims, [walker, travelled], reach, &mut worth)? {
                break;
            }
            course.push(self.point);
            travelled += reach;
        }
        Ok(course)
    }
    /// A second walker setting out from where this one stands, turned `turn` off its
    /// heading: a branch of a fault, a side street, a tributary track.
    pub fn fork(&self, turn: f64) -> Self {
        Self {
            point: self.point,
            heading: self.heading + turn,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAN: [f64; 5] = [-0.65, -0.325, 0.0, 0.325, 0.65];
    const WHIMS: Whims = Whims {
        turn: Chance::of(21, 0x6c53),
        drift: Chance::of(21, 0x5ac1),
    };
    fn stride(whim: f64, drift: f64) -> Stride<'static> {
        Stride {
            fan: &FAN,
            whim,
            drift,
            span: 40.,
        }
    }
    /// The course of walker `number` over `steps` steps of ten, eastward from the
    /// origin, on ground worth `worth`.
    fn course(
        number: usize,
        steps: usize,
        stride: &Stride<'_>,
        worth: impl Fn([f64; 2]) -> Option<f64>,
    ) -> Vec<[f64; 2]> {
        let mut walker = Walker {
            point: [0., 0.],
            heading: 0.,
        };
        let mut course = vec![walker.point];
        for step in 0..steps {
            let went = walker
                .step(
                    stride,
                    WHIMS,
                    [number as f64, step as f64 * 10.],
                    10.,
                    |p| Ok(worth(p)),
                )
                .unwrap();
            if !went {
                break;
            }
            course.push(walker.point);
        }
        course
    }
    fn last(course: &[[f64; 2]]) -> [f64; 2] {
        *course.last().unwrap()
    }

    #[test]
    fn with_no_chance_and_level_ground_a_walker_holds_its_heading() {
        let end = last(&course(0, 50, &stride(0., 0.), |_| Some(0.)));
        assert!(
            (end[0] - 500.).abs() < 1e-6 && end[1].abs() < 1e-6,
            "{end:?}"
        );
    }

    #[test]
    fn chance_makes_a_walk_wander_and_no_two_walkers_take_one_course() {
        // Fifty steps of ten on level ground: each walker ends well short of a straight
        // five hundred from where it began, and the walkers end far apart.
        let ends: Vec<_> = (0..40)
            .map(|number| last(&course(number, 50, &stride(0.12, 0.22), |_| Some(0.))))
            .collect();
        let from_start = |[x, y]: [f64; 2]| x.hypot(y);
        let short = ends.iter().filter(|end| from_start(**end) < 480.).count();
        assert!(short >= 30, "{short}");
        let mut apart = 0;
        for a in 0..ends.len() {
            for b in a + 1..ends.len() {
                apart += usize::from(
                    from_start([ends[a][0] - ends[b][0], ends[a][1] - ends[b][1]]) > 50.,
                );
            }
        }
        assert!(apart > 700, "{apart} of 780 pairs");
        // A walk is jagged over short distances and jagged again over long ones: its
        // turns do not average out to a line.
        let walk = course(3, 200, &stride(0.12, 0.22), |_| Some(0.));
        let net = from_start(last(&walk));
        assert!(net < 0.9 * 2_000., "{net}");
    }

    #[test]
    fn the_ground_draws_a_walk_toward_what_it_is_worth() {
        // Ground worth more to the north, by about as much from one turn of the fan to
        // the next as holding the heading is worth: walkers that begin eastward bend
        // north.
        let north = |[_, y]: [f64; 2]| Some(0.03 * y);
        let northward = (0..40)
            .filter(|number| last(&course(*number, 60, &stride(0.12, 0.22), north))[1] > 100.)
            .count();
        assert!(northward >= 36, "{northward}");
        let level = (0..40)
            .filter(|number| {
                last(&course(*number, 60, &stride(0.12, 0.22), |_| Some(0.)))[1] > 100.
            })
            .count();
        assert!(level < 24, "{level}");
    }

    #[test]
    fn a_walk_gives_its_course_and_a_fork_sets_out_another_way() {
        let from = Walker {
            point: [0., 0.],
            heading: 0.,
        };
        let walk = |mut walker: Walker, number: f64| {
            walker
                .walk(&stride(0.12, 0.22), WHIMS, number, [30., 10.], |_| {
                    Ok(Some(0.))
                })
                .unwrap()
        };
        let course = walk(from, 0.);
        // Where it began and thirty steps of ten.
        assert_eq!(course.len(), 31);
        assert_eq!(course[0], [0., 0.]);
        assert!(course.windows(2).all(|pair| {
            ((pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]) - 10.).abs() < 1e-9
        }));
        // A fork leaves from the same place a quarter turn off and ends far away.
        let fork = from.fork(std::f64::consts::FRAC_PI_2);
        assert_eq!(fork.point, from.point);
        let side = walk(fork, 1.);
        let apart = (last(&side)[0] - last(&course)[0]).hypot(last(&side)[1] - last(&course)[1]);
        assert!(apart > 150., "{apart}");
        // A walk ends where the walker is shut in.
        let mut shut = from;
        let short = shut
            .walk(&stride(0.12, 0.22), WHIMS, 0., [30., 10.], |[x, _]| {
                Ok((x < 55.).then_some(0.))
            })
            .unwrap();
        assert!(short.len() < 31 && short.iter().all(|[x, _]| *x < 55.));
    }

    #[test]
    fn a_walker_never_enters_ground_it_cannot_cross_and_stops_where_it_is_shut_in() {
        // A wall across the way at x = 200 with nothing beyond.
        let open = |[x, _]: [f64; 2]| (x < 200.).then_some(0.);
        for number in 0..20 {
            let walk = course(number, 80, &stride(0.12, 0.22), open);
            assert!(walk.iter().all(|[x, _]| *x < 200.));
        }
        // Nowhere to go: the walker stays.
        let shut = course(0, 10, &stride(0.12, 0.22), |_| None);
        assert_eq!(shut.len(), 1);
    }
}
