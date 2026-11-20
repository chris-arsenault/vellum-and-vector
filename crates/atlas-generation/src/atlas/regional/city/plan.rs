//! The city plan, read from the refined fields: every cell's city reading, which the hot spots
//! read each round (`spots`), and the districts cut once the rounds are done. Districts gather
//! round the hot-spot towns and part along water, walls, main roads and changes of character
//! (`town::city::districts`), over the built city only.
use super::{habitable, LayerId};
use crate::{
    atlas::state::State,
    field::poi::{
        kinds::Kind,
        map_records::{generated, Record},
        values::Place,
    },
    human::{identity::Tradition, HumanField},
    town::{
        catalogue::PlaceRules,
        city::{districts, CityReading},
        templates::Selection,
        walls::{enclosure, run, BUILT, GATE},
    },
};
use atlas_map::{Geometry, Position};
use std::io;

/// People a district stands for; a larger city cuts more districts.
const PEOPLE_PER_DISTRICT: f64 = 40_000.;
/// A city map cuts at least this many districts, and at most the most.
const FEWEST_DISTRICTS: usize = 3;
const MOST_DISTRICTS: usize = 15;
/// What crossing each barrier costs, against one step of ordinary ground.
const WATER: f64 = 4.;
const WALL: f64 = 6.;
const ROAD: f64 = 2.;
const CHARACTER: f64 = 3.;

/// Every cell's reading, with the arrays the plan and the hot spots share.
pub(super) struct Cells {
    pub(super) at: Vec<[f64; 2]>,
    pub(super) open: Vec<bool>,
    /// The cell lies inside the published city map; the band round it is context only.
    pub(super) inside: Vec<bool>,
    pub(super) readings: Vec<CityReading>,
    /// People per square kilometre.
    pub(super) people: Vec<f64>,
    /// Built share of each cell.
    pub(super) covered: Vec<f64>,
    /// Each cell's area, square kilometres.
    pub(super) area: Vec<f64>,
    pub(super) ways: Vec<f64>,
}

pub(super) fn read(state: &State, selection: &Selection) -> io::Result<Cells> {
    let field = state.field();
    let mesh = field.mesh();
    let [ox, oy] = mesh.origin();
    let people_band = |cell| field.people().people(cell);
    let built = field.people().view(HumanField::Layer(LayerId::BuiltUp));
    let standing = field.people().view(HumanField::Layer(LayerId::Standing));
    let kept = field.people().view(HumanField::KeptLine);
    let n = mesh.len();
    let mut at = Vec::with_capacity(n);
    let mut open = Vec::with_capacity(n);
    let mut people = Vec::with_capacity(n);
    let mut ways = Vec::with_capacity(n);
    let mut stood = Vec::with_capacity(n);
    let mut covered = Vec::with_capacity(n);
    let mut area = Vec::with_capacity(n);
    for cell in 0..n {
        let [x, y] = mesh.position(cell);
        at.push([x + ox, y + oy]);
        area.push(mesh.area(cell) / 1e6);
        open.push(habitable(field, cell)?);
        people.push(people_band(cell)?);
        ways.push(kept.get(cell)?);
        stood.push(standing.get(cell)?);
        covered.push(built.get(cell)?.max(0.));
    }
    let positions: Vec<Position> = at.iter().map(|&[x, y]| Position::xy(x, y)).collect();
    let outline = state
        .scope
        .outline
        .as_ref()
        .unwrap_or(&state.scope.footprint);
    let inside = state
        .spatial
        .covers_points(outline, &positions)
        .map_err(io::Error::other)?;
    let max = |v: &[f64]| v.iter().copied().fold(0., f64::max).max(f64::EPSILON);
    let (densest, busiest, oldest) = (max(&people), max(&ways), max(&stood));
    // Built ground is read relative to the city's most built, as density is.
    let most_built = max(&covered);
    ways.iter_mut().for_each(|w| *w /= busiest);
    let walls = state
        .regional
        .as_ref()
        .map_or(&[][..], |r| &r.city.walls[..]);
    let mut gate = vec![false; n];
    let neighbours = |cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge));
    for wall in walls {
        let mut inside = vec![false; n];
        wall.inside.iter().for_each(|&c| inside[c as usize] = true);
        let defended: Vec<bool> = open.iter().map(|o| !o).collect();
        for face in run(&inside, &defended, &ways, neighbours).1 {
            gate[face.inside] = true;
            gate[face.outside] = true;
        }
    }
    let centre = selection.site.centre;
    let core = (0..n)
        .filter(|&c| built.get(c).is_ok_and(|b| b >= crate::town::walls::BUILT))
        .map(|c| (at[c][0] - centre[0]).hypot(at[c][1] - centre[1]))
        .fold(selection.quarter(), f64::max);
    let mut readings = Vec::with_capacity(n);
    for cell in 0..n {
        let distance = (at[cell][0] - centre[0]).hypot(at[cell][1] - centre[1]);
        let fringe = (distance / core).min(1.);
        let standing = stood[cell] / oldest;
        let shore = neighbours(cell)
            .into_iter()
            .flatten()
            .any(|next| !open[next]);
        let meeting = neighbours(cell)
            .into_iter()
            .flatten()
            .filter(|&next| ways[next] >= GATE)
            .count() as u32
            + u32::from(ways[cell] >= GATE);
        readings.push(CityReading {
            density: people[cell] / densest,
            built: covered[cell] / most_built,
            standing,
            // The people layers hold no means of their own: wealth is read from how long the
            // ground has stood and how near the heart it lies.
            wealth: standing * (1. - fringe).sqrt(),
            craft: 0.,
            faith: 0.,
            fringe,
            ways: meeting,
            shore: shore && open[cell],
            seat: selection.site.seat && distance <= selection.quarter(),
            walls: enclosure(walls, cell),
            gate: gate[cell],
        });
    }
    Ok(Cells {
        at,
        open,
        inside,
        readings,
        people,
        covered,
        area,
        ways,
    })
}

/// The cell is dry ground inside the published city map, where the city's own places stand.
pub(super) fn usable(cells: &Cells, cell: usize) -> bool {
    cells.open[cell] && cells.inside[cell]
}

/// How strongly each cell concentrates the city: crowded, long-standing ground where ways meet.
pub(super) fn concentration(cells: &Cells) -> Vec<f64> {
    (0..cells.readings.len())
        .map(|cell| {
            let r = &cells.readings[cell];
            if usable(cells, cell) {
                r.density * (0.5 + 0.5 * r.standing) * (1. + f64::from(r.ways.min(4)) / 4.)
            } else {
                0.
            }
        })
        .collect()
}

/// The usable cell nearest a point.
pub(super) fn nearest_open(cells: &Cells, point: [f64; 2]) -> Option<usize> {
    (0..cells.at.len())
        .filter(|&c| usable(cells, c))
        .min_by(|&a, &b| {
            let d = |c: usize| (cells.at[c][0] - point[0]).hypot(cells.at[c][1] - point[1]);
            d(a).total_cmp(&d(b))
        })
}

/// The city's people: its settlement's census, or what its people layers hold without one.
/// The layers hold the city's living pattern either way.
pub(super) fn population(state: &State, cells: &Cells) -> io::Result<f64> {
    let layers: f64 = cells
        .people
        .iter()
        .zip(&cells.area)
        .map(|(p, a)| p * a)
        .sum();
    let census = super::settlement(state)?.and_then(|s| s.people);
    Ok(census.unwrap_or(layers))
}

/// The share of a cell's people keeping a craft, and the share keeping its commonest faith.
pub(super) fn traditions(state: &State, cell: usize) -> io::Result<(f64, f64)> {
    let column = state.field().people().column(cell)?;
    let total: f64 = column.iter().map(|layer| layer.people).sum();
    if total <= 0. {
        return Ok((0., 0.));
    }
    let craft: f64 = column
        .iter()
        .filter(|layer| layer.traditions[Tradition::Craft as usize] != 0)
        .map(|layer| layer.people)
        .sum();
    let mut faiths: Vec<(i32, f64)> = Vec::new();
    for layer in &column {
        let faith = layer.traditions[Tradition::Faith as usize];
        if faith == 0 {
            continue;
        }
        match faiths.iter_mut().find(|(f, _)| *f == faith) {
            Some((_, people)) => *people += layer.people,
            None => faiths.push((faith, layer.people)),
        }
    }
    let faith = faiths.iter().map(|(_, p)| *p).fold(0., f64::max);
    Ok((craft / total, faith / total))
}

/// The districts, cut once the rounds are done: as many as the city's people call for, round
/// its strongest hot-spot towns, over its built and walled ground only.
pub(super) fn plan(state: &mut State, selection: &Selection) -> io::Result<()> {
    let cells = read(state, selection)?;
    let total = population(state, &cells)?;
    let mesh = state.field().mesh();
    let count =
        ((total / PEOPLE_PER_DISTRICT).round() as usize).clamp(FEWEST_DISTRICTS, MOST_DISTRICTS);
    // The built city: built ground as the walls read it, and whatever a wall encloses.
    let city: Vec<bool> = (0..mesh.len())
        .map(|c| usable(&cells, c) && (cells.covered[c] >= BUILT || cells.readings[c].walls > 0))
        .collect();
    // Seeds are the largest hot-spot towns; where too few founded, the city's other
    // concentrations stand in.
    let mut seeds: Vec<usize> = state
        .regional
        .as_ref()
        .map_or(&[][..], |r| &r.city.spots[..])
        .iter()
        .take(count)
        .map(|&s| s as usize)
        .collect();
    if seeds.len() < count {
        let apart = (3. * selection.quarter()).max(4. * mesh.cell_span());
        let far = |c: usize| {
            seeds.iter().all(|&s| {
                (cells.at[s][0] - cells.at[c][0]).hypot(cells.at[s][1] - cells.at[c][1]) >= apart
            })
        };
        let score: Vec<f64> = concentration(&cells)
            .into_iter()
            .enumerate()
            .map(|(c, s)| if city[c] && far(c) { s } else { 0. })
            .collect();
        let more = crate::town::city::hot_spots(&score, &cells.at, apart, count - seeds.len());
        seeds.extend(more);
    }
    // Districts part along water, walls, main roads and changes of character.
    let neighbours = |cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge));
    let r = &cells.readings;
    let cost = |a: usize, b: usize| {
        if !city[b] {
            return f64::INFINITY;
        }
        let mut step = 1.;
        if !cells.open[a] || !cells.open[b] {
            step += WATER;
        }
        if r[a].walls != r[b].walls {
            step += WALL;
        }
        if (cells.ways[a] >= 0.5) != (cells.ways[b] >= 0.5) {
            step += ROAD;
        }
        step + CHARACTER
            * ((r[a].density - r[b].density).abs() + (r[a].standing - r[b].standing).abs())
    };
    let labels = districts(&seeds, mesh.len(), cost, neighbours);
    super::trace(
        "city.plan",
        serde_json::json!({
            "people": total,
            "count": count,
            "seeds": seeds.len(),
            "cityCells": city.iter().filter(|&&c| c).count(),
            "labelled": labels.iter().filter(|&&l| l != u8::MAX).count(),
        }),
    );
    if let Some(regional) = state.regional.as_mut() {
        regional.city.districts = labels;
    }
    Ok(())
}

fn position(state: &State, cell: usize) -> [f64; 2] {
    let mesh = state.field().mesh();
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    [x + ox, y + oy]
}

/// Each raised place at its rough location: places raised at one spot stand round it.
pub(super) fn place_records(state: &State) -> io::Result<Vec<Place>> {
    let Some(city) = state.regional.as_ref().map(|r| &r.city) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (index, placed) in city.places.iter().enumerate() {
        let Some(appearance) = placed.kind.definition().city.appearance() else {
            continue;
        };
        let around = city.places[..index]
            .iter()
            .filter(|p| p.spot == placed.spot)
            .count();
        let [x, y] = position(state, placed.spot);
        let reach = (appearance.ground / std::f64::consts::PI).sqrt() * 1.5 * around as f64;
        let angle = around as f64 * 2.4;
        let point = Position::xy(x + reach * angle.cos(), y + reach * angle.sin());
        let label = placed.kind.definition().label;
        let mut attributes = crate::features::records::Attributes::new();
        attributes.insert("place".into(), label.into());
        attributes.insert("symbol".into(), appearance.symbol.into());
        attributes.insert("groundM2".into(), appearance.ground.into());
        let key = format!("city-place-{index}");
        let feature = generated(
            state,
            Record {
                key: &key,
                name: &capitalised(label),
                kind: "cityPlace",
                layer: "settlements",
                geometry: Geometry::Point { coordinates: point },
                attributes,
            },
        )?;
        let mut place = Place::at(Kind::CityPlace, placed.spot, vec![placed.spot]);
        place.id = key;
        place.feature = Some(feature);
        records.push(place);
    }
    Ok(records)
}

/// Each major work at its site.
pub(super) fn work_records(state: &State) -> io::Result<Vec<Place>> {
    let Some(city) = state.regional.as_ref().map(|r| &r.city) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (index, &(family, cell)) in city.works.iter().enumerate() {
        let appearance = family.city();
        let [x, y] = position(state, cell as usize);
        let mut attributes = crate::features::records::Attributes::new();
        // District maps inherit captured works by this attribute (`atlas/town/founding_site`).
        attributes.insert("majorWorkFamily".into(), family.key().into());
        attributes.insert("symbol".into(), appearance.symbol.into());
        attributes.insert("groundM2".into(), appearance.ground.into());
        let key = format!("major-work-{index}");
        let feature = generated(
            state,
            Record {
                key: &key,
                name: family.label(),
                kind: "majorWork",
                layer: "settlements",
                geometry: Geometry::Point {
                    coordinates: Position::xy(x, y),
                },
                attributes,
            },
        )?;
        let mut place = Place::at(Kind::MajorWork, cell as usize, vec![cell as usize]);
        place.id = key;
        place.feature = Some(feature);
        records.push(place);
    }
    Ok(records)
}

/// Each district as a region polygon: the union of its cells' Voronoi cells, with its
/// population, density, standing, enclosure and the places raised in it.
pub(super) fn district_records(state: &State) -> io::Result<Vec<Place>> {
    let Some(city) = state.regional.as_ref().map(|r| &r.city) else {
        return Ok(Vec::new());
    };
    if city.districts.is_empty() {
        return Ok(Vec::new());
    }
    let field = state.field();
    let mesh = field.mesh();
    let sites: Vec<Position> = (0..mesh.len())
        .map(|c| {
            let [x, y] = position(state, c);
            Position::xy(x, y)
        })
        .collect();
    let b = state
        .spatial
        .bounds(&state.scope.footprint)
        .map_err(io::Error::other)?;
    let shapes = state
        .spatial
        .voronoi_cells(&sites, b)
        .map_err(io::Error::other)?;
    let count = city
        .districts
        .iter()
        .filter(|&&l| l != u8::MAX)
        .max()
        .map_or(0, |&m| m as usize + 1);
    let built = field.people().view(HumanField::Layer(LayerId::BuiltUp));
    let standing = field.people().view(HumanField::Layer(LayerId::Standing));
    let mut records = Vec::new();
    for district in 0..count {
        let cells: Vec<usize> = (0..mesh.len())
            .filter(|&c| city.districts[c] == district as u8)
            .collect();
        let polygons: Vec<Geometry> = cells.iter().filter_map(|&c| shapes[c].clone()).collect();
        let Some(union) = state
            .spatial
            .union_all(&polygons)
            .map_err(io::Error::other)?
        else {
            continue;
        };
        let Some(shape) = state
            .spatial
            .overlay(
                &union,
                &state.scope.footprint,
                crate::spatial::Overlay::Intersection,
            )
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        else {
            continue;
        };
        let km2: f64 = cells.iter().map(|&c| mesh.area(c) / 1e6).sum();
        let mut people = 0.;
        let mut built_share = 0.;
        let mut stood = 0.;
        for &c in &cells {
            people += field.people().people(c)? * mesh.area(c) / 1e6;
            built_share += built.get(c)?;
            stood += standing.get(c)?;
        }
        let n = cells.len().max(1) as f64;
        let specialisations: Vec<&str> = city
            .places
            .iter()
            .filter(|p| city.districts.get(p.spot) == Some(&(district as u8)))
            .map(|p| p.kind.definition().label)
            .collect();
        let walled = cells
            .iter()
            .filter(|&&c| enclosure(&city.walls, c) > 0)
            .count() as f64
            / n;
        let mut attributes = crate::features::records::Attributes::new();
        attributes.insert("population".into(), (people.round()).into());
        attributes.insert(
            "densityPerKm2".into(),
            (people / km2.max(f64::EPSILON)).round().into(),
        );
        attributes.insert("builtShare".into(), (built_share / n).into());
        attributes.insert("standing".into(), (stood / n).into());
        attributes.insert("walledShare".into(), walled.into());
        attributes.insert("specializations".into(), specialisations.clone().into());
        // A district map's town reads these as its seat's story and its city's template.
        attributes.insert("builtKm2".into(), (km2 * built_share / n).into());
        if let Some(template) = &city.template {
            attributes.insert("template".into(), template.selected.name().into());
        }
        let name = match specialisations.first() {
            Some(first) => format!("{} quarter", capitalised(first)),
            None => format!("Outer district {}", district + 1),
        };
        let key = format!("city-district-{district}");
        let feature = generated(
            state,
            Record {
                key: &key,
                name: &name,
                kind: "district",
                layer: "settlements",
                geometry: shape,
                attributes,
            },
        )?;
        let anchor = city.spots.get(district).map_or(cells[0], |&s| s as usize);
        let mut place = Place::at(Kind::CityDistrict, anchor, cells);
        place.id = key;
        place.feature = Some(feature);
        records.push(place);
    }
    Ok(records)
}

fn capitalised(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}
