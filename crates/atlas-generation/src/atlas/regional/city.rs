//! A city map's own steps, inside every refinement round: after the round's people pass the
//! city's people move toward where it grows (`field::people::growth`), guided by the
//! settlement template the city selects at its own scale and drawn to its prominent places and
//! works; walls rise; and hot-spot towns are founded and advanced by the town development
//! steps (`spots`). The next round's refinement and people pass read the result. Districts are
//! cut once the rounds are done (`plan`).
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
mod features;
mod plan;
pub(super) mod spots;

/// Relief across the core that makes two usable levels of one city, in metres.
const LEVELS: f64 = 30.;

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
                    places: places_at(scope.state(), mesh.len()),
                }
            };
            scope.project(&field).run(&operation, &guidance)?;
            trace_people(scope.state(), "after city growth")?;
            let round = scope.state().regional.as_ref().map_or(0, |r| r.round);
            raise_walls(scope.state_mut(), &selection, seed, round)?;
            Ok(())
        },
    )
}

/// Slope at which ground defends a wall's face on its own, rise over run.
const DEFENDING_SLOPE: f64 = 0.4;

type Faces = Vec<crate::town::walls::Face>;
/// Each of the city's walls as it runs: the faces it stands along and the faces its gates
/// open on.
fn wall_runs(state: &State) -> io::Result<Vec<(Faces, Faces)>> {
    use crate::town::walls::run;
    let Some(regional) = state.regional.as_ref().filter(|r| !r.city.walls.is_empty()) else {
        return Ok(Vec::new());
    };
    let field = state.field();
    let mesh = field.mesh();
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
    // The hot-spot towns' thoroughfares are the city's own ways: a wall opens a gate on them.
    for street in state.town.towns.iter().flat_map(|t| t.streets()) {
        for cell in spots::cells_along(mesh, &street.points) {
            ways[cell] = 1.;
        }
    }
    let neighbours = |cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge));
    let mut runs = Vec::new();
    for wall in &regional.city.walls {
        let mut inside = vec![false; mesh.len()];
        for &cell in &wall.inside {
            inside[cell as usize] = true;
        }
        runs.push(run(&inside, &defended, &ways, neighbours));
    }
    Ok(runs)
}
/// A wall face's two ends, in map coordinates.
fn segment(
    mesh: &crate::lattice::TriangularLattice,
    face: &crate::town::walls::Face,
) -> Option<[[f64; 2]; 2]> {
    let [ox, oy] = mesh.origin();
    let edge = (0..3).find(|&e| mesh.neighbor(face.inside, e) == Some(face.outside))?;
    let ([cx, cy], [nx, ny], length) = mesh.physical_face(face.inside, edge)?;
    let [tx, ty] = [-ny * length / 2., nx * length / 2.];
    Some([[cx - tx + ox, cy - ty + oy], [cx + tx + ox, cy + ty + oy]])
}
/// The city's walls where they stand, gates left open: lines the towns of a city map cannot
/// build or walk through.
pub(crate) fn wall_lines(state: &State) -> io::Result<Vec<[[f64; 2]; 2]>> {
    let mesh = state.field().mesh();
    Ok(wall_runs(state)?
        .iter()
        .flat_map(|(faces, _)| faces.iter().filter_map(|face| segment(mesh, face)))
        .collect())
}

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
    use atlas_map::{Geometry, Position};
    let Some(regional) = state.regional.as_ref() else {
        return Ok((Vec::new(), Vec::new()));
    };
    let mesh = state.field().mesh();
    let position = |[x, y]: [f64; 2]| Position::xy(x, y);
    let segment = |face: &crate::town::walls::Face| segment(mesh, face).map(|s| s.map(position));
    let mut walls = Vec::new();
    let mut gates = Vec::new();
    for (index, (wall, (faces, openings))) in regional
        .city
        .walls
        .iter()
        .zip(wall_runs(state)?)
        .enumerate()
    {
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
    let places = match kind {
        Kind::CityWall => wall_places(state).map(|(walls, _)| walls),
        Kind::CityGate => wall_places(state).map(|(_, gates)| gates),
        Kind::CityPlace => plan::place_records(state),
        Kind::CityDistrict => plan::district_records(state),
        Kind::MajorWork => plan::work_records(state),
        Kind::CityThoroughfare => features::thoroughfare_records(state),
        Kind::CityBlock => features::block_records(state),
        _ => Ok(Vec::new()),
    }?;
    let city = state.regional.as_ref().map(|r| &r.city);
    trace(
        "city.publish",
        serde_json::json!({
            "kind": kind.as_str(),
            "records": places.len(),
            "towns": state.town.towns.len(),
            "works": city.map_or(0, |c| c.works.len()),
            "districtCells": city.map_or(0, |c| c.districts.iter().filter(|&&l| l != u8::MAX).count()),
        }),
    );
    Ok(places)
}

/// The settlement a city map was opened at, as its captured record tells it.
pub(super) struct Settlement {
    pub(super) centre: [f64; 2],
    /// The radius of its built ground, at least the least a city map opens on.
    pub(super) built_radius: f64,
    /// Its census.
    pub(super) people: Option<f64>,
}
/// The city map's settlement, read by the identity its captured record took.
pub(super) fn settlement(state: &State) -> io::Result<Option<Settlement>> {
    use atlas_map::Geometry;
    let Some(city) = state.scope.city.as_ref() else {
        return Ok(None);
    };
    let found = match state.records.source_features.as_deref() {
        Some(source) => source.get(city.settlement)?,
        None => state.records.features.get(city.settlement)?,
    };
    let Some(feature) = found else {
        return Ok(None);
    };
    let Geometry::Point { coordinates } = &feature.geometry else {
        return Ok(None);
    };
    let [x, y, _] = coordinates.coordinates();
    let number = |key: &str| {
        feature
            .attributes
            .get(key)
            .and_then(serde_json::Value::as_f64)
    };
    let built = number("builtKm2").unwrap_or(0.).max(0.);
    Ok(Some(Settlement {
        centre: [x, y],
        built_radius: (built * 1e6 / std::f64::consts::PI)
            .sqrt()
            .max(crate::town::city::LEAST_RADIUS / crate::town::city::SURROUNDINGS),
        people: number("settlementPopulation").or_else(|| number("population")),
    }))
}

/// A city map's decisions, written to the server log when `ATLAS_TRACE_CITY` is set, as town
/// decisions are under `ATLAS_TRACE_TOWN`.
pub(super) fn trace(event: &str, details: serde_json::Value) {
    if std::env::var_os("ATLAS_TRACE_CITY").is_some() {
        eprintln!(
            "{}",
            serde_json::json!({ "event": event, "details": details })
        );
    }
}

/// Where a city map's people stand at one stage, traced as `city.people`: how many, inside
/// the published outline and in the context band; their centre of mass from the settlement's
/// centre; their shares by distance in built radii and by compass quarter; the share on the
/// outline's edge cells; the most crowded cells; and the map's extent about the centre.
pub(super) fn trace_people(state: &State, stage: &str) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_CITY").is_none() || state.scope.city.is_none() {
        return Ok(());
    }
    let Some(settlement) = settlement(state)? else {
        return Ok(());
    };
    let field = state.field();
    let mesh = field.mesh();
    let [ox, oy] = mesh.origin();
    let n = mesh.len();
    let [cx, cy] = settlement.centre;
    let at: Vec<[f64; 2]> = (0..n)
        .map(|cell| {
            let [x, y] = mesh.position(cell);
            [x + ox - cx, y + oy - cy]
        })
        .collect();
    let positions: Vec<atlas_map::Position> = at
        .iter()
        .map(|&[x, y]| atlas_map::Position::xy(x + cx, y + cy))
        .collect();
    let outline = state
        .scope
        .outline
        .as_ref()
        .unwrap_or(&state.scope.footprint);
    let inside = state
        .spatial
        .covers_points(outline, &positions)
        .map_err(io::Error::other)?;
    let mut count = Vec::with_capacity(n);
    for cell in 0..n {
        count.push(field.people().people(cell)?.max(0.) * mesh.area(cell) / 1e6);
    }
    let edge = |cell: usize| {
        inside[cell] && (0..3).any(|e| mesh.neighbor(cell, e).is_none_or(|next| !inside[next]))
    };
    let (mut total, mut within, mut on_edge) = (0., 0., 0.);
    let (mut sx, mut sy) = (0., 0.);
    let mut rings = [0.; 4];
    // East, north, west, south of the settlement's centre.
    let mut quarters = [0.; 4];
    for cell in 0..n {
        let people = count[cell];
        total += people;
        if !inside[cell] {
            continue;
        }
        within += people;
        let [x, y] = at[cell];
        sx += people * x;
        sy += people * y;
        let radii = x.hypot(y) / settlement.built_radius;
        rings[(radii as usize).min(3)] += people;
        let angle = y.atan2(x).to_degrees();
        let quarter = match angle {
            a if (-45. ..45.).contains(&a) => 0,
            a if (45. ..135.).contains(&a) => 1,
            a if (-135. ..-45.).contains(&a) => 3,
            _ => 2,
        };
        quarters[quarter] += people;
        if edge(cell) {
            on_edge += people;
        }
    }
    let share = |v: f64| (v / within.max(f64::EPSILON) * 1000.).round() / 1000.;
    let mut crowded: Vec<usize> = (0..n).filter(|&c| inside[c]).collect();
    crowded.sort_by(|&a, &b| count[b].total_cmp(&count[a]));
    let top: Vec<_> = crowded
        .iter()
        .take(5)
        .map(|&c| {
            serde_json::json!({"at":[at[c][0].round(), at[c][1].round()],
            "people":count[c].round(), "perKm2":field.people().people(c).unwrap_or(0.).round(),
            "edge":edge(c)})
        })
        .collect();
    let extent = at
        .iter()
        .fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |e, &[x, y]| {
            [e[0].min(x), e[1].min(y), e[2].max(x), e[3].max(y)]
        });
    trace(
        "city.people",
        serde_json::json!({
            "stage": stage,
            "round": state.regional.as_ref().map_or(0, |r| r.round),
            "total": total.round(),
            "inside": within.round(),
            "band": (total - within).round(),
            "census": settlement.people,
            "builtRadius": settlement.built_radius.round(),
            "centreOfMass": [(sx / within.max(f64::EPSILON)).round(), (sy / within.max(f64::EPSILON)).round()],
            "byRadii": rings.map(share),
            "eastNorthWestSouth": quarters.map(share),
            "edgeShare": share(on_edge),
            "crowded": top,
            "extentAboutCentre": extent.map(f64::round),
        }),
    );
    Ok(())
}

/// Where the city's prominent places and works stand, as each cell's draw on growth: 1 at the
/// place, a half beside it.
fn places_at(state: &State, n: usize) -> Vec<f64> {
    let mut draw = vec![0.; n];
    let Some(city) = state.regional.as_ref().map(|r| &r.city) else {
        return draw;
    };
    let mesh = state.field().mesh();
    let cells = city
        .places
        .iter()
        .map(|p| p.spot)
        .chain(city.works.iter().map(|&(_, cell)| cell as usize));
    for cell in cells.filter(|&c| c < n) {
        for next in (0..3).filter_map(|edge| mesh.neighbor(cell, edge)) {
            draw[next] = f64::max(draw[next], 0.5);
        }
        draw[cell] = 1.;
    }
    draw
}

/// A city step that runs only on a city map, with the city's template.
fn city_step(
    id: &'static str,
    seed: i32,
    run: fn(&mut State, &Selection, i32) -> io::Result<()>,
) -> Operation {
    crate::execution::Command::with_inputs(
        id,
        crate::execution::CommandKind::Event,
        vec![],
        move |scope, _: &Occurrence| {
            if scope.state().scope.city.is_none() {
                return Ok(());
            }
            let selection = template(scope.state_mut(), seed)?;
            run(scope.state_mut(), &selection, seed)?;
            Ok(())
        },
    )
}

/// Each round's hot spots: towns founded where the fields concentrate, and the city's works
/// sited and taken up by the towns beside them.
pub(super) fn spots_step(input: Rc<Inputs>) -> Operation {
    city_step("refinement.city-spots", input.seed, spots::found)
}

/// After each round's town steps: the landmarks the hot-spot towns built, and the towns'
/// blocks and thoroughfares taken up by the people layers, so the next round's refinement and
/// growth start from the city the towns built.
pub(super) fn places_step(input: Rc<Inputs>, field: &Projection<State, Field>) -> Operation {
    let field = field.clone();
    let operation = crate::field::people::quarters::operation(Rc::new(Field::human_operations()));
    let seed = input.seed;
    crate::execution::Command::with_inputs(
        "refinement.city-places",
        crate::execution::CommandKind::Event,
        vec![],
        move |scope, _: &Occurrence| {
            if scope.state().scope.city.is_none() {
                return Ok(());
            }
            let selection = template(scope.state_mut(), seed)?;
            spots::record(scope.state_mut(), &selection)?;
            let quarters = spots::quarters(scope.state(), &selection)?;
            trace_people(scope.state(), "before quarters")?;
            scope.project(&field).run(&operation, &quarters)?;
            trace_people(scope.state(), "after quarters")?;
            Ok(())
        },
    )
}

/// The city's last step after its rounds: districts cut round its hot-spot towns.
pub(super) fn plan_step(input: Rc<Inputs>) -> Operation {
    city_step("refinement.city-plan", input.seed, |state, selection, _| {
        plan::plan(state, selection)
    })
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
    let Some(Settlement {
        centre,
        built_radius,
        ..
    }) = settlement(state)?
    else {
        return Err(io::Error::other(
            "A city map holds the settlement it was opened at",
        ));
    };
    let core = built_radius;
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
