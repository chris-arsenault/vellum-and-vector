//! A town wall grown from the pieces of this library: a pattern for writing a rule and
//! for checking it. The atlas does not run it.
//!
//! The rule is a few small steps repeated round after round, each with chance in it:
//!
//! 1. Builders set out where the town's edge stands most open ([`best`] with chance in
//!    the score), face along the edge, and walk ([`Walker`]): holding their heading, kept
//!    to the edge by what the ground is worth, drawn along wall that already stands,
//!    and wandering. They lay wall where they tread.
//! 2. Wall falls in patches that shift from round to round ([`Patches::rank_at`]),
//!    sooner where the town crowds against it and its stone is wanted.
//! 3. The next round's builders start from what is left.
//!
//! Nothing here names a kind of wall. Circuits, arcs, gaps, doubled stretches and
//! stumps are what the steps leave behind.
//!
//! The checks at the foot are the pattern for any rule: run it under many rolls and
//! measure how unlike the results are; then take the chance away and see them become
//! one. A rule whose results are alike under every roll, or unlike with chance gone,
//! fails.
use super::*;
use crate::lattice::{TriangularLattice, WorldLatticeOptions};
use atlas_map::Bounds;

/// How crowded the ground is where a town's edge lies, beside its middle.
const EDGE: f64 = 0.2;
const FAN: [f64; 5] = [-0.65, -0.325, 0.0, 0.325, 0.65];

/// A town on level ground: how crowded each cell is, lopsided as towns are.
pub(super) struct Town {
    pub mesh: TriangularLattice,
    pub crowd: Vec<f64>,
    centre: [f64; 2],
}
impl Town {
    pub(super) fn founded() -> Self {
        let mesh = WorldLatticeOptions::default()
            .build(Bounds(0., 0., 3_000., 3_000.), 7_000., 0., |_, _| true)
            .unwrap();
        let Bounds(west, south, east, north) = mesh.bounds();
        let centre = [(west + east) / 2., (south + north) / 2.];
        let lumps = Chance::named(1, "example.town.lumps").noise(900., 3);
        let crowd = (0..mesh.len())
            .map(|cell| {
                let [x, y] = mesh.position(cell);
                let from_middle = (x - centre[0]).hypot(y - centre[1]);
                (-from_middle / 450.).exp() * (1. + 0.8 * lumps.signed([x, y])).max(0.1)
            })
            .collect();
        Self {
            mesh,
            crowd,
            centre,
        }
    }
    fn cell(&self, [x, y]: [f64; 2]) -> Option<usize> {
        self.mesh.cell_at(x, y)
    }
    /// How far the ground at a cell is from being the town's edge: nought on it.
    fn off_edge(&self, cell: usize) -> f64 {
        (self.crowd[cell] - EDGE) / EDGE
    }
    fn on_edge(&self, cell: usize) -> bool {
        self.off_edge(cell).abs() < 0.15
    }
}

/// How a wall is raised and worn. `wildness` scales every draw's part in the rule: at
/// one chance plays its full part, at nought it plays none.
#[derive(Clone, Copy)]
pub(super) struct Raising {
    pub roll: i32,
    pub wildness: f64,
    pub wear: f64,
}
impl Raising {
    fn chance(&self, purpose: &str) -> Chance {
        Chance::named(self.roll, purpose)
    }
    /// Where a builder sets out: on the town's edge where least wall stands, with
    /// chance in the choosing.
    fn start(&self, town: &Town, wall: &[f64], builder: i32) -> Option<usize> {
        let chance = self.chance("example.wall.start").nth(builder);
        best(
            (0..town.mesh.len()).filter(|&cell| town.on_edge(cell)),
            |&cell| (1. - wall[cell]) + self.wildness * chance.signed(town.mesh.position(cell)),
        )
    }
    /// One builder's walk along the edge, laying wall where it treads.
    fn build(&self, town: &Town, wall: &mut [f64], builder: i32) {
        let Some(start) = self.start(town, wall, builder) else {
            return;
        };
        let point = town.mesh.position(start);
        let outward = (point[1] - town.centre[1]).atan2(point[0] - town.centre[0]);
        let sunwise = self.wildness > 0.
            && self
                .chance("example.wall.way")
                .happens([f64::from(builder), 0.], 0.5);
        let quarter = std::f64::consts::FRAC_PI_2;
        let mut walker = Walker {
            point,
            heading: outward + if sunwise { -quarter } else { quarter },
        };
        let stride = Stride {
            fan: &FAN,
            whim: 0.12 * self.wildness,
            drift: 0.22 * self.wildness,
            span: 150.,
        };
        let whims = Whims {
            turn: self.chance("example.wall.turn"),
            drift: self.chance("example.wall.drift"),
        };
        let reach = town.mesh.spacing();
        // The ground is worth most on the town's edge, and more where wall stands.
        let course = walker
            .walk(&stride, whims, f64::from(builder), [70., reach], |at| {
                Ok(town
                    .cell(at)
                    .map(|cell| 0.3 * wall[cell] - 8. * town.off_edge(cell).powi(2).min(4.)))
            })
            .unwrap();
        for cell in course.into_iter().filter_map(|at| town.cell(at)) {
            wall[cell] = (wall[cell] + 0.6).min(1.);
        }
    }
    /// Wall falls in patches that shift each round, sooner where the town crowds on it.
    fn fall(&self, town: &Town, wall: &mut [f64], patches: &Patches, round: usize) {
        for cell in 0..wall.len() {
            if wall[cell] <= 0. {
                continue;
            }
            let wanted = self.wear * (0.5 + town.crowd[cell] / EDGE);
            let rank = patches.rank_at(town.mesh.position(cell), round as f64 * 0.5);
            // With chance gone every stretch stands at the middle rank.
            if 0.5 + (rank - 0.5) * self.wildness < wanted {
                wall[cell] *= 0.2;
            }
        }
    }
    /// The wall after `rounds` rounds of three builders and one season of wear each.
    pub(super) fn wall(&self, town: &Town, rounds: usize) -> Vec<f64> {
        let patches = Patches::of(self.chance("example.wall.wear").noise(260., 3));
        let mut wall = vec![0.; town.mesh.len()];
        for round in 0..rounds {
            for builder in 0..3 {
                self.build(town, &mut wall, (round * 3 + builder) as i32);
            }
            self.fall(town, &mut wall, &patches, round);
        }
        wall
    }
}

/// A picture of the lattice in characters, one for each of `columns` by `rows` places.
pub(super) fn picture(
    mesh: &TriangularLattice,
    [columns, rows]: [usize; 2],
    glyph: impl Fn(usize) -> char,
) -> String {
    let Bounds(west, south, east, north) = mesh.bounds();
    let mut out = String::new();
    for row in 0..rows {
        let y = north - (north - south) * (row as f64 + 0.5) / rows as f64;
        for column in 0..columns {
            let x = west + (east - west) * (column as f64 + 0.5) / columns as f64;
            out.push(mesh.cell_at(x, y).map_or(' ', &glyph));
        }
        out.push('\n');
    }
    out
}
/// The town and its wall as a picture: wall standing, wall fallen, crowded ground.
pub(super) fn drawn(town: &Town, wall: &[f64]) -> String {
    picture(&town.mesh, [72, 30], |cell| match wall[cell] {
        standing if standing > 0.5 => '#',
        fallen if fallen > 0. => ':',
        _ if town.crowd[cell] > EDGE => '.',
        _ => ' ',
    })
}

fn standing(wall: &[f64]) -> Vec<bool> {
    wall.iter().map(|strength| *strength > 0.5).collect()
}
/// The share of the ground either wall stands on that both stand on.
fn alike(a: &[bool], b: &[bool]) -> f64 {
    let both = a.iter().zip(b).filter(|(a, b)| **a && **b).count() as f64;
    let either = a.iter().zip(b).filter(|(a, b)| **a || **b).count() as f64;
    both / either.max(1.)
}
/// How alike the walls of eight rolls are, on average over every pair.
fn likeness(town: &Town, wildness: f64) -> f64 {
    let walls: Vec<_> = (1..=8)
        .map(|roll| {
            let raising = Raising {
                roll,
                wildness,
                wear: 0.25,
            };
            standing(&raising.wall(town, 6))
        })
        .collect();
    let mut total = 0.;
    let mut pairs = 0.;
    for a in 0..walls.len() {
        for b in a + 1..walls.len() {
            total += alike(&walls[a], &walls[b]);
            pairs += 1.;
        }
    }
    total / pairs
}

#[test]
fn the_same_town_under_different_rolls_raises_different_walls() {
    // In: one town, eight rolls, chance playing its full part.
    // Out: no two walls stand on much the same ground.
    let likeness = likeness(&Town::founded(), 1.);
    assert!(likeness < 0.5, "{likeness}");
}

#[test]
fn with_chance_taken_away_every_roll_raises_the_same_wall() {
    // In: the same town and rolls, chance playing no part.
    // Out: one wall. What made the walls differ was chance and nothing else.
    let likeness = likeness(&Town::founded(), 0.);
    assert!(likeness > 0.999, "{likeness}");
}

#[test]
fn the_wall_follows_the_towns_edge_and_wear_leaves_less_of_it() {
    let town = Town::founded();
    let raise = |wear| {
        Raising {
            roll: 3,
            wildness: 1.,
            wear,
        }
        .wall(&town, 6)
    };
    let (kept, worn) = (raise(0.), raise(0.25));
    let cells = |wall: &[f64]| standing(wall).iter().filter(|stands| **stands).count();
    // Wall stands, and nearly all of it on ground near the town's edge.
    assert!(cells(&kept) > 150, "{}", cells(&kept));
    let near_edge = (0..kept.len())
        .filter(|&cell| kept[cell] > 0.5 && town.off_edge(cell).abs() < 1.5)
        .count();
    assert!(
        near_edge * 10 > cells(&kept) * 9,
        "{near_edge} of {}",
        cells(&kept)
    );
    // Wear leaves clearly less standing, and leaves stumps where wall fell.
    assert!(
        cells(&worn) * 10 < cells(&kept) * 9,
        "{} {}",
        cells(&worn),
        cells(&kept)
    );
    assert!(worn
        .iter()
        .any(|strength| *strength > 0. && *strength <= 0.5));
}

/// Draws every piece of the library and the example wall, for a person to look at. Run
/// with `cargo +stable test -p atlas-generation --lib gallery_of_chance -- --ignored --nocapture`.
#[test]
#[ignore = "pictures to look at, not a check"]
fn gallery_of_chance() {
    let town = Town::founded();
    let mesh = &town.mesh;
    let at = |cell: usize| mesh.position(cell);
    let shade = |value: f64| [' ', '.', ':', '+', '#'][(value.clamp(0., 0.999) * 5.) as usize];

    println!("Noise: a field of three octaves, shaded from low to high\n");
    let noise = Chance::named(7, "gallery.noise").noise(700., 3);
    println!("{}", picture(mesh, [72, 24], |c| shade(noise.unit(at(c)))));

    let patches = Patches::of(noise);
    for share in [0.2, 0.5] {
        println!("Patches::covers: the patches that cover {share} of the ground\n");
        let covers = |c| {
            if patches.covers(at(c), share) {
                '#'
            } else {
                ' '
            }
        };
        println!("{}", picture(mesh, [72, 24], covers));
    }
    for time in [0., 0.5, 1.] {
        println!("Patches::rank_at: the lowest 0.3 of a drifting field at time {time}\n");
        let low = |c| {
            if patches.rank_at(at(c), time) < 0.3 {
                '#'
            } else {
                ' '
            }
        };
        println!("{}", picture(mesh, [72, 24], low));
    }

    let middle = mesh
        .cell_at(town.centre[0], town.centre[1])
        .expect("the town has a middle");
    for roughness in [0., 1.] {
        println!(
            "Front::arrivals: ground reached by time 600 and by 1,000, roughness {roughness}\n"
        );
        let front = Front {
            chance: Chance::named(7, "gallery.front"),
            roughness,
        };
        let arrival = front.arrivals(mesh, &[middle], 1_000., |_, _| Some(1.));
        let reached = |c: usize| match arrival[c] {
            t if t <= 600. => '#',
            t if t <= 1_000. => ':',
            _ => ' ',
        };
        println!("{}", picture(mesh, [72, 24], reached));
    }

    println!("seep: a quantity poured at the middle soaking through patchy ground\n");
    let mut soaked = vec![0.; mesh.len()];
    soaked[middle] = 4_000.;
    for _ in 0..300 {
        seep(mesh, &mut soaked, 0.9, |c| {
            if patches.covers(at(c), 0.5) {
                1.
            } else {
                0.03
            }
        });
    }
    println!("{}", picture(mesh, [72, 24], |c| shade(soaked[c] * 0.6)));

    println!("Walker: six walkers setting out from the middle on level ground\n");
    let mut trodden = vec![' '; mesh.len()];
    for walker in 0..6u8 {
        let stride = Stride {
            fan: &FAN,
            whim: 0.12,
            drift: 0.22,
            span: 150.,
        };
        let whims = Whims {
            turn: Chance::named(7, "gallery.walk.turn"),
            drift: Chance::named(7, "gallery.walk.drift"),
        };
        let heading = Chance::named(7, "gallery.walk.heading").angle([f64::from(walker), 0.]);
        let course = Walker {
            point: town.centre,
            heading,
        }
        .walk(
            &stride,
            whims,
            f64::from(walker),
            [45., mesh.spacing()],
            |p| Ok(mesh.cell_at(p[0], p[1]).map(|_| 0.)),
        )
        .unwrap();
        for cell in course.into_iter().filter_map(|p| mesh.cell_at(p[0], p[1])) {
            trodden[cell] = char::from(b'a' + walker);
        }
    }
    println!("{}", picture(mesh, [72, 24], |c| trodden[c]));

    println!("The example wall: one town under three rolls, then with chance taken away\n");
    for (roll, wildness) in [(1, 1.), (2, 1.), (3, 1.), (1, 0.)] {
        let raising = Raising {
            roll,
            wildness,
            wear: 0.25,
        };
        println!("roll {roll}, chance playing {wildness} of its part");
        println!("{}", drawn(&town, &raising.wall(&town, 6)));
    }
}
