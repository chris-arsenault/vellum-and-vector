//! The city's hot spots, in every refinement round. Where this round's refined social fields
//! concentrate, a small town is founded and the town development steps advance it with every
//! other hot-spot town (`atlas::town::development`). The city's major works are sited in its
//! first round, by their own rules, and taken up by the hot-spot town beside each. After the
//! town steps the prominent places those towns built stand on the city map, and the next
//! round's growth draws people toward them.
use super::plan;
use crate::{
    atlas::{
        state::State,
        town::{
            development::found_at_spots,
            site::{spot_seat, SpotApproaches},
            Settings,
        },
    },
    field::refinement::courses::cell_at,
    town::{
        city::{hot_spots, prominent, CityReading, Placed},
        geometry::distance,
        major_works::{city_works, commission_city_work},
        story::Story,
        templates::Selection,
    },
};
use std::io;

/// People a hot spot stands for; a city has a spot for each this many, and at least three.
const PEOPLE_PER_SPOT: f64 = 40_000.;
/// How many neighbouring centres a hot spot's town heads for.
const NEIGHBOURS: usize = 3;
/// Town development rounds the hot-spot towns run in each city round.
pub(in crate::atlas::regional) const TOWN_ROUNDS: usize = 2;

/// The hot spots' layout on this city map: how many the city's people call for and how far
/// apart they stand. A spot's town draws on the ground within half that spacing.
struct Spacing {
    count: usize,
    apart: f64,
}

/// This round's hot spots: a town is founded at each spot no town yet holds, up to the city's
/// count, and the city's works, sited in the first round, are commissioned into the town
/// beside each.
pub(in crate::atlas::regional) fn found(
    state: &mut State,
    selection: &Selection,
    seed: i32,
) -> io::Result<()> {
    // A city map's towns build its blocks and thoroughfares, and its ground is laid for them.
    state.town.fidelity = crate::town::scale::Fidelity::City;
    let cells = plan::read(state, selection)?;
    let total = plan::population(state, &cells)?;
    let spacing = Spacing {
        count: ((total / PEOPLE_PER_SPOT).round() as usize + 2).clamp(3, 16),
        apart: (3. * selection.quarter()).max(4. * state.field().mesh().cell_span()),
    };
    let works = site_works(state, selection, &cells, total, seed);
    let seats = new_seats(state, selection, &cells, total, &spacing, seed)?;
    let offered: Vec<_> = seats
        .iter()
        .map(|(seat, _)| (seat.centre, seat.story.people, seat.arms.len()))
        .collect();
    let founded = found_at_spots(state, seats)?;
    super::trace(
        "city.spots",
        serde_json::json!({
            "round": state.regional.as_ref().map_or(0, |r| r.round),
            "people": total,
            "count": spacing.count,
            "apart": spacing.apart,
            "standing": state.town.towns.len(),
            "offered": offered,
            "founded": founded.iter().map(|t| (t.seat.centre, t.holdings().len(), t.streets().len())).collect::<Vec<_>>(),
            "works": works.len(),
        }),
    );
    state.town.towns.extend(founded);
    take_up_works(state, &cells, &works, spacing.apart, seed);
    // Districts later gather round the largest towns first.
    let mut towns: Vec<_> = state
        .town
        .towns
        .iter()
        .map(|t| (t.seat.story.people, t.seat.centre))
        .collect();
    towns.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mesh = state.field().mesh();
    let centres: Vec<u32> = towns
        .iter()
        .filter_map(|&(_, centre)| cell_at(mesh, centre).map(|c| c as u32))
        .collect();
    if let Some(regional) = state.regional.as_mut() {
        regional.city.works = works;
        regional.city.spots = centres;
    }
    Ok(())
}

/// The city's works: sited in its first round by their own rules, as many as its population
/// band expects, and kept after.
fn site_works(
    state: &State,
    selection: &Selection,
    cells: &plan::Cells,
    total: f64,
    seed: i32,
) -> Vec<(crate::town::catalogue::works::WorkFamily, u32)> {
    let Some(regional) = state.regional.as_ref() else {
        return Vec::new();
    };
    if regional.round > 1 || !regional.city.works.is_empty() {
        return regional.city.works.clone();
    }
    city_works(&selection.site, total, seed)
        .into_iter()
        .filter_map(|(family, anchor)| {
            let cell = plan::nearest_open(cells, anchor)?;
            Some((family, cell as u32))
        })
        .collect()
}

/// Seats for this round's new hot-spot towns: the spots no standing town holds, up to the
/// city's count, each with its share of the city's people.
fn new_seats(
    state: &State,
    selection: &Selection,
    cells: &plan::Cells,
    total: f64,
    spacing: &Spacing,
    seed: i32,
) -> io::Result<Vec<(crate::town::seat::Seat, Settings)>> {
    let spots = hot_spots(
        &plan::concentration(cells),
        &cells.at,
        spacing.apart,
        spacing.count,
    );
    let shares = catchments(cells, &spots);
    let built = built(cells);
    let existing: Vec<[f64; 2]> = state.town.towns.iter().map(|t| t.seat.centre).collect();
    // Every centre the city will have this round, standing towns and new spots alike, with
    // the name a way toward it carries.
    let mut centres: Vec<([f64; 2], String)> = state
        .town
        .towns
        .iter()
        .map(|t| (t.seat.centre, t.seat.name.clone()))
        .collect();
    let fresh: Vec<usize> = spots
        .iter()
        .copied()
        .filter(|&spot| {
            existing
                .iter()
                .all(|&c| distance(c, cells.at[spot]) >= spacing.apart / 2.)
        })
        .take(spacing.count.saturating_sub(existing.len()))
        .collect();
    for (i, &spot) in fresh.iter().enumerate() {
        centres.push((
            cells.at[spot],
            format!("Hot spot {}", existing.len() + i + 1),
        ));
    }
    let mut seats = Vec::new();
    for (index, &spot) in spots.iter().enumerate() {
        if !fresh.contains(&spot) {
            continue;
        }
        let at = cells.at[spot];
        let (_, name) = centres
            .iter()
            .find(|(c, _)| *c == at)
            .cloned()
            .unwrap_or_default();
        // A spot's town heads for its nearest neighbouring centres.
        let mut others: Vec<_> = centres.iter().filter(|(c, _)| *c != at).cloned().collect();
        others.sort_by(|a, b| distance(a.0, at).total_cmp(&distance(b.0, at)));
        others.truncate(NEIGHBOURS);
        // A spot's town is identified by the cell it stands on, so no two towns share one.
        let seat = spot_seat(
            state,
            atlas_map::Id::v5(state.scope.area, format!("city-hot-spot-{spot}").as_bytes()),
            name,
            at,
            &SpotApproaches {
                reach: spacing.apart,
                toward: &others,
            },
            story(
                &cells.readings[spot],
                shares[index] * total,
                shares[index] * built,
            ),
        )?;
        let settings = Settings {
            layout: None,
            seed: seed.wrapping_add(spot as i32),
            template: Some(selection.selected),
            major_work: None,
        };
        seats.push((seat, settings));
    }
    Ok(seats)
}

/// Each of the city's works not yet taken up goes to the nearest hot-spot town within the
/// spots' spacing, which builds round it.
fn take_up_works(
    state: &mut State,
    cells: &plan::Cells,
    works: &[(crate::town::catalogue::works::WorkFamily, u32)],
    reach: f64,
    seed: i32,
) {
    for &(family, cell) in works {
        let anchor = cells.at[cell as usize];
        let taken = state.town.towns.iter().any(|t| {
            t.works
                .commissions
                .iter()
                .any(|c| c.family == family && distance(c.anchor, anchor) < 1.)
        });
        if taken {
            continue;
        }
        let nearest = state
            .town
            .towns
            .iter_mut()
            .filter(|t| distance(t.seat.centre, anchor) <= reach)
            .min_by(|a, b| {
                distance(a.seat.centre, anchor).total_cmp(&distance(b.seat.centre, anchor))
            });
        if let Some(town) = nearest {
            commission_city_work(town, seed, family, anchor);
        }
    }
}

/// Each spot's share of the city's people: the people of the cells nearer it than any other
/// spot, against all the city's people.
fn catchments(cells: &plan::Cells, spots: &[usize]) -> Vec<f64> {
    let mut held = vec![0.; spots.len()];
    let mut total = 0.;
    for (cell, &[x, y]) in cells.at.iter().enumerate() {
        let people = cells.people[cell] * cells.area[cell];
        total += people;
        let nearest = spots.iter().enumerate().min_by(|a, b| {
            let d = |s: usize| (cells.at[s][0] - x).hypot(cells.at[s][1] - y);
            d(*a.1).total_cmp(&d(*b.1))
        });
        if let Some((index, _)) = nearest {
            held[index] += people;
        }
    }
    held.iter().map(|h| h / total.max(f64::EPSILON)).collect()
}

/// The city's built ground, in square metres.
fn built(cells: &plan::Cells) -> f64 {
    cells
        .covered
        .iter()
        .zip(&cells.area)
        .map(|(b, a)| b * a * 1e6)
        .sum()
}

/// A hot spot's story as its reading tells it: its people and built ground, whether the
/// city's seat or a wall holds it, whether it lies on the shore, and how long it has stood.
fn story(reading: &CityReading, people: f64, built_area: f64) -> Story {
    Story {
        people,
        built_area,
        seat: reading.seat,
        guarded: reading.walls > 0,
        waterside: reading.shore,
        town_eras: if reading.standing > 0.5 { 2 } else { 1 },
        eras: 2,
        ..Story::default()
    }
}

/// The people a block houses.
pub(super) fn housed(
    holding: &crate::town::fabric::Holding,
    spatial: &dyn crate::spatial::SpatialKernel,
) -> io::Result<f64> {
    crate::processes::town::economy::housed(holding, spatial)
}

/// What the hot-spot towns have built, cell by cell, for the people layers to take up: the
/// people their blocks house, the share of ground their blocks build up, and the cells their
/// thoroughfares cross. People move toward housing within half the spots' spacing.
pub(in crate::atlas::regional) fn quarters(
    state: &State,
    selection: &Selection,
) -> io::Result<crate::field::people::quarters::Quarters> {
    let mesh = state.field().mesh();
    let spatial = state.spatial.as_ref();
    let n = mesh.len();
    let mut housed_at = vec![0.; n];
    let mut covered = vec![0.; n];
    let mut crossed = vec![false; n];
    for town in &state.town.towns {
        for holding in town.holdings().iter().filter(|h| h.standing()) {
            let Some(cell) = cell_at(mesh, holding.slot.front) else {
                continue;
            };
            housed_at[cell] += housed(holding, spatial)?;
            // A block is built land over its whole outline, yards and courts included, as
            // the people layers count built ground.
            covered[cell] += spatial.area(&holding.outline).map_err(io::Error::other)?;
        }
        for street in town.streets() {
            for cell in cells_along(mesh, &street.points) {
                crossed[cell] = true;
            }
        }
    }
    for (cell, cover) in covered.iter_mut().enumerate() {
        *cover = (*cover / mesh.area(cell).max(f64::EPSILON)).min(1.);
    }
    let span = mesh.cell_span();
    let apart = (3. * selection.quarter()).max(4. * span);
    super::trace(
        "city.quarters",
        serde_json::json!({
            "towns": state.town.towns.iter().map(|t| (t.round, t.holdings().len(), t.streets().len())).collect::<Vec<_>>(),
            "housed": housed_at.iter().sum::<f64>(),
            "builtCells": covered.iter().filter(|&&c| c > 0.).count(),
            "wayCells": crossed.iter().filter(|&&c| c).count(),
        }),
    );
    Ok(crate::field::people::quarters::Quarters {
        housed: housed_at,
        covered,
        ways: (0..n).filter(|&c| crossed[c]).collect(),
        reach: ((apart / 2. / span).ceil() as usize).clamp(2, 12),
    })
}

/// The lattice cells a line crosses, sampled at half a cell's span.
pub(super) fn cells_along(
    mesh: &crate::lattice::TriangularLattice,
    points: &[[f64; 2]],
) -> Vec<usize> {
    let step = mesh.cell_span() / 2.;
    let mut cells = Vec::new();
    for pair in points.windows(2) {
        let [a, b] = [pair[0], pair[1]];
        let samples = (distance(a, b) / step).ceil().max(1.) as usize;
        for i in 0..=samples {
            let t = i as f64 / samples as f64;
            let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            if let Some(cell) = cell_at(mesh, p) {
                if cells.last() != Some(&cell) {
                    cells.push(cell);
                }
            }
        }
    }
    cells
}

/// The landmarks the hot-spot towns have built: in each town, one place of each family the
/// city map shows, where the spot's reading does not leave it unraised.
pub(in crate::atlas::regional) fn record(
    state: &mut State,
    selection: &Selection,
) -> io::Result<()> {
    let cells = plan::read(state, selection)?;
    let mesh = state.field().mesh();
    let mut placed = Vec::new();
    for town in &state.town.towns {
        let Some(spot) = cell_at(mesh, town.seat.centre) else {
            continue;
        };
        let (craft, faith) = plan::traditions(state, spot)?;
        let reading = CityReading {
            craft,
            faith,
            ..cells.readings[spot]
        };
        let mut families: Vec<crate::town::catalogue::Kind> = Vec::new();
        // A vacant or ruined holding stands out on no map.
        for holding in town.holdings().iter().filter(|h| h.standing()) {
            let kind = holding.kind;
            if families.iter().any(|k| k.same_family(kind)) || !prominent(kind, &reading) {
                continue;
            }
            let Some(cell) = cell_at(mesh, holding.slot.front) else {
                continue;
            };
            families.push(kind);
            placed.push(Placed { spot: cell, kind });
        }
    }
    if let Some(regional) = state.regional.as_mut() {
        regional.city.places = placed;
    }
    Ok(())
}
