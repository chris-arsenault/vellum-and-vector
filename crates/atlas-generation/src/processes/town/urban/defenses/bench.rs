//! The city wall bench: a small city constructed on level ground and put through the real
//! wall step for the three rounds a city map runs, in well under a second. A test states
//! what goes in (how many townsfolk each era, what moves the town to defend itself, its
//! roll, how crowded and how built its ground) and checks what walls come out.
//!
//! The ground is constructed, not generated: people thin outward from the middle by a set
//! distance, built ground follows the people, and nothing moves between rounds. So the
//! bench leaves out what the map's other steps do with a wall once it stands: people and
//! works gathering behind it, districts divided along it, ways gated through it. It shows
//! what the wall step makes of a given city, never how a city answers its walls.
use super::*;
use crate::{lattice::WorldLatticeOptions, processes::town::urban::fields::Claims};
use atlas_map::Bounds;

/// The years the three rounds of a city map stand for.
const ROUNDS: [f64; 3] = crate::field::refinement::people::DEVELOPMENT_EXPOSURE;
/// The people a square kilometre of fully built ground holds.
const FULL: f64 = 20_000.;
/// The side of the bench's ground and the radius of its city's outline, in metres.
const SIDE: f64 = 8_000.;
const OUTLINE: f64 = 3_200.;

/// A city constructed on level ground.
pub(super) struct Plain {
    mesh: TriangularLattice,
    fields: CityFields,
    capital: Vec<f64>,
    firm: Vec<bool>,
}
impl Plain {
    /// A round city of `people` whose crowding falls by a factor of e every `gather`
    /// metres from the middle.
    pub(super) fn city(people: f64, gather: f64) -> Self {
        let mesh = WorldLatticeOptions::default()
            .build(Bounds(0., 0., SIDE, SIDE), 6_000., 0., |_, _| true)
            .unwrap();
        let peak = people / (std::f64::consts::TAU * (gather / 1_000.).powi(2));
        let mut fields = CityFields::default();
        let mut capital = Vec::with_capacity(mesh.len());
        for c in 0..mesh.len() {
            let from_middle = Self::from_middle(&mesh, c);
            let crowd = peak * (-from_middle / gather).exp();
            let built = (crowd / FULL).min(1.);
            fields.claims.push(Claims {
                people: crowd,
                built,
                ..Default::default()
            });
            fields
                .stencil
                .push(if from_middle < OUTLINE { 1. } else { 0. });
            fields.access.push(0.5);
            fields.developed.push(built);
            fields.civic.push(0.);
            capital.push(0.6 * built * crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2);
        }
        let firm = vec![true; mesh.len()];
        Self {
            mesh,
            fields,
            capital,
            firm,
        }
    }
    fn from_middle(mesh: &TriangularLattice, cell: usize) -> f64 {
        let [x, y] = position(mesh, cell);
        (x - SIDE / 2.).hypot(y - SIDE / 2.)
    }
    /// Reads the city as the wall step sees it in `round`.
    fn read<T>(&self, round: usize, read: impl FnOnce(&City) -> T) -> T {
        read(&City {
            mesh: &self.mesh,
            fields: &self.fields,
            capital: &self.capital,
            firm: &self.firm,
            area: std::f64::consts::PI * OUTLINE * OUTLINE,
            round,
            rounds: &ROUNDS,
        })
    }
    /// The walls the city has after its three rounds.
    pub(super) fn walls(&self, sponsors: &Sponsors) -> Vec<Wall> {
        (1..=ROUNDS.len()).fold(Vec::new(), |walls, round| {
            self.read(round, |city| raise(city, sponsors, walls).unwrap())
        })
    }
    /// The cells standing wall lies on.
    pub(super) fn standing(&self, walls: &[Wall]) -> Vec<bool> {
        let mut on = vec![false; self.mesh.len()];
        self.read(1, |city| {
            for section in walls.iter().flat_map(|wall| &wall.sections) {
                if section.stands() {
                    for cell in crossed(city, section.ends) {
                        on[cell] = true;
                    }
                }
            }
        });
        on
    }
    /// The walls drawn in characters: standing wall, fallen wall, sheltered ground and
    /// built ground.
    pub(super) fn drawn(&self, walls: &[Wall]) -> String {
        let standing = self.standing(walls);
        let mut fallen = vec![false; self.mesh.len()];
        for section in walls.iter().flat_map(|wall| &wall.sections) {
            fallen[section.cell] |= !section.stands();
        }
        let sheltered = |cell: usize| walls.iter().any(|wall| wall.encloses(cell));
        let mut out = String::new();
        for row in 0..36 {
            let y = SIDE * (0.82 - 0.64 * (f64::from(row) + 0.5) / 36.);
            for column in 0..84 {
                let x = SIDE * (0.18 + 0.64 * (f64::from(column) + 0.5) / 84.);
                out.push(match cell_at(&self.mesh, [x, y]) {
                    Some(cell) if standing[cell] => '#',
                    Some(cell) if fallen[cell] => ':',
                    Some(cell) if sheltered(cell) => '.',
                    Some(cell) if self.fields.claims[cell].built > 0.1 => ',',
                    _ => ' ',
                });
            }
            out.push('\n');
        }
        out
    }
}

/// A town's record: its eras' townsfolk, oldest first, and the weight of what moves it to
/// defend itself, under the `roll`th of the bench's rolls.
pub(super) fn town(eras: &[(&str, f64)], causes: f64, roll: u32) -> Sponsors {
    Sponsors {
        eras: eras
            .iter()
            .map(|(era, townsfolk)| ((*era).to_owned(), *townsfolk))
            .collect(),
        resolve: causes,
        present: causes,
        citadel: 1.,
        fortune: f64::from(roll) / 97.,
        wildness: 1.,
    }
}
const ONE_ERA: [(&str, f64); 1] = [("now", 60_000.)];
const THREE_ERAS: [(&str, f64); 3] = [("first", 8_000.), ("old", 25_000.), ("now", 60_000.)];

fn told(walls: &[Wall]) -> Vec<String> {
    walls
        .iter()
        .map(|wall| {
            format!(
                "{} round {} laid {:.1} km standing {:.2} shelters {:.2} km2 worth {:.2} {}",
                wall.era.as_deref().unwrap_or("-"),
                wall.round,
                laid(std::slice::from_ref(wall)) / 1e3,
                wall.standing_share(),
                wall.area / 1e6,
                wall.worth,
                wall.condition(),
            )
        })
        .collect()
}
/// The length of wall ever laid, in metres.
fn laid(walls: &[Wall]) -> f64 {
    walls
        .iter()
        .flat_map(|wall| &wall.sections)
        .map(|s| distance(s.ends[0], s.ends[1]))
        .sum()
}
/// The share of the ground either footprint covers that both cover.
fn alike(a: &[bool], b: &[bool]) -> f64 {
    let both = a.iter().zip(b).filter(|(a, b)| **a && **b).count() as f64;
    let either = a.iter().zip(b).filter(|(a, b)| **a || **b).count() as f64;
    if either == 0. {
        1.
    } else {
        both / either
    }
}
/// How alike the standing walls of eight rolls are, on average over every pair.
fn likeness(plain: &Plain, wildness: f64) -> f64 {
    let footprints: Vec<_> = (1..=8)
        .map(|roll| {
            let mut sponsors = town(&THREE_ERAS, 1.5, roll);
            sponsors.wildness = wildness;
            plain.standing(&plain.walls(&sponsors))
        })
        .collect();
    let mut total = 0.;
    let mut pairs = 0.;
    for a in 0..footprints.len() {
        for b in a + 1..footprints.len() {
            total += alike(&footprints[a], &footprints[b]);
            pairs += 1.;
        }
    }
    total / pairs
}

/// Draws what the bench city's walls come to under a spread of histories, causes and
/// rolls. Run with
/// `cargo +stable test -p atlas-generation --lib survey_of_walls -- --ignored --nocapture`.
#[test]
#[ignore = "pictures to look at, not a check"]
fn survey_of_walls() {
    let plain = Plain::city(60_000., 600.);
    println!("# standing wall  : fallen wall  . sheltered ground  , built ground\n");
    for (eras, causes) in [
        (&ONE_ERA[..], 3.),
        (&THREE_ERAS[..], 1.5),
        (&THREE_ERAS[..], 0.5),
    ] {
        for roll in 1..=4 {
            let sponsors = town(eras, causes, roll);
            let threats: Vec<_> = (0..eras.len())
                .map(|era| format!("{:.2}", sponsors.threat(era)))
                .collect();
            let walls = plain.walls(&sponsors);
            println!(
                "history {eras:?}, causes {causes}, roll {roll}: threats {threats:?}, begins round {}",
                sponsors.begins(&ROUNDS)
            );
            for line in told(&walls) {
                println!("    {line}");
            }
            println!("{}", plain.drawn(&walls));
        }
    }
    let mut still = town(&THREE_ERAS, 1.5, 1);
    still.wildness = 0.;
    println!("the same three eras with chance stilled");
    println!("{}", plain.drawn(&plain.walls(&still)));
}

#[test]
fn a_town_nothing_moves_to_defend_itself_raises_no_wall() {
    // In: three eras of growth and no cause to wall the town in any of them.
    // Out: no wall, old or new, under any roll.
    let plain = Plain::city(60_000., 600.);
    for roll in 1..=4 {
        let walls = plain.walls(&town(&THREE_ERAS, 0., roll));
        assert!(walls.is_empty(), "{:?}", told(&walls));
    }
}

#[test]
fn builders_lay_wall_along_the_towns_edge() {
    // In: one era, a gravely threatened town with the means for a whole circuit.
    // Out: kilometres of wall, nearly all of it between the crowded middle and the thin
    // fringe, none in either.
    let plain = Plain::city(60_000., 600.);
    let walls = plain.walls(&town(&ONE_ERA, 5., 2));
    assert!(laid(&walls) > 4_000., "{:?}", told(&walls));
    let on = plain.standing(&walls);
    let cells: Vec<_> = (0..on.len()).filter(|&cell| on[cell]).collect();
    let out: Vec<_> = cells
        .iter()
        .map(|&cell| Plain::from_middle(&plain.mesh, cell))
        .collect();
    let between = out.iter().filter(|d| (600. ..3_000.).contains(*d)).count();
    assert!(between * 10 >= out.len() * 9, "{between} of {}", out.len());
}

#[test]
fn the_same_town_under_different_rolls_raises_different_walls() {
    // In: one city, one history of three eras, the same causes; eight rolls.
    // Out: no two rolls' walls stand on much the same ground.
    let likeness = likeness(&Plain::city(60_000., 600.), 1.);
    assert!(likeness < 0.4, "{likeness}");
}

#[test]
fn with_chance_stilled_every_roll_raises_the_same_wall() {
    // In: the same city, history and rolls, with chance playing no part.
    // Out: one wall. What made the walls differ was chance and nothing else.
    let likeness = likeness(&Plain::city(60_000., 600.), 0.);
    assert!(likeness > 0.999, "{likeness}");
}

#[test]
fn a_gravely_threatened_town_lays_more_wall_than_one_barely_troubled() {
    // In: the same city and rolls; causes that weigh little, and causes that weigh much.
    // Out: under every roll the weightier causes lay at least as much wall, and over the
    // rolls far more.
    let plain = Plain::city(60_000., 600.);
    let (mut light, mut heavy) = (0., 0.);
    for roll in 1..=6 {
        let little = laid(&plain.walls(&town(&ONE_ERA, 0.05, roll)));
        let much = laid(&plain.walls(&town(&ONE_ERA, 3., roll)));
        assert!(much >= little, "roll {roll}: {little} {much}");
        light += little;
        heavy += much;
    }
    assert!(heavy > 2. * light && heavy > 20_000., "{light} {heavy}");
}

#[test]
fn a_closed_circuit_shelters_the_ground_inside_it_and_an_arc_little() {
    // In: a town with the work for its whole edge and chance stilled, so its builders
    // close the circuit; then the same town with a fifth of the causes.
    // Out: the closed circuit shelters square kilometres holding most of the town; the
    // lesser work shelters far less.
    let plain = Plain::city(60_000., 600.);
    let raise = |causes: f64| {
        let mut sponsors = town(&ONE_ERA, causes, 1);
        sponsors.wildness = 0.;
        plain.walls(&sponsors)
    };
    let whole = raise(50.);
    assert_eq!(whole.len(), 1, "{:?}", told(&whole));
    assert!(whole[0].area > 3e6, "{:?}", told(&whole));
    let people = |cells: &[u32]| -> f64 {
        cells
            .iter()
            .map(|&c| plain.fields.claims[c as usize].people)
            .sum()
    };
    let everyone: f64 = plain.fields.claims.iter().map(|x| x.people).sum();
    assert!(people(&whole[0].inside) > 0.5 * everyone);
    assert_eq!(whole[0].condition(), "maintained");
    let part = raise(0.02);
    let sheltered: f64 = part.iter().map(|wall| wall.area).sum();
    assert!(sheltered < 0.3 * whole[0].area, "{:?}", told(&part));
}

#[test]
fn wall_falls_soonest_where_built_ground_presses_on_it() {
    // In: three eras of walls under eight rolls. The earliest walls run through what is
    // now the built middle; today's run through thinly built ground.
    // Out: far less of the wall laid on built ground still stands.
    let plain = Plain::city(60_000., 600.);
    let (mut pressed, mut open) = ([0., 0.], [0., 0.]);
    for roll in 1..=8 {
        for section in plain
            .walls(&town(&THREE_ERAS, 3., roll))
            .iter()
            .flat_map(|wall| &wall.sections)
        {
            let built = plain.fields.claims[section.cell].built;
            let tally = if built > 0.3 { &mut pressed } else { &mut open };
            tally[0] += f64::from(section.stands());
            tally[1] += 1.;
        }
    }
    assert!(pressed[1] > 100. && open[1] > 100., "{pressed:?} {open:?}");
    let (pressed, open) = (pressed[0] / pressed[1], open[0] / open[1]);
    assert!(pressed < open - 0.2, "{pressed} {open}");
}

#[test]
fn builders_set_out_on_the_side_the_threat_came_from() {
    // In: a town with work for only part of its edge, under twelve rolls, each with its
    // own bearing for the era's threat.
    // Out: over the rolls the wall lies toward that bearing, not all round.
    let plain = Plain::city(60_000., 600.);
    let mut toward = 0.;
    let mut cells = 0.;
    for roll in 1..=12 {
        let sponsors = town(&ONE_ERA, 0.03, roll);
        let bearing = sponsors.bearing(0);
        let on = plain.standing(&plain.walls(&sponsors));
        for cell in (0..on.len()).filter(|&cell| on[cell]) {
            let [x, y] = position(&plain.mesh, cell);
            toward += ((y - SIDE / 2.).atan2(x - SIDE / 2.) - bearing).cos();
            cells += 1.;
        }
    }
    assert!(cells > 100., "{cells}");
    assert!(
        toward / cells > 0.15,
        "{} over {cells} cells",
        toward / cells
    );
}
