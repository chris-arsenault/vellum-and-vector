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

/// A real city's ground, as a map captured it for its wall builders in each of its
/// rounds, laid on a lattice of the bench's own. The wall step is put through the
/// rounds on what the city really gave it, so a rule is seen on real ground in seconds:
/// rivers, satellite villages, ragged built ground and all. The people do not answer the
/// bench's walls; each round's ground is what the map's own run made of it.
///
/// A map writes the ground when `ATLAS_CAPTURE_WALL_GROUND` names a directory.
pub(super) struct Recorded {
    mesh: TriangularLattice,
    rounds: Vec<(CityFields, Vec<f64>, Vec<bool>)>,
    area: f64,
    pub sponsors: Sponsors,
}
impl Recorded {
    /// Reads a town's captured rounds from `directory`, or nothing where a map has not
    /// written them.
    pub(super) fn of(directory: &std::path::Path, town: &str) -> Option<Self> {
        let rounds: Vec<Captured> = (1..=ROUNDS.len())
            .map_while(|round| {
                let file = directory.join(format!("{town}-round-{round}.json"));
                serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(file).ok()?))
                    .ok()
            })
            .collect();
        let first = rounds.first()?;
        let mesh = Self::lattice(first);
        let nearest = Self::nearest(&mesh, first);
        let sponsors = Sponsors {
            eras: first.eras.clone(),
            resolve: first.resolve,
            present: first.present,
            citadel: first.citadel,
            fortune: first.fortune,
            wildness: 1.,
        };
        Some(Self {
            rounds: rounds
                .iter()
                .map(|captured| Self::ground(captured, &nearest))
                .collect(),
            area: first.area,
            mesh,
            sponsors,
        })
    }
    /// A lattice of the captured spacing over the captured ground.
    fn lattice(captured: &Captured) -> TriangularLattice {
        let (mut west, mut south, mut east, mut north) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for [x, y] in &captured.at {
            west = west.min(*x);
            east = east.max(*x);
            south = south.min(*y);
            north = north.max(*y);
        }
        let pad = 3. * captured.spacing;
        let bounds = Bounds(west - pad, south - pad, east + pad, north + pad);
        let triangle = 3. * 3f64.sqrt() / 4.;
        let samples = (bounds.2 - bounds.0) * (bounds.3 - bounds.1)
            / (captured.spacing * captured.spacing * triangle);
        WorldLatticeOptions::default()
            .build(bounds, samples, 0., |_, _| true)
            .unwrap()
    }
    /// The captured cell nearest each cell of the bench's lattice, where one lies close.
    fn nearest(mesh: &TriangularLattice, captured: &Captured) -> Vec<Option<usize>> {
        let span = captured.spacing;
        let square = |[x, y]: [f64; 2]| ((x / span).floor() as i64, (y / span).floor() as i64);
        // hpc-exempt: captured cells bucketed by position once, to lay them on the bench's lattice.
        let mut squares = std::collections::HashMap::<(i64, i64), Vec<usize>>::new();
        for (cell, at) in captured.at.iter().enumerate() {
            squares.entry(square(*at)).or_default().push(cell);
        }
        (0..mesh.len())
            .map(|cell| {
                let [x, y] = position(mesh, cell);
                let (column, row) = square([x, y]);
                let mut close: Option<(f64, usize)> = None;
                for near in (-1..=1).flat_map(|dx| (-1..=1).map(move |dy| (column + dx, row + dy)))
                {
                    for &other in squares.get(&near).into_iter().flatten() {
                        let [ox, oy] = captured.at[other];
                        let apart = (x - ox).hypot(y - oy);
                        if close.is_none_or(|(least, _)| apart < least) {
                            close = Some((apart, other));
                        }
                    }
                }
                close
                    .filter(|(apart, _)| *apart < 1.2 * span)
                    .map(|(_, other)| other)
            })
            .collect()
    }
    /// One round's captured ground on the bench's lattice. Ground the map did not hold
    /// is outside the city and carries no wall.
    fn ground(captured: &Captured, nearest: &[Option<usize>]) -> (CityFields, Vec<f64>, Vec<bool>) {
        let mut fields = CityFields::default();
        let (mut capital, mut firm) = (Vec::new(), Vec::new());
        for from in nearest {
            let value = from.map_or([0.; 10], |cell| captured.ground[cell].map(f64::from));
            fields.claims.push(Claims {
                people: value[0],
                built: value[1],
                ruin: value[2],
                trade: value[3],
                ..Default::default()
            });
            fields.access.push(value[4]);
            fields.stencil.push(value[5]);
            fields.developed.push(value[6]);
            fields.civic.push(value[7]);
            capital.push(value[8]);
            firm.push(value[9] > 0.5);
        }
        (fields, capital, firm)
    }
    /// The walls the city has after its captured rounds, under `sponsors`.
    pub(super) fn walls(&self, sponsors: &Sponsors) -> Vec<Wall> {
        let mut walls = Vec::new();
        for (index, (fields, capital, firm)) in self.rounds.iter().enumerate() {
            let city = City {
                mesh: &self.mesh,
                fields,
                capital,
                firm,
                area: self.area,
                round: index + 1,
                rounds: &ROUNDS,
            };
            walls = raise(&city, sponsors, walls).unwrap();
        }
        walls
    }
    /// The city and its walls drawn in characters: standing wall, fallen wall, sheltered
    /// ground, thickly and thinly built ground, and water.
    pub(super) fn drawn(&self, walls: &[Wall], [columns, rows]: [usize; 2]) -> String {
        let (fields, _, firm) = self.rounds.last().unwrap();
        let mut glyph = vec![' '; self.mesh.len()];
        for cell in 0..glyph.len() {
            let built = fields.claims[cell].built;
            glyph[cell] = match (fields.stencil[cell] > 0.5, firm[cell]) {
                (true, false) => '~',
                (true, true) if walls.iter().any(|wall| wall.encloses(cell)) => '.',
                (true, true) if built > 0.35 => '+',
                (true, true) if built > 0.1 => ',',
                _ => ' ',
            };
        }
        let city = City {
            mesh: &self.mesh,
            fields,
            capital: &[],
            firm,
            area: self.area,
            round: ROUNDS.len(),
            rounds: &ROUNDS,
        };
        for section in walls.iter().flat_map(|wall| &wall.sections) {
            for cell in crossed(&city, section.ends) {
                glyph[cell] = if section.stands() { '#' } else { ':' };
            }
        }
        let (open, course) = self.open_edge(&city, walls);
        for &cell in &open {
            glyph[cell] = 'o';
        }
        format!(
            "    open edge: {} of the {course} cells along the present wall's line\n{}",
            open.len(),
            self.picture(fields, &glyph, [columns, rows])
        )
    }
    /// The city and its walls as plain numbers for a drawing made outside the bench: each
    /// of the city's cells with its place, built share and whether it is water or
    /// sheltered, and each wall section with its ends, its wall and whether it stands.
    pub(super) fn sketch(&self, walls: &[Wall]) -> serde_json::Value {
        let (fields, _, firm) = self.rounds.last().unwrap();
        let cells: Vec<_> = (0..self.mesh.len())
            .filter(|&cell| fields.stencil[cell] > 0.5)
            .map(|cell| {
                let [x, y] = position(&self.mesh, cell);
                let sheltered = walls.iter().any(|wall| wall.encloses(cell));
                serde_json::json!([x, y, fields.claims[cell].built, !firm[cell], sheltered])
            })
            .collect();
        let sections: Vec<_> = walls
            .iter()
            .enumerate()
            .flat_map(|(wall, record)| {
                record.sections.iter().map(move |section| {
                    serde_json::json!([section.ends, wall, section.stands(), record.inherited()])
                })
            })
            .collect();
        serde_json::json!({ "spacing": self.mesh.spacing(), "cells": cells, "sections": sections })
    }
    /// The cells along the line of the present era's wall that could carry wall and have
    /// none standing in sight, and how many cells the line has.
    fn open_edge(&self, city: &City, walls: &[Wall]) -> (Vec<usize>, usize) {
        let Some(wall) = walls.iter().rfind(|wall| !wall.course.is_empty()) else {
            return (Vec::new(), 0);
        };
        let laid = Laid::of(city, walls);
        let standing: Vec<usize> = (0..self.mesh.len())
            .filter(|&cell| laid.stands(walls, cell))
            .collect();
        let near = steps_from(&self.mesh, &standing, SIGHT);
        let open = wall
            .course
            .iter()
            .map(|&cell| cell as usize)
            .filter(|&cell| city.firm[cell] && near[cell] == i8::MAX)
            .collect();
        (open, wall.course.len())
    }
    /// The edges an era's builders may wall on the first captured round's ground, each
    /// measured, and the ground drawn with every cell marked by the tightest of those
    /// edges whose body holds it.
    pub(super) fn edges(&self, era: usize, size: [usize; 2]) -> String {
        use std::fmt::Write;
        let (fields, capital, firm) = &self.rounds[0];
        let city = City {
            mesh: &self.mesh,
            fields,
            capital,
            firm,
            area: self.area,
            round: 1,
            rounds: &ROUNDS,
        };
        let sponsors = &self.sponsors;
        let present = era == sponsors.last();
        let season = Season {
            era,
            name: Some(&sponsors.eras[era].0),
            round: usize::from(present),
            share: if present { 1. } else { sponsors.share(era) },
        };
        let ground = Ground::of(&city, &means(&city).occupied, sponsors, &season).unwrap();
        let mut glyph: Vec<char> = (0..self.mesh.len())
            .map(|cell| match (fields.stencil[cell] > 0.5, firm[cell]) {
                (true, false) => '~',
                (true, true) if fields.claims[cell].built > BUILT => ',',
                _ => ' ',
            })
            .collect();
        let mut out = format!(
            "{}: town {:.1} km2 of {:.1} km2 built\n",
            sponsors.eras[era].0,
            ground.town_cells() as f64 * self.mesh.area(0) / 1e6,
            ground.ranked.len() as f64 * self.mesh.area(0) / 1e6,
        );
        for (ring, share) in ring_shares(sponsors.citadel).into_iter().enumerate() {
            let Some(level) = ground.level(share) else {
                continue;
            };
            let body = body(&city, &ground, level);
            let measured = edge(&city, &ground, &body, &season);
            let held = body.iter().filter(|within| **within).count();
            writeln!(
                out,
                "    edge {ring}: body {:.1} km2, runs {:.1} km, work {:.1} km of plain wall, worth {:.2}",
                held as f64 * self.mesh.area(0) / 1e6,
                measured.length / 1e3,
                measured.work / 1e3,
                measured.worth
            )
            .unwrap();
            let mark = char::from_digit(ring as u32, 10).unwrap_or('?');
            for cell in (0..body.len()).filter(|&cell| body[cell] && firm[cell]) {
                glyph[cell] = mark;
            }
        }
        out + &self.picture(fields, &glyph, size)
    }
    /// The city's own ground, with a little about it, drawn in the characters given for
    /// its cells.
    fn picture(&self, fields: &CityFields, glyph: &[char], [columns, rows]: [usize; 2]) -> String {
        let own: Vec<[f64; 2]> = (0..self.mesh.len())
            .filter(|&cell| fields.stencil[cell] > 0.5)
            .map(|cell| position(&self.mesh, cell))
            .collect();
        let reach = |pick: fn(f64, f64) -> f64, axis: usize, start: f64| {
            own.iter().fold(start, |held, at| pick(held, at[axis]))
        };
        let (west, east) = (reach(f64::min, 0, f64::MAX), reach(f64::max, 0, f64::MIN));
        let (south, north) = (reach(f64::min, 1, f64::MAX), reach(f64::max, 1, f64::MIN));
        let mut out = String::new();
        for row in 0..rows {
            let y = north - (north - south) * (row as f64 + 0.5) / rows as f64;
            for column in 0..columns {
                let x = west + (east - west) * (column as f64 + 0.5) / columns as f64;
                out.push(cell_at(&self.mesh, [x, y]).map_or(' ', |cell| glyph[cell]));
            }
            out.push('\n');
        }
        out
    }
}

/// The directory maps have captured ground into and the towns captured there, in order
/// of name: only the one `ATLAS_WALL_TOWN` names, when it is set.
fn captured() -> Option<(std::path::PathBuf, Vec<String>)> {
    let Some(directory) = std::env::var_os("ATLAS_CAPTURE_WALL_GROUND") else {
        println!("ATLAS_CAPTURE_WALL_GROUND is not set");
        return None;
    };
    let only = std::env::var("ATLAS_WALL_TOWN").ok();
    let mut towns: Vec<String> = std::fs::read_dir(&directory)
        .ok()?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter_map(|file| Some(file.strip_suffix("-round-1.json")?.to_owned()))
        .filter(|town| only.as_ref().is_none_or(|only| only == town))
        .collect();
    towns.sort();
    if towns.is_empty() {
        println!("no captured ground in {}", directory.to_string_lossy());
    }
    Some((directory.into(), towns))
}

/// Writes a city's sketch beside the captured ground when `ATLAS_WALL_SKETCH` names a
/// directory, one file for each town and roll, for a drawing tool to turn into a picture.
fn sketched(sketch: &serde_json::Value, town: &str, roll: f64) {
    let Some(directory) = std::env::var_os("ATLAS_WALL_SKETCH") else {
        return;
    };
    let file = std::path::Path::new(&directory).join(format!("{town}-roll-{roll:.2}.json"));
    std::fs::write(&file, sketch.to_string()).unwrap();
    println!("    sketch {}", file.to_string_lossy());
}

/// Draws the walls the wall step raises on real cities' captured ground, under each
/// city's own roll and two others. Run with
/// `ATLAS_CAPTURE_WALL_GROUND=<directory> cargo +stable test --release -p atlas-generation --lib survey_of_walls_on_captured_ground -- --ignored --nocapture`.
#[test]
#[ignore = "pictures to look at, not a check; needs ground a map has captured"]
fn survey_of_walls_on_captured_ground() {
    let Some((directory, towns)) = captured() else {
        return;
    };
    println!(
        "# standing wall  : fallen wall  o open edge of the present wall  . sheltered  + built  , thinly built  ~ water\n"
    );
    for town in &towns {
        let Some(recorded) = Recorded::of(&directory, town) else {
            println!("{town}: no captured ground");
            continue;
        };
        let started = std::time::Instant::now();
        for roll in [None, Some(0.31), Some(0.77)] {
            let mut sponsors = recorded.sponsors.clone();
            sponsors.fortune = roll.unwrap_or(sponsors.fortune);
            let walls = recorded.walls(&sponsors);
            println!(
                "{town}, {} cells, roll {:.2}, causes {:.2} then {:.2} now, citadel {}",
                recorded.mesh.len(),
                sponsors.fortune,
                sponsors.resolve,
                sponsors.present,
                sponsors.citadel
            );
            for line in told(&walls) {
                println!("    {line}");
            }
            println!("{}", recorded.drawn(&walls, [200, 90]));
            sketched(&recorded.sketch(&walls), town, sponsors.fortune);
        }
        println!("{town}: {:.1} s", started.elapsed().as_secs_f64());
    }
}

/// Measures and draws the edges each era's builders may wall on real cities' captured
/// ground: what the builders are given to walk before any of them sets out. Run as the
/// survey of walls on captured ground is.
#[test]
#[ignore = "pictures to look at, not a check; needs ground a map has captured"]
fn survey_of_edges_on_captured_ground() {
    let Some((directory, towns)) = captured() else {
        return;
    };
    println!("0 1 2 the tightest edge holding the ground, wide to tight  , built  ~ water\n");
    for town in &towns {
        let Some(recorded) = Recorded::of(&directory, town) else {
            println!("{town}: no captured ground");
            continue;
        };
        for era in 0..recorded.sponsors.eras.len() {
            println!("{town}, {}", recorded.edges(era, [200, 90]));
        }
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
    // Out: under every roll the weightier causes lay as much wall or more, a join's
    // length aside where both close the circuit, and over the rolls half as much again
    // or more: a town barely troubled still closes its circuit under a roll that deals
    // it a bad era.
    let plain = Plain::city(60_000., 600.);
    let (mut light, mut heavy) = (0., 0.);
    let mut told = Vec::new();
    for roll in 1..=6 {
        let little = laid(&plain.walls(&town(&ONE_ERA, 0.05, roll)));
        let much = laid(&plain.walls(&town(&ONE_ERA, 3., roll)));
        told.push((roll, little.round(), much.round()));
        light += little;
        heavy += much;
    }
    assert!(
        told.iter().all(|(_, little, much)| *much >= 0.97 * little),
        "{told:?}"
    );
    assert!(heavy > 1.5 * light && heavy > 20_000., "{told:?}");
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
