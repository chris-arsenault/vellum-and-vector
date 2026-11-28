//! The city wall bench: a small city constructed on level ground and put through the real
//! wall step for the three rounds a city map runs, in a second or two. A test states what
//! goes in (how many townsfolk each era, what moves the town to defend itself, its roll,
//! how crowded and how built its ground) and checks what walls come out.
//!
//! The ground is constructed, not generated: people thin outward from the middle by a set
//! distance, built ground follows the people, and nothing moves between rounds. So the
//! bench leaves out what the map's other steps do with a wall once it stands: people and
//! works gathering behind it, districts divided along it, ways gated through it. It shows
//! what the wall step makes of a given city, never how a city answers its walls.
use super::*;
use crate::{
    field::geographic_contours::{membership_on, Sheet},
    lattice::WorldLatticeOptions,
    processes::town::urban::fields::Claims,
};
use atlas_gis::geometry::NativeGeos;
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
    spatial: NativeGeos,
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
        let spatial = NativeGeos::new(0.001).unwrap();
        let peak = people / (std::f64::consts::TAU * (gather / 1_000.).powi(2));
        let mut fields = CityFields::default();
        let mut capital = Vec::with_capacity(mesh.len());
        for c in 0..mesh.len() {
            let [x, y] = position(&mesh, c);
            let from_middle = (x - SIDE / 2.).hypot(y - SIDE / 2.);
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
            spatial,
            fields,
            capital,
            firm,
        }
    }
    fn contour(&self, values: &[f64], level: f64) -> io::Result<Option<Geometry>> {
        let members: Vec<_> = (0..values.len()).filter(|&i| values[i] > level).collect();
        if members.is_empty() {
            return Ok(None);
        }
        membership_on(
            &Sheet {
                mesh: &self.mesh,
                spatial: &self.spatial,
                precision: 0.001,
            },
            &members,
            &|i| Ok(0.5 + values[i] - level),
        )
    }
    /// Reads the city as the wall step sees it in `round`.
    fn read<T>(&self, round: usize, read: impl FnOnce(&City) -> T) -> T {
        let contour = |values: &[f64], level: f64| self.contour(values, level);
        read(&City {
            mesh: &self.mesh,
            spatial: &self.spatial,
            fields: &self.fields,
            capital: &self.capital,
            firm: &self.firm,
            area: std::f64::consts::PI * OUTLINE * OUTLINE,
            round,
            rounds: &ROUNDS,
            contour: &contour,
        })
    }
    /// One round of the real wall step on this city.
    pub(super) fn round(&self, round: usize, sponsors: &Sponsors, walls: Vec<Wall>) -> Vec<Wall> {
        self.read(round, |city| raise(city, sponsors, walls).unwrap())
    }
    /// The share of a wall left standing after `eras` eras nobody keeps it, over sixty
    /// rolls: the wall made sound, then put through the real decay.
    pub(super) fn left_standing(&self, wall: &Wall, eras: usize) -> f64 {
        let mut sound = wall.clone();
        for section in &mut sound.sections {
            (section.built, section.disused, section.repaired) = (section.cost, 0., 0.);
        }
        self.read(ROUNDS.len(), |city| {
            (1..=60)
                .map(|roll| {
                    let mut wall = sound.clone();
                    decay(city, f64::from(roll) / 61., 0, &mut wall, eras);
                    wall.standing_share()
                })
                .sum::<f64>()
                / 60.
        })
    }
    /// The share of the city's people who live inside a wall.
    pub(super) fn share_within(&self, wall: &Wall) -> f64 {
        let people = |c: usize| self.fields.claims[c].people * self.fields.stencil[c];
        let inside: f64 = wall.inside.iter().map(|&c| people(c as usize)).sum();
        inside / (0..self.mesh.len()).map(people).sum::<f64>()
    }
    /// The walls the city has after its three rounds.
    pub(super) fn walls(&self, sponsors: &Sponsors) -> Vec<Wall> {
        (1..=ROUNDS.len()).fold(Vec::new(), |walls, round| {
            self.round(round, sponsors, walls)
        })
    }
}

/// A town's record: its eras' townsfolk, oldest first, and the weight of what moves it to
/// defend itself. Its sponsor of today begins in the first round.
pub(super) fn town(eras: &[(&str, f64)], causes: f64) -> Sponsors {
    let sponsors = Sponsors {
        eras: eras
            .iter()
            .map(|(era, townsfolk)| ((*era).to_owned(), *townsfolk))
            .collect(),
        resolve: causes,
        present: causes,
        citadel: 1.,
        fortune: 0.,
    };
    beginning(sponsors, 1)
}
/// The same town under the first roll that has today's sponsor begin in `round`.
pub(super) fn beginning(mut sponsors: Sponsors, round: usize) -> Sponsors {
    sponsors.fortune = (1..2_000)
        .map(|n| f64::from(n) / 2_000.)
        .find(|roll| {
            sponsors.fortune = *roll;
            sponsors.begins(&ROUNDS) == round
        })
        .unwrap();
    sponsors
}
/// A weight of causes under which every era finds any wall worth raising and keeping.
pub(super) const ALWAYS: f64 = 1e9;

fn told(walls: &[Wall]) -> Vec<String> {
    walls
        .iter()
        .map(|wall| {
            format!(
                "{} round {} {:.2} km2 worth {:.2} work {:.0} standing {:.2} {}",
                wall.era.as_deref().unwrap_or("-"),
                wall.round,
                wall.area / 1e6,
                wall.worth,
                wall.sections.iter().map(|s| s.cost).sum::<f64>(),
                wall.standing_share(),
                wall.condition(),
            )
        })
        .collect()
}

/// Prints what the bench city's walls come to under a spread of histories and rolls. Run
/// with `cargo +stable test -p atlas-generation --lib survey_of_walls -- --ignored --nocapture`.
#[test]
#[ignore = "a survey to read, not a check"]
fn survey_of_walls() {
    let plain = Plain::city(60_000., 600.);
    println!(
        "{} cells, spacing {:.0} m",
        plain.mesh.len(),
        plain.mesh.spacing()
    );
    let histories: [&[(&str, f64)]; 4] = [
        &[("now", 60_000.)],
        &[("old", 15_000.), ("now", 60_000.)],
        &[("old", 45_000.), ("now", 60_000.)],
        &[("first", 4_000.), ("old", 20_000.), ("now", 60_000.)],
    ];
    for eras in histories {
        println!("history {eras:?}, every era walls");
        for line in told(&plain.walls(&town(eras, ALWAYS))) {
            println!("    {line}");
        }
    }
    for (people, gather) in [
        (20_000., 300.),
        (60_000., 300.),
        (60_000., 1_200.),
        (200_000., 600.),
        (200_000., 1_200.),
    ] {
        println!("{people} people gathered within {gather} m, one era, every era walls");
        let city = Plain::city(people, gather);
        for citadel in [1., 2.] {
            let mut sponsors = town(&[("now", people)], ALWAYS);
            sponsors.citadel = citadel;
            for line in told(&city.walls(&sponsors)) {
                println!("    citadel {citadel}: {line}");
            }
        }
    }
    let eras = histories[3];
    for causes in [0.3, 0.7] {
        for roll in 1..=12 {
            let mut sponsors = town(eras, causes);
            sponsors.fortune = f64::from(roll) / 13.;
            let threats: Vec<_> = (0..eras.len())
                .map(|era| format!("{:.2}", sponsors.threat(era)))
                .collect();
            println!(
                "causes {causes} roll {roll}: threats {threats:?} begins {}",
                sponsors.begins(&ROUNDS)
            );
            for line in told(&plain.walls(&sponsors)) {
                println!("    {line}");
            }
        }
    }
}

const GREW_FOURFOLD: [(&str, f64); 2] = [("old", 15_000.), ("now", 60_000.)];
const GREW_LITTLE: [(&str, f64); 2] = [("old", 45_000.), ("now", 60_000.)];
const ONE_ERA: [(&str, f64); 1] = [("now", 60_000.)];

#[test]
fn a_town_nothing_moves_to_defend_itself_raises_no_wall() {
    // In: a town that grew fourfold, with no cause to wall itself in any era.
    // Out: no wall, old or new.
    let walls = Plain::city(60_000., 600.).walls(&town(&GREW_FOURFOLD, 0.));
    assert!(walls.is_empty(), "{:?}", told(&walls));
}

#[test]
fn a_town_that_spread_as_it_grew_has_its_old_wall_inside_a_new_one() {
    // In: 15,000 townsfolk in the old era, 60,000 now, spread wide today so that most
    // live beyond the ground the old town stood on; every era walls.
    // Out: two walls. The old one is small, lies wholly inside the new one, and the city
    // has outgrown it; the new one is today's and finished.
    let walls = Plain::city(60_000., 1_200.).walls(&town(&GREW_FOURFOLD, ALWAYS));
    assert_eq!(walls.len(), 2, "{:?}", told(&walls));
    let (old, new) = (&walls[0], &walls[1]);
    assert!(old.inherited() && old.outgrown && old.era.as_deref() == Some("old"));
    assert!(!new.inherited() && !new.outgrown && !new.unfinished());
    assert!(old.area < 0.4 * new.area, "{:?}", told(&walls));
    assert!(old.inside.iter().all(|&c| new.encloses(c as usize)));
}

#[test]
fn a_town_that_grew_by_crowding_its_old_ground_keeps_its_one_wall() {
    // In: the same history, 15,000 then and 60,000 now, but today's people crowd the
    // middle, so most still live on the ground the old town stood on; every era walls.
    // Out: one wall, the old era's, still kept whole. Most of the city lives inside it
    // and the rest outside; a second wall would protect too few new people to be raised.
    let plain = Plain::city(60_000., 600.);
    let walls = plain.walls(&town(&GREW_FOURFOLD, ALWAYS));
    assert_eq!(walls.len(), 1, "{:?}", told(&walls));
    let wall = &walls[0];
    assert!(wall.inherited() && !wall.outgrown);
    assert_eq!(wall.condition(), "maintained");
    let within = plain.share_within(wall);
    assert!(within > 0.5 && within < 0.95, "{within}");
}

#[test]
fn stone_is_taken_from_an_unkept_wall_where_the_city_presses_on_it() {
    // In: two old walls nobody keeps. One runs through the crowded middle of today's
    // city, the other through thinly built ground further out.
    // Out: over many rolls the wall in the crowded middle keeps much less of its length;
    // a second unkept era costs either wall more; and a stretch stands or falls whole.
    let plain = Plain::city(60_000., 600.);
    let eras = [("first", 4_000.), ("old", 20_000.), ("now", 60_000.)];
    let inner = plain.walls(&town(&eras, ALWAYS)).remove(0);
    let outer = plain.walls(&town(&GREW_LITTLE, ALWAYS)).remove(0);
    assert!(inner.area < 0.2 * outer.area);
    let (pressed, open) = (
        plain.left_standing(&inner, 1),
        plain.left_standing(&outer, 1),
    );
    // Ground about the inner wall is nearly half built, about the outer hardly at all.
    assert!(pressed < open - 0.15, "{pressed} {open}");
    assert!(plain.left_standing(&outer, 2) < open - 0.1);
    // The inner wall as the city left it: outgrown, so unkept for the present era.
    let standing = inner.standing_share();
    assert!(standing > 0.05 && standing < 0.95, "{standing}");
    assert!(inner
        .sections
        .iter()
        .all(|s| s.disused == 0. || s.disused >= s.built));
}

#[test]
fn a_wall_begun_in_the_last_years_of_the_era_is_still_building() {
    // In: the same town and causes; today's sponsor begins in the first round, which
    // stands for 250 years, or in the last, which stands for 20.
    // Out: the early wall is finished; the late one is the same circuit, part built.
    let plain = Plain::city(60_000., 600.);
    let early = plain.walls(&town(&ONE_ERA, ALWAYS));
    let late = plain.walls(&beginning(town(&ONE_ERA, ALWAYS), 3));
    assert_eq!(early.len(), 1);
    assert_eq!(early[0].condition(), "maintained");
    assert_eq!(late.len(), 1);
    assert_eq!(late[0].condition(), "partial");
    let standing = late[0].standing_share();
    assert!(standing > 0.05 && standing < 0.9, "{standing}");
}

#[test]
fn the_same_threat_walls_a_crowded_town_and_leaves_a_scattered_one_open() {
    // In: two towns of 60,000 under one roll and the same causes: one gathered close,
    // one spread three times as far.
    // Out: a wall is worth more to the crowded town, and under a threat between the two
    // worths the crowded town walls itself and the scattered one stays open.
    let (crowded, scattered) = (Plain::city(60_000., 400.), Plain::city(60_000., 1_200.));
    let worth = |plain: &Plain| plain.walls(&town(&ONE_ERA, ALWAYS))[0].worth;
    let (high, low) = (worth(&crowded), worth(&scattered));
    assert!(high > 1.3 * low, "{high} {low}");
    let mut sponsors = town(&ONE_ERA, 1.);
    let causes = walls::RAISE / (sponsors.threat(0) * (high * low).sqrt());
    (sponsors.resolve, sponsors.present) = (causes, causes);
    assert_eq!(crowded.walls(&sponsors).len(), 1);
    assert!(scattered.walls(&sponsors).is_empty());
}

#[test]
fn one_town_under_different_rolls_has_different_walls() {
    // In: one town, one history of three eras, one weight of causes; eight rolls.
    // Out: at least three different outcomes among them, told by which eras' walls
    // stand and in what condition.
    let plain = Plain::city(60_000., 600.);
    let eras = [("first", 4_000.), ("old", 20_000.), ("now", 60_000.)];
    let mut outcomes: Vec<String> = Vec::new();
    for roll in 1..=8 {
        let mut sponsors = town(&eras, 0.7);
        sponsors.fortune = f64::from(roll) / 13.;
        let outcome = plain
            .walls(&sponsors)
            .iter()
            .map(|wall| {
                format!(
                    "{} {}",
                    wall.era.as_deref().unwrap_or("-"),
                    wall.condition()
                )
            })
            .collect::<Vec<_>>()
            .join(" + ");
        if !outcomes.contains(&outcome) {
            outcomes.push(outcome);
        }
    }
    assert!(outcomes.len() >= 3, "{outcomes:?}");
}
