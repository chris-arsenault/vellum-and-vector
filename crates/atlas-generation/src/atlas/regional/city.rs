//! City guidance binds street edges, prominent places and works into household placement.
//! Walls and major works develop during the society rounds.
use super::work::{Inputs, Occurrence, Operation};
use crate::{
    atlas::state::State,
    execution::ExecutionError,
    field::{
        people::{
            contract::{Absent, Condition, Source},
            crafts, growth,
            work::habitable,
        },
        Field,
    },
    human::{catalogue::LayerId, HumanField},
    rock::ground::GroundField,
    town::templates::{Selection, SiteEvidence},
};
use std::{io, rc::Rc};
mod works;

/// Relief across the core that makes two usable levels of one city, in metres.
const LEVELS: f64 = 30.;

pub(crate) fn start_people_pass(
    operation: crate::execution::Command<
        State,
        crate::field::people::pass::Inputs<crate::field::people::goods::TradeStrategy>,
    >,
    seed: i32,
) -> crate::execution::Command<
    State,
    crate::field::people::pass::Inputs<crate::field::people::goods::TradeStrategy>,
> {
    crate::execution::Command::with_inputs(
        "human.land.trade",
        crate::execution::CommandKind::Work,
        vec![],
        move |scope,
              input: &crate::field::people::pass::Inputs<
            crate::field::people::goods::TradeStrategy,
        >| {
            let mut input = input.clone();
            if scope.state().scope.city.is_some() {
                let selection = template(scope.state_mut(), seed, CITY_ORIGIN)?;
                let state = scope.state();
                let mesh = state.field().mesh();
                let [ox, oy] = mesh.origin();
                let city = &state
                    .regional
                    .as_ref()
                    .ok_or_else(|| io::Error::other("City roads require regional state"))?
                    .city;
                let urban = &city.urban;
                input.city = Some(Rc::new(growth::Guidance {
                    dwelling: (0..mesh.len())
                        .map(|cell| urban.household_density(cell))
                        .collect(),
                    enclosed: (0..mesh.len())
                        .map(|cell| crate::town::walls::protection(&city.walls, cell))
                        .collect(),
                    census: input.parent.census.clone(),
                    weight: (0..mesh.len())
                        .map(|cell| {
                            if urban.housing_reserved(cell) {
                                return 0.;
                            }
                            let [x, y] = mesh.position(cell);
                            selection.city_affinity([x + ox, y + oy])
                        })
                        .collect(),
                    places: places_at(state, mesh.len()),
                    road_access: urban.road_access().to_vec(),
                    crossings: urban.bridge_links(mesh),
                }));
            }
            scope.run(&operation, &input)
        },
    )
}

pub(crate) fn inherit_policy(
    state: &mut State,
    seed: i32,
    (requested, civic, craft): (
        Option<crate::town::templates::Template>,
        Option<crate::town::templates::civic::Civic>,
        Option<i32>,
    ),
) -> Result<(), ExecutionError> {
    use crate::town::templates::Template;
    let id = state
        .scope
        .city
        .as_ref()
        .ok_or_else(|| io::Error::other("City policy requires its captured settlement"))?
        .settlement;
    let record = match state.records.source_features.as_deref() {
        Some(source) => source.get(id)?,
        None => state.records.features.get(id)?,
    };
    if let Some(policy) = record
        .as_ref()
        .and_then(|r| r.attributes.get("templatePolicy"))
    {
        let mut saved: crate::town::templates::Selection =
            serde_json::from_value(policy.clone()).map_err(io::Error::other)?;
        saved.civic = civic.or(saved.civic);
        saved.crafts = craft.map_or(saved.crafts, |asked| vec![asked]);
        saved.fortune = saved
            .fortune
            .or_else(|| Some(crate::town::walls::fortune(&id.to_bytes(), seed)));
        state.regional.as_mut().unwrap().city.template = Some(saved);
        return Ok(());
    }
    let saved = record
        .as_ref()
        .and_then(|r| r.attributes.get("settlementTemplate"))
        .and_then(|v| v.as_str())
        .and_then(Template::from_name);
    let mut selection = template(state, seed, CITY_ORIGIN)?;
    if let Some(chosen) = saved.or(requested) {
        if saved.is_some() || selection.ranked.iter().any(|c| c.template == chosen) {
            selection.selected = chosen;
        }
    }
    selection.civic = civic.or(selection.civic);
    selection.crafts = craft.map_or(selection.crafts, |asked| vec![asked]);
    state.regional.as_mut().unwrap().city.template = Some(selection);
    Ok(())
}

pub(crate) fn wall_lines(state: &State) -> io::Result<Vec<[[f64; 2]; 2]>> {
    Ok(state
        .regional
        .iter()
        .flat_map(|r| &r.city.walls)
        .flat_map(|w| w.lines.iter().copied())
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
    let position = |[x, y]: [f64; 2]| Position::xy(x, y);
    let mut walls = Vec::new();
    let mut gates = Vec::new();
    for (index, wall) in regional.city.walls.iter().enumerate() {
        let lines: Vec<Vec<Position>> = wall
            .lines
            .iter()
            .map(|s| s.map(position).to_vec())
            .collect();
        let Some(&first) = wall.inside.first().filter(|_| !lines.is_empty()) else {
            continue;
        };
        let mut attributes = crate::features::records::Attributes::new();
        if let Some(era) = &wall.era {
            attributes.insert("builtInEra".into(), era.clone().into());
        }
        attributes.insert("outgrown".into(), wall.outgrown.into());
        attributes.insert("condition".into(), wall.condition().into());
        attributes.insert("standingShare".into(), wall.standing_share().into());
        attributes.insert("raisedInRound".into(), wall.round.into());
        attributes.insert("enclosedCells".into(), wall.inside.len().into());
        attributes.insert("gates".into(), wall.gates.len().into());
        attributes.insert("enclosureAreaM2".into(), wall.area.into());
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
            first as usize,
            wall.inside.iter().map(|c| *c as usize).collect(),
        );
        place.id = key;
        place.feature = Some(feature);
        walls.push(place);
        for (number, &[x, y]) in wall.gates.iter().enumerate() {
            let Some(cell) =
                crate::field::refinement::courses::cell_at(state.field().mesh(), [x, y])
            else {
                continue;
            };
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
                        coordinates: Position::xy(x, y),
                    },
                    attributes,
                },
            )?;
            let mut place = Place::at(Kind::CityGate, cell, vec![cell]);
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
        Kind::MajorWork => works::work_records(state),
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
        }),
    );
    Ok(places)
}

/// The settlement a city map was opened at, as its captured record tells it.
pub(crate) struct Settlement {
    pub(crate) centre: [f64; 2],
    /// The radius of its built ground, at least the least a city map opens on.
    pub(super) built_radius: f64,
    /// Its census.
    pub(crate) people: Option<f64>,
}
/// The city map's settlement, read by the identity its captured record took.
pub(crate) fn captured_settlement(state: &State) -> io::Result<Option<crate::features::Feature>> {
    let Some(city) = state.scope.city.as_ref() else {
        return Ok(None);
    };
    match state.records.source_features.as_deref() {
        Some(source) => source.get(city.settlement),
        None => state.records.features.get(city.settlement),
    }
}
/// Earliest recorded settlement large enough to have reached and supported this site.
pub(crate) fn occupation_era(
    town: &crate::features::Feature,
    radius: f64,
    distance: f64,
    support: f64,
) -> Option<&str> {
    let history = town.attributes.get("history")?.as_array()?;
    let population = town.attributes.get("settlementPopulation")?.as_f64()?;
    let required = support.max(population * (distance / radius.max(1.)).powi(2));
    history
        .iter()
        .find(|era| {
            era.get("townsfolk")
                .and_then(|p| p.as_f64())
                .is_some_and(|p| p >= required)
        })
        .and_then(|era| era.get("era")?.as_str())
}
pub(crate) fn settlement(state: &State) -> io::Result<Option<Settlement>> {
    use atlas_map::Geometry;
    let Some(feature) = captured_settlement(state)? else {
        return Ok(None);
    };
    let coordinates = match &feature.geometry {
        Geometry::Point { coordinates } => *coordinates,
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => state
            .spatial
            .interior_position(&feature.geometry)
            .map_err(io::Error::other)?,
        _ => return Ok(None),
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
        built_radius: (built * 1e6 / std::f64::consts::PI).sqrt().max(600.), // Minimum radius of the template's site survey, in metres.
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

/// Compare a saved map's footprint at a society step, before expensive downstream work.
pub(crate) fn trace_footprint(state: &State, stage: &str) -> io::Result<()> {
    let Some(path) = std::env::var_os("ATLAS_TRACE_PEOPLE_FOOTPRINT") else {
        return Ok(());
    };
    #[derive(serde::Deserialize)]
    struct MapCut {
        footprint: atlas_map::Geometry,
    }
    let cut: MapCut = serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(path)?))?;
    let field = state.field();
    let mesh = field.mesh();
    let cells: Vec<_> = (0..mesh.len())
        .map(|i| crate::lattice::hexes::triangle_polygon(mesh, i))
        .collect();
    let areas = state
        .spatial
        .intersection_areas(&cut.footprint, &cells)
        .map_err(io::Error::other)?;
    let mut heads = 0.;
    for (i, area) in areas.into_iter().enumerate() {
        heads += field.people().people(i)? * area / 1e6;
    }
    eprintln!(
        "{}",
        serde_json::json!({"event":"people.footprint","stage":stage,"residents":heads.round()})
    );
    Ok(())
}

/// Where a city map's people stand at one stage, traced as `city.people`: how many, inside
/// the published outline and in the context band; their centre of mass from the settlement's
/// centre; their shares by distance in built radii and by compass quarter; the share on the
/// outline's edge cells; the most crowded cells; and the map's extent about the centre.
pub(crate) fn trace_people(state: &State, stage: &str) -> io::Result<()> {
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
    let cells = city.works.iter().map(|work| work.cell as usize);
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
            let selection = template(scope.state_mut(), seed, CITY_ORIGIN)?;
            run(scope.state_mut(), &selection, seed)?;
            Ok(())
        },
    )
}

/// Site the city's existing major works before the later rounds distribute residents.
pub(super) fn works_step(input: Rc<Inputs>) -> Operation {
    city_step("refinement.city-works", input.seed, works::site)
}

#[derive(Clone, Copy)]
enum CitySource {
    CapturedSettlement,
}
impl Source for CitySource {
    type Value = Settlement;
}

const CITY_ORIGIN: Condition<CitySource> = Condition::From {
    source: CitySource::CapturedSettlement,
    absent: Absent::Error("A city map holds the settlement it was opened at"),
};

/// A deterministic draw in [0, 1) for a city decision at a round.
fn draw(seed: i32, round: usize, salt: u32) -> f64 {
    let mixed = (seed as u32)
        .wrapping_mul(2_654_435_761)
        .wrapping_add((round as u32).wrapping_mul(40_503))
        .wrapping_add(salt.wrapping_mul(2_246_822_519));
    f64::from(mixed >> 8) / f64::from(1u32 << 24)
}

/// The city's template, chosen once from the city's own site and kept for later rounds.
fn template(
    state: &mut State,
    seed: i32,
    origin: Condition<CitySource>,
) -> Result<Selection, ExecutionError> {
    if let Some(selection) = state
        .regional
        .as_ref()
        .and_then(|r| r.city.template.clone())
    {
        return Ok(selection);
    }
    let Some(settlement) = origin.bind(|source| match source {
        CitySource::CapturedSettlement => settlement(state),
    })?
    else {
        return Err(io::Error::other("City template requires a settlement site").into());
    };
    let mut site = survey(state, settlement, false)?;
    let city = state.scope.city.as_ref().unwrap();
    let saved = match state.records.source_features.as_deref() {
        Some(source) => source.get(city.settlement)?,
        None => state.records.features.get(city.settlement)?,
    };
    if let Some(place) = saved {
        let guarded = site.guarded
            || place.attributes.get("fortress").and_then(|v| v.as_bool()) == Some(true);
        let story = crate::atlas::town::site::story(&place, site.approaches.len(), guarded);
        site.guarded = story.guarded;
        site.seat = story.seat;
        site.old = story.old();
        site.planned = story.planned();
    }
    // The order is drawn on a roll of the settlement's own, apart from the template's.
    let own = state.scope.city.as_ref().unwrap().settlement.to_bytes();
    let civic = crate::town::templates::civic::Civic::roll(&own, seed);
    let craft = crate::town::templates::craft_roll(&own, seed);
    let selection = Selection::choose(site, draw(seed, 0, 1))
        .with_civic(None, civic)
        .with_craft(None, craft)
        .with_fortune(crate::town::walls::fortune(&own, seed));
    if let Some(regional) = state.regional.as_mut() {
        regional.city.template = Some(selection.clone());
    }
    Ok(selection)
}

fn survey(state: &State, settlement: Settlement, whole_city: bool) -> io::Result<SiteEvidence> {
    let field = state.field();
    let mesh = field.mesh();
    let Settlement {
        centre,
        built_radius,
        ..
    } = settlement;
    let core = built_radius;
    let [ox, oy] = mesh.origin();
    let at = |cell| {
        let [x, y] = mesh.position(cell);
        [x + ox, y + oy]
    };
    let distance = |p: [f64; 2]| (p[0] - centre[0]).hypot(p[1] - centre[1]);
    let city_ground = survey_footprint(state, whole_city, at)?;
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
        if !city_ground.as_ref().map_or(d <= core, |cells| cells[cell]) {
            continue;
        }
        let dry = habitable(field, cell)?;
        let terrain = if dry {
            crate::town::ground::FREE
        } else {
            crate::town::ground::WATER
        };
        crate::atlas::town::founding_site::observe_landscape(
            &mut evidence.works,
            field,
            cell,
            terrain,
            p,
        )?;
        if !dry {
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
    survey_city_features(state, centre, core, city_ground.as_deref(), &mut evidence)?;
    evidence.approaches = approaches;
    evidence.cultivated = farmland > 0.;
    if let Some((_, cell)) = nearest {
        practices(field, cell, &mut evidence)?;
    }
    Ok(evidence)
}

fn survey_footprint(
    state: &State,
    whole_city: bool,
    at: impl Fn(usize) -> [f64; 2],
) -> io::Result<Option<Vec<bool>>> {
    let mesh = state.field().mesh();
    if whole_city {
        let points: Vec<_> = (0..mesh.len())
            .map(|c| {
                let [x, y] = at(c);
                atlas_map::Position::xy(x, y)
            })
            .collect();
        Ok(Some(
            state
                .spatial
                .covers_points(state.scope.settled_outline(), &points)
                .map_err(io::Error::other)?,
        ))
    } else {
        Ok(None)
    }
}

fn survey_city_features(
    state: &State,
    centre: [f64; 2],
    core: f64,
    city_ground: Option<&[bool]>,
    evidence: &mut SiteEvidence,
) -> io::Result<()> {
    let field = state.field();
    let mesh = field.mesh();
    let distance = |[x, y]: [f64; 2]| (x - centre[0]).hypot(y - centre[1]);
    let source = state.records.source_features.as_deref();
    let selection = crate::features::FeatureSelection {
        area_id: source.is_none().then_some(state.scope.area),
        kind: None,
        layer_id: None,
    };
    let records = match source {
        Some(reader) => reader.values(selection)?,
        None => state.records.features.values(selection)?,
    };
    for record in records {
        let feature = record?;
        if feature.kind == "road"
            && feature
                .attributes
                .get("strategic")
                .and_then(|v| v.as_bool())
                == Some(true)
        {
            let centre = atlas_map::regions::point(atlas_map::Position::xy(centre[0], centre[1]));
            evidence.guarded |= state
                .spatial
                .distance(&centre, &feature.geometry)
                .map_err(io::Error::other)?
                <= core;
        }
        if state.catalogue.offers_for(&feature).is_none()
            && !feature.attributes.contains_key("tenure")
            && !feature.attributes.contains_key("habitat")
        {
            continue;
        }
        let at = state
            .spatial
            .interior_position(&feature.geometry)
            .map_err(io::Error::other)?;
        let [x, y, _] = at.coordinates();
        if !city_ground
            .as_ref()
            .map_or(distance([x, y]) <= core, |cells| {
                crate::field::refinement::courses::cell_at(mesh, [x, y]).is_some_and(|c| cells[c])
            })
        {
            continue;
        }
        if let Some(c) = crate::field::refinement::courses::cell_at(mesh, [x, y]) {
            crate::atlas::town::founding_site::observe_feature(
                state,
                !habitable(field, c)?,
                &feature,
                [x, y],
                evidence,
            )?;
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_citys_civic_roll_owes_nothing_to_its_template_draw() {
        use crate::town::templates::civic::Civic;
        // Among the seeds whose template draw lands in one narrow band, the civic roll
        // still ranges over the whole of its own.
        let rolls: Vec<f64> = (0..4_000)
            .filter(|seed| draw(*seed, 0, 1) < 0.2)
            .map(|seed| Civic::roll(b"one settlement", seed))
            .collect();
        assert!(rolls.len() > 400);
        for band in 0..5 {
            let (low, high) = (f64::from(band) / 5., f64::from(band + 1) / 5.);
            let share = rolls.iter().filter(|r| (low..high).contains(*r)).count() as f64
                / rolls.len() as f64;
            assert!((0.12..0.28).contains(&share), "band {band}: {share}");
        }
    }
    #[test]
    fn city_guidance_uses_the_captured_settlement() {
        let capture = CITY_ORIGIN
            .bind(|CitySource::CapturedSettlement| {
                Ok(Some(Settlement {
                    centre: [250.0, 50.0],
                    built_radius: 30.0,
                    people: Some(100.0),
                }))
            })
            .unwrap()
            .unwrap();
        assert_eq!(capture.centre, [250.0, 50.0]);
        let missing = CITY_ORIGIN.bind(|_| Ok(None));
        assert!(
            matches!(missing, Err(err) if err.to_string() == "A city map holds the settlement it was opened at")
        );
    }
}
