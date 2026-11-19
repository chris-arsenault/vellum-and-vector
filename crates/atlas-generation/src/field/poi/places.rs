use super::{
    kinds::Kind,
    reads::{feature_cell, magic_field},
    sites::Sites,
    state::State,
    values::Place,
};
use crate::{
    features::{Feature, FeatureSelection},
    field::{refinement::topology, Field},
    hpc::{BitSet, Direction, KeyedHeap},
    magic::channels::Channel,
};
use std::{io, rc::Rc};

fn regions(
    field: &Field,
    kind: Kind,
    test: impl Fn(usize) -> io::Result<bool>,
    rank: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<Vec<Place>> {
    let mut includes = BitSet::new(field.mesh.len());
    for cell in 0..field.mesh.len() {
        if test(cell)? {
            includes.add(cell);
        }
    }
    let mut groups = Vec::new();
    topology::components(
        &field.mesh,
        |cell| includes.has(cell),
        |cells| groups.push(cells.to_vec()),
    );
    let mut places = Vec::new();
    for cells in groups {
        let mut anchor = cells[0];
        let mut highest = rank(anchor)?;
        for &cell in &cells[1..] {
            let value = rank(cell)?;
            if value > highest {
                anchor = cell;
                highest = value;
            }
        }
        places.push(Place::at(kind, anchor, cells));
    }
    Ok(places)
}
pub fn region_places(
    state: &impl State,
    kind: Kind,
    test: impl Fn(usize) -> io::Result<bool>,
    rank: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<Rc<Vec<Place>>> {
    state.held().get(&format!("places:{}", kind.as_str()), || {
        regions(state.field()?, kind, test, rank)
    })
}
pub fn rule_places(
    state: &impl State,
    kind: Kind,
    system: &str,
    rule: &str,
) -> io::Result<Rc<Vec<Place>>> {
    state
        .held()
        .get(&format!("rule:{}:{system}:{rule}", kind.as_str()), || {
            let Some(magic) = magic_field(state, system) else {
                return Ok(Vec::new());
            };
            let Some(at) = magic
                .definition()
                .features
                .iter()
                .position(|f| f.id == rule)
            else {
                return Ok(Vec::new());
            };
            let (members, coverage) = magic.feature(at);
            let intensity = magic.channel(Channel::Intensity);
            regions(
                state.field()?,
                kind,
                |cell| Ok(members.get(cell)? != 0.0 && coverage.get(cell)? > 0.0),
                |cell| intensity.get(cell),
            )
        })
}
pub fn cell_places(
    state: &impl State,
    kind: Kind,
    test: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<Rc<Vec<Place>>> {
    state.held().get(&format!("places:{}", kind.as_str()), || {
        let field = state.field()?;
        let mut places = Vec::new();
        for cell in 0..field.mesh.len() {
            if test(cell)? {
                places.push(Place::at(kind, cell, vec![cell]));
            }
        }
        Ok(places)
    })
}
pub fn record_places(
    state: &impl State,
    kind: Kind,
    matches: impl Fn(&Feature) -> bool,
) -> io::Result<Rc<Vec<Place>>> {
    state.held().get(&format!("places:{}", kind.as_str()), || {
        let Some(field) = state.physical() else {
            return Ok(Vec::new());
        };
        let mut places = Vec::new();
        for feature in state.features().values(FeatureSelection::default())? {
            let feature = feature?;
            if !matches(&feature) {
                continue;
            }
            if let Some(anchor) = feature_cell(field, &feature) {
                let mut place = Place::at(kind, anchor, vec![anchor]);
                place.id = feature.id.to_string();
                place.feature = Some(feature);
                places.push(place);
            }
        }
        Ok(places)
    })
}
pub fn sited_places(
    state: &impl State,
    kind: Kind,
    requires: impl Fn(usize) -> io::Result<bool>,
    suitability: impl Fn(usize) -> io::Result<f64>,
    spacing: f64,
) -> io::Result<Rc<Vec<Place>>> {
    state.held().get(&format!("sited:{}", kind.as_str()), || {
        let Some(field) = state.physical() else {
            return Ok(Vec::new());
        };
        let mut ranked = KeyedHeap::new([Direction::Descending], Direction::Ascending);
        let mut candidates = Vec::new();
        for cell in 0..field.mesh.len() {
            if !requires(cell)? {
                continue;
            }
            let score = suitability(cell)?;
            if score >= 0.5 {
                ranked.push(cell as u32, [score]);
                candidates.push(cell);
            }
        }
        let sites = Sites::new(state.spatial(), &field.mesh, candidates)?;
        let mut taken = BitSet::new(field.mesh.len());
        let mut places = Vec::new();
        while let Some((cell, _)) = ranked.pop() {
            let cell = cell as usize;
            if sites
                .around(&field.mesh, cell, spacing)?
                .into_iter()
                .any(|other| {
                    taken.has(other) && topology::distance(&field.mesh, cell, other) < spacing
                })
            {
                continue;
            }
            taken.add(cell);
            places.push(Place::at(kind, cell, vec![cell]));
        }
        Ok(places)
    })
}
pub fn holds_record(
    state: &impl State,
    kind: Kind,
    cell: usize,
    places: impl FnOnce() -> io::Result<Vec<Place>>,
) -> io::Result<bool> {
    let cells = state.held().get(&format!("cells:{}", kind.as_str()), || {
        let mut cells = BitSet::new(state.field()?.mesh.len());
        for place in places()? {
            cells.add(place.anchor);
        }
        Ok(cells)
    })?;
    Ok(cells.has(cell))
}
pub fn settlement_within(state: &impl State, cell: usize, reach: f64) -> io::Result<bool> {
    let field = state.field()?;
    let cells = super::reads::settlements(state)?
        .iter()
        .filter_map(|town| feature_cell(field, town))
        .collect();
    let nearest = Sites::new(state.spatial(), &field.mesh, cells)?.nearest(&field.mesh, cell)?;
    Ok(nearest.is_some_and(|other| topology::distance(&field.mesh, cell, other) <= reach))
}
pub fn naming_culture_near(state: &impl State, place: &Place) -> io::Result<Option<String>> {
    let field = state.field()?;
    let towns = super::reads::settlements(state)?;
    let located = towns
        .iter()
        .filter_map(|town| {
            Some((
                feature_cell(field, town)?,
                town.attributes.get("namingCulture")?.as_str()?,
            ))
        })
        .collect::<Vec<_>>();
    let nearest = Sites::new(
        state.spatial(),
        &field.mesh,
        located.iter().map(|(cell, _)| *cell).collect(),
    )?
    .nearest(&field.mesh, place.anchor)?;
    Ok(nearest.and_then(|cell| {
        located
            .iter()
            .find(|(at, _)| *at == cell)
            .map(|(_, culture)| (*culture).into())
    }))
}
pub fn nearest_place(state: &impl State, place: &Place, others: &[Place]) -> io::Result<f64> {
    let field = state.field()?;
    let sites = Sites::new(
        state.spatial(),
        &field.mesh,
        others
            .iter()
            .filter(|other| other.id != place.id)
            .map(|other| other.anchor)
            .collect(),
    )?;
    Ok(sites
        .nearest(&field.mesh, place.anchor)?
        .map_or(f64::INFINITY, |cell| {
            topology::distance(&field.mesh, place.anchor, cell)
        }))
}
pub fn within(state: &impl State, a: &Place, b: &Place, reach: f64) -> io::Result<bool> {
    Ok(topology::distance(&state.field()?.mesh, a.anchor, b.anchor) <= reach)
}
pub fn holds(a: &Place, b: &Place) -> bool {
    a.cells.contains(&b.anchor)
}
pub fn anchor_at(state: &impl State, place: &Place) -> io::Result<atlas_map::Position> {
    let mesh = &state.field()?.mesh;
    let [x, y] = mesh.position(place.anchor);
    let [ox, oy] = mesh.origin();
    Ok(atlas_map::Position::xy(x + ox, y + oy))
}
