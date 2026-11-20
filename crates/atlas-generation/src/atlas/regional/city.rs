//! City growth on a city map: after each round's people pass, the city's people move toward
//! where it grows (`field::people::growth`), guided by the settlement template the city
//! selects at its own scale. The next round's refinement and people pass read the result.
use super::work::{Inputs, Occurrence, Operation};
use crate::{
    atlas::state::State,
    execution::{ExecutionError, Projection},
    field::{
        people::{crafts, growth, work::habitable},
        Field,
    },
    human::{catalogue::LayerId, HumanField},
    rock::ground::GroundField,
    town::templates::{Selection, SiteEvidence},
};
use std::{io, rc::Rc};
mod plan;

/// Relief across the core that makes two usable levels of one city, in metres.
const LEVELS: f64 = 30.;
/// A city map's outline reaches this many times the city's built radius (`town::city`).
const SURROUNDINGS: f64 = 2.5;

pub(super) fn growth(input: Rc<Inputs>, field: &Projection<State, Field>) -> Operation {
    let field = field.clone();
    let operation = growth::operation(Rc::new(Field::human_operations()));
    let seed = input.seed;
    crate::execution::Command::with_inputs(
        "refinement.city-growth",
        crate::execution::CommandKind::Event,
        vec![],
        move |scope, _: &Occurrence| {
            if scope.state().scope.city.is_none() {
                return Ok(());
            }
            let selection = template(scope.state_mut(), seed)?;
            let guidance = {
                let field = scope.state().field();
                let mesh = field.mesh();
                let [ox, oy] = mesh.origin();
                growth::Guidance {
                    weight: (0..mesh.len())
                        .map(|cell| {
                            let [x, y] = mesh.position(cell);
                            selection.city_affinity([x + ox, y + oy])
                        })
                        .collect(),
                    reach: ((2. * selection.quarter() / mesh.cell_span()).ceil() as usize)
                        .clamp(2, 8),
                }
            };
            scope.project(&field).run(&operation, &guidance)?;
            let round = scope.state().regional.as_ref().map_or(0, |r| r.round);
            raise_walls(scope.state_mut(), &selection, seed, round)?;
            Ok(())
        },
    )
}

/// Slope at which ground defends a wall's face on its own, rise over run.
const DEFENDING_SLOPE: f64 = 0.4;

/// The city's walls and gates as catalogue places, each with its published geometry: a wall
/// is the run of faces between its enclosed cells and the outside, a gate the face a way
/// crosses.
pub(crate) fn wall_places(
    state: &State,
) -> io::Result<(
    Vec<crate::field::poi::values::Place>,
    Vec<crate::field::poi::values::Place>,
)> {
    use crate::field::poi::{
        kinds::Kind,
        map_records::{generated, Record},
        values::Place,
    };
    use crate::town::walls::run;
    use atlas_map::{Geometry, Position};
    let Some(regional) = state.regional.as_ref().filter(|r| !r.city.walls.is_empty()) else {
        return Ok((Vec::new(), Vec::new()));
    };
    let field = state.field();
    let mesh = field.mesh();
    let [ox, oy] = mesh.origin();
    let slope = field.shared().scalar(crate::field::shared::Scalar::Slope);
    let kept = field.people().view(HumanField::KeptLine);
    let mut defended = Vec::with_capacity(mesh.len());
    let mut ways = Vec::with_capacity(mesh.len());
    for cell in 0..mesh.len() {
        defended.push(!habitable(field, cell)? || slope.get(cell)? > DEFENDING_SLOPE);
        ways.push(kept.get(cell)?);
    }
    let busiest = ways.iter().copied().fold(0., f64::max).max(f64::EPSILON);
    ways.iter_mut().for_each(|w| *w /= busiest);
    let neighbours = |cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge));
    // A face's two ends, in map coordinates.
    let segment = |face: &crate::town::walls::Face| {
        let edge = (0..3).find(|&e| mesh.neighbor(face.inside, e) == Some(face.outside))?;
        let ([cx, cy], [nx, ny], length) = mesh.physical_face(face.inside, edge)?;
        let [tx, ty] = [-ny * length / 2., nx * length / 2.];
        Some([
            Position::xy(cx - tx + ox, cy - ty + oy),
            Position::xy(cx + tx + ox, cy + ty + oy),
        ])
    };
    let mut walls = Vec::new();
    let mut gates = Vec::new();
    for (index, wall) in regional.city.walls.iter().enumerate() {
        let mut inside = vec![false; mesh.len()];
        for &cell in &wall.inside {
            inside[cell as usize] = true;
        }
        let (faces, openings) = run(&inside, &defended, &ways, neighbours);
        let lines: Vec<Vec<Position>> = faces.iter().filter_map(segment).map(Vec::from).collect();
        let Some(first) = faces.first() else {
            continue;
        };
        let mut attributes = crate::features::records::Attributes::new();
        attributes.insert("raisedInRound".into(), wall.round.into());
        attributes.insert("enclosedCells".into(), wall.inside.len().into());
        attributes.insert("gates".into(), openings.len().into());
        let key = format!("city-wall-{index}");
        let feature = generated(
            state,
            Record {
                key: &key,
                name: "City wall",
                kind: "cityWall",
                layer: "structures",
                geometry: Geometry::MultiLineString { coordinates: lines },
                attributes,
            },
        )?;
        let mut place = Place::at(
            Kind::CityWall,
            first.inside,
            faces.iter().map(|f| f.inside).collect(),
        );
        place.id = key;
        place.feature = Some(feature);
        walls.push(place);
        for (number, gate) in openings.iter().enumerate() {
            let Some([a, b]) = segment(gate) else {
                continue;
            };
            let ([ax, ay, _], [bx, by, _]) = (a.coordinates(), b.coordinates());
            let mut attributes = crate::features::records::Attributes::new();
            attributes.insert("wall".into(), index.into());
            let key = format!("city-gate-{index}-{number}");
            let feature = generated(
                state,
                Record {
                    key: &key,
                    name: "City gate",
                    kind: "cityGate",
                    layer: "structures",
                    geometry: Geometry::Point {
                        coordinates: Position::xy((ax + bx) / 2., (ay + by) / 2.),
                    },
                    attributes,
                },
            )?;
            let mut place = Place::at(Kind::CityGate, gate.inside, vec![gate.inside]);
            place.id = key;
            place.feature = Some(feature);
            gates.push(place);
        }
    }
    Ok((walls, gates))
}

/// A city's places of one catalogue kind, each with its published record.
pub(crate) fn places(
    state: &State,
    kind: crate::field::poi::kinds::Kind,
) -> io::Result<Vec<crate::field::poi::values::Place>> {
    use crate::field::poi::kinds::Kind;
    match kind {
        Kind::CityWall => wall_places(state).map(|(walls, _)| walls),
        Kind::CityGate => wall_places(state).map(|(_, gates)| gates),
        Kind::CityPlace => plan::place_records(state),
        Kind::CityDistrict => plan::district_records(state),
        Kind::MajorWork => plan::work_records(state),
        _ => Ok(Vec::new()),
    }
}

/// The city's last step after its growth rounds: hot spots raise prominent places, districts
/// are cut round the strongest centres, and the city's major works find their sites.
pub(super) fn plan_step(input: Rc<Inputs>) -> Operation {
    let seed = input.seed;
    crate::execution::Command::with_inputs(
        "refinement.city-plan",
        crate::execution::CommandKind::Event,
        vec![],
        move |scope, _: &Occurrence| {
            if scope.state().scope.city.is_none() {
                return Ok(());
            }
            let selection = template(scope.state_mut(), seed)?;
            plan::plan(scope.state_mut(), &selection, seed)?;
            Ok(())
        },
    )
}

/// A deterministic draw in [0, 1) for a city decision at a round.
fn draw(seed: i32, round: usize, salt: u32) -> f64 {
    let mixed = (seed as u32)
        .wrapping_mul(2_654_435_761)
        .wrapping_add((round as u32).wrapping_mul(40_503))
        .wrapping_add(salt.wrapping_mul(2_246_822_519));
    f64::from(mixed >> 8) / f64::from(1u32 << 24)
}

/// The city's template, chosen once from the city's own site and kept for later rounds.
fn template(state: &mut State, seed: i32) -> Result<Selection, ExecutionError> {
    if let Some(selection) = state
        .regional
        .as_ref()
        .and_then(|r| r.city.template.clone())
    {
        return Ok(selection);
    }
    let site = survey(state)?;
    let selection = Selection::choose(site, draw(seed, 0, 1));
    if let Some(regional) = state.regional.as_mut() {
        regional.city.template = Some(selection.clone());
    }
    Ok(selection)
}

/// People a city needs before it can raise a wall round itself.
const BUILDERS: f64 = 20_000.;
/// Population at which a city's builders no longer limit its walls.
const WALLED_CITY: f64 = 80_000.;
/// Share of built land outside every wall at which a city considers a new one.
const OUTGROWN: f64 = 0.35;

/// Walls rise where their causes meet: a template that keeps a seat of power or guards its
/// ground, a city large enough to build them, and built land standing unwalled. The ruling
/// compound or citadel a template encloses gets its own inner wall in the first round.
fn raise_walls(
    state: &mut State,
    selection: &Selection,
    seed: i32,
    round: usize,
) -> io::Result<()> {
    use crate::town::walls::{enclosed, outgrown, Wall};
    let (city_wall, citadel_wall) = {
        let field = state.field();
        let mesh = field.mesh();
        let [ox, oy] = mesh.origin();
        let at = |cell| {
            let [x, y] = mesh.position(cell);
            [x + ox, y + oy]
        };
        let centre = selection.site.centre;
        let built_band = field.people().view(HumanField::Layer(LayerId::BuiltUp));
        let mut built = Vec::with_capacity(mesh.len());
        let mut open = Vec::with_capacity(mesh.len());
        let mut people = 0.;
        let mut heart = (f64::INFINITY, 0);
        for cell in 0..mesh.len() {
            built.push(built_band.get(cell)?.clamp(0., 1.));
            open.push(habitable(field, cell)?);
            people += field.people().people(cell)? * mesh.area(cell) / 1e6;
            let p = at(cell);
            let d = (p[0] - centre[0]).hypot(p[1] - centre[1]);
            if d < heart.0 && open[cell] {
                heart = (d, cell);
            }
        }
        let walls = &state
            .regional
            .as_ref()
            .map_or(&[][..], |r| &r.city.walls[..]);
        let need = if walls.is_empty() {
            1.
        } else {
            let share = outgrown(walls, &built);
            if share < OUTGROWN {
                0.
            } else {
                share
            }
        };
        let inclination = if selection.enclosed_seat().is_some() {
            0.9
        } else if selection.site.guarded || selection.site.seat || selection.site.upper.is_some() {
            0.6
        } else {
            0.35
        };
        let able = ((people - BUILDERS) / (WALLED_CITY - BUILDERS)).clamp(0., 1.);
        let raise = draw(seed, round, 2) < inclination * need * able;
        let city = raise.then(|| {
            enclosed(&built, &open, heart.1, |c| {
                [0, 1, 2].map(|edge| mesh.neighbor(c, edge))
            })
        });
        // A template's enclosed seat is walled on its own in the first round.
        let citadel = (round <= 1 && walls.is_empty())
            .then(|| {
                let anchor = selection.site.point(selection.enclosed_seat()?)?;
                let radius = selection.enclosure_radius(selection.quarter())?;
                Some(
                    (0..mesh.len())
                        .map(|cell| {
                            let p = at(cell);
                            open[cell] && (p[0] - anchor[0]).hypot(p[1] - anchor[1]) <= radius
                        })
                        .collect::<Vec<_>>(),
                )
            })
            .flatten();
        (city, citadel)
    };
    let Some(regional) = state.regional.as_mut() else {
        return Ok(());
    };
    for cells in [citadel_wall, city_wall].into_iter().flatten() {
        let inside: Vec<u32> = (0..cells.len())
            .filter(|&c| cells[c])
            .map(|c| c as u32)
            .collect();
        if !inside.is_empty() {
            regional.city.walls.push(Wall { round, inside });
        }
    }
    Ok(())
}

/// Founding evidence read at city scale: the city's centre, its usable shore and levels, the
/// ways that reach its core, worked land around it and the magic practised there.
fn survey(state: &State) -> io::Result<SiteEvidence> {
    let field = state.field();
    let mesh = field.mesh();
    let bounds = state
        .spatial
        .bounds(&state.scope.footprint)
        .map_err(io::Error::other)?;
    // A city map is centred on its settlement; its extent is a ring about it.
    let centre = [(bounds.0 + bounds.2) / 2., (bounds.1 + bounds.3) / 2.];
    let core = (bounds.2 - bounds.0).min(bounds.3 - bounds.1) / 2. / SURROUNDINGS;
    let [ox, oy] = mesh.origin();
    let at = |cell| {
        let [x, y] = mesh.position(cell);
        [x + ox, y + oy]
    };
    let distance = |p: [f64; 2]| (p[0] - centre[0]).hypot(p[1] - centre[1]);
    let elevation = field.ground().view(GroundField::Elevation);
    let farmed = field.people().view(HumanField::Layer(LayerId::Farmland));
    let ways = field.people().view(HumanField::KeptLine);
    let mut evidence = SiteEvidence {
        centre,
        ..Default::default()
    };
    let mut relief = Relief::default();
    let mut farmland = 0.;
    let mut approaches: Vec<[f64; 2]> = Vec::new();
    let mut nearest = None;
    for cell in 0..mesh.len() {
        let p = at(cell);
        let d = distance(p);
        if nearest.is_none_or(|(best, _)| d < best) {
            nearest = Some((d, cell));
        }
        if d > core {
            continue;
        }
        if !habitable(field, cell)? {
            if evidence.shore.is_none_or(|s| distance(s) > d) {
                evidence.shore = Some(p);
            }
            continue;
        }
        relief.see(elevation.get(cell)?, p);
        farmland += farmed.get(cell)?;
        // Ways reaching the outer core are the city's approaches, one per direction.
        if d > 0.7 * core && ways.get(cell)? > 0. && new_direction(&approaches, centre, p) {
            approaches.push(p);
        }
    }
    if relief.high.0 - relief.low.0 > LEVELS {
        evidence.upper = Some(relief.high.1);
        evidence.lower = Some(relief.low.1);
    }
    evidence.approaches = approaches;
    evidence.cultivated = farmland > 0.;
    if let Some((_, cell)) = nearest {
        practices(field, cell, &mut evidence)?;
    }
    Ok(evidence)
}
/// The highest and lowest dry ground of the city's core, with where each lies.
struct Relief {
    high: (f64, [f64; 2]),
    low: (f64, [f64; 2]),
}
impl Default for Relief {
    fn default() -> Self {
        Self {
            high: (f64::NEG_INFINITY, [0.; 2]),
            low: (f64::INFINITY, [0.; 2]),
        }
    }
}
impl Relief {
    fn see(&mut self, height: f64, p: [f64; 2]) {
        if height > self.high.0 {
            self.high = (height, p);
        }
        if height < self.low.0 {
            self.low = (height, p);
        }
    }
}
/// A point leaves the centre in a direction no earlier approach takes.
fn new_direction(approaches: &[[f64; 2]], centre: [f64; 2], p: [f64; 2]) -> bool {
    let heading = (p[1] - centre[1]).atan2(p[0] - centre[0]);
    approaches.iter().all(|a| {
        let other = (a[1] - centre[1]).atan2(a[0] - centre[0]);
        let gap = (heading - other).rem_euclid(std::f64::consts::TAU);
        gap.min(std::f64::consts::TAU - gap) > 0.6
    })
}
/// Each magical system's medium and practice at the city's centre.
fn practices(field: &Field, cell: usize, evidence: &mut SiteEvidence) -> io::Result<()> {
    for (i, craft) in crafts::CRAFTS.iter().copied().enumerate() {
        evidence.medium[i] = crafts::medium_at(field, craft, cell)?;
        evidence.practice[i] = crafts::practised(field, craft, cell)?;
    }
    Ok(())
}
