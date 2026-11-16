use super::{
    carry::carried_places,
    catalogue::CatalogueState,
    contract::{Finder, Origin},
    kinds::Kind,
    origins::{self, Claims},
    peak_ranges::{self, RangeState},
    reads,
    sites::{self, Sites},
    state::State,
    values::Found,
};
use crate::{
    field::{refinement::topology::distance, significance::measure},
    hpc::{BitSet, Direction, KeyedHeap},
    noise::hash_unit,
    prominence::Prominence,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

pub fn rise(state: &impl State) -> io::Result<Rc<Prominence>> {
    state
        .held()
        .get("prominence", || state.field()?.topographic_prominence())
}
pub fn metres(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(MapScale::metres(
        rise(state)?.rise.get(cell)?,
        LengthUnit::Native,
    ))
}
fn least(state: &impl State) -> io::Result<f64> {
    Ok(MapScale::native(measure(
        &state.field()?.scale,
        0.0000125,
        1,
        1.0,
    )?))
}
fn at(anchor: usize) -> Found {
    Found {
        anchor,
        cells: None,
        hosted_by: None,
    }
}
fn candidates(state: &impl State) -> io::Result<Rc<Vec<usize>>> {
    state.held().get("peak:candidates", || {
        let field = state.field()?;
        let rise = rise(state)?;
        let least = least(state)?;
        let mut ranked = KeyedHeap::new([Direction::Descending], Direction::Ascending);
        for cell in 0..field.mesh.len() {
            if field.water().column.kind.get(cell)? == 0 && rise.rise.get(cell)? >= least {
                ranked.push(cell as u32, [rise.rise.get(cell)?]);
            }
        }
        let mut found = Vec::new();
        while let Some((cell, _)) = ranked.pop() {
            found.push(cell as usize);
        }
        Ok(found)
    })
}
pub fn highest_rising(state: &impl State, cells: &[usize]) -> io::Result<Option<usize>> {
    let rise = rise(state)?;
    let least = least(state)?;
    let mut best = None;
    for &cell in cells {
        if rise.rise.get(cell)? >= least
            && match best {
                Some(best) => rise.rise.get(cell)? > rise.rise.get(best)?,
                None => true,
            }
        {
            best = Some(cell);
        }
    }
    Ok(best)
}
fn crowns(state: &impl RangeState) -> io::Result<Vec<Found>> {
    let elevation = state.field()?.ground().view(GroundField::Elevation);
    peak_ranges::groups(state)?
        .iter()
        .map(|group| {
            let mut crown = group.members[0];
            for &cell in &group.members {
                if elevation.get(cell)? > elevation.get(crown)? {
                    crown = cell;
                }
            }
            Ok(at(crown))
        })
        .collect()
}
fn carried<S: CatalogueState<Schedule>, Schedule>(state: &S) -> io::Result<Vec<Found>> {
    let mut found = Vec::new();
    if state.regional() {
        for place in carried_places(state, state.catalogue())?
            .iter()
            .filter(|p| p.kind == Kind::Peak)
        {
            if let Some(cell) = highest_rising(
                state,
                &sites::within(
                    &state.field()?.mesh,
                    place.carried.cell,
                    state.parent_cell_span(),
                ),
            )? {
                found.push(at(cell));
            }
        }
    }
    Ok(found)
}
fn high(state: &impl RangeState, claimed: &Claims) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let threshold = measure(&field.scale, 0.0001, 1, 0.5)?;
    let mut bars = field.coverage.borrow_mut().allocate(f64::NAN);
    for group in peak_ranges::groups(state)?.iter() {
        let bar = threshold.max(0.25 * group.relief);
        for &cell in &group.members {
            bars.set(cell, bar)?;
        }
    }
    origins::spaced_among(
        state,
        claimed,
        &candidates(state)?,
        field.scale.cells(3.0),
        |cell| Ok(metres(state, cell)? >= bars.get(cell)?),
    )
}
fn lone(state: &impl RangeState, claimed: &Claims) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let threshold = measure(&field.scale, 0.000225, 1, 0.5)?;
    let mut in_range = BitSet::new(field.mesh.len());
    for group in peak_ranges::groups(state)?.iter() {
        for &cell in &group.members {
            in_range.add(cell);
        }
    }
    origins::spaced_among(
        state,
        claimed,
        &candidates(state)?,
        field.scale.cells(5.0),
        |cell| Ok(!in_range.has(cell) && metres(state, cell)? >= threshold),
    )
}
fn sea_marks(state: &impl State, claimed: &Claims) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let threshold = measure(&field.scale, 0.000075, 1, 0.5)?;
    origins::spaced_among(
        state,
        claimed,
        &candidates(state)?,
        field.scale.cells(8.0),
        |cell| {
            if metres(state, cell)? < threshold {
                return Ok(false);
            }
            for near in sites::within(&field.mesh, cell, field.scale.cells(2.0)) {
                if field.water().column.kind.get(near)? == 1 {
                    return Ok(true);
                }
            }
            Ok(false)
        },
    )
}
/// Key cols retain the source's first-peak discovery order, with the greatest rise at each col.
fn cols(state: &impl State) -> io::Result<Vec<(usize, f64)>> {
    let field = state.field()?;
    let rise = rise(state)?;
    let least = least(state)?;
    let mut values = field.coverage.borrow_mut().allocate(0.0f64);
    let mut order = Vec::new();
    let mut seen = BitSet::new(field.mesh.len());
    for cell in 0..field.mesh.len() {
        let value = rise.rise.get(cell)?;
        if value < least {
            continue;
        }
        if let Ok(col) = usize::try_from(rise.saddle.get(cell)?) {
            if seen.add(col) {
                order.push(col);
            }
            values.set(col, values.get(col)?.max(value))?;
        }
    }
    order
        .into_iter()
        .map(|cell| Ok((cell, values.get(cell)?)))
        .collect()
}
fn horns(state: &impl State, claimed: &Claims) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let reach = field.scale.cells(4.0);
    let bar = MapScale::native(measure(&field.scale, 0.0003, 1, 0.5)?);
    let mut taken: Vec<_> = claimed.cells().collect();
    let mut found = Vec::new();
    for (col, rise) in cols(state)? {
        if rise < bar || hash_unit(0x7011, col as f64, 0.0) >= 0.3 {
            continue;
        }
        let Some(top) = highest_rising(state, &sites::within(&field.mesh, col, reach))? else {
            continue;
        };
        let nearest =
            Sites::new(state.spatial(), &field.mesh, taken.clone())?.nearest(&field.mesh, top)?;
        if nearest.is_some_and(|cell| distance(&field.mesh, cell, top) < reach) {
            continue;
        }
        taken.push(top);
        found.push(at(top));
    }
    Ok(found)
}
fn towns<S: RangeState + CatalogueState<Schedule>, Schedule>(state: &S) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let reach = field
        .scale
        .supported(measure(&field.scale, 0.00375, 1, 1.0)?, 3.0);
    let mut found = Vec::new();
    for town in state.settlement_places()? {
        if reads::height(field, town.anchor)? < state.hill_elevation() {
            continue;
        }
        let role = town
            .feature
            .as_ref()
            .and_then(|f| f.attributes.get("settlementRole"))
            .and_then(|v| v.as_str());
        let people = town
            .feature
            .as_ref()
            .and_then(|f| {
                f.attributes
                    .get("communityPopulation")
                    .filter(|v| !v.is_null())
                    .or_else(|| f.attributes.get("population"))
            })
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let chance = if matches!(role, Some("capital" | "regionalCapital")) {
            0.9
        } else {
            0.1 + 0.5 * people / (people + 2000.0)
        };
        if hash_unit(0x7012, town.anchor as f64, 0.0) >= chance {
            continue;
        }
        if let Some(top) = highest_rising(state, &sites::within(&field.mesh, town.anchor, reach))? {
            found.push(at(top));
        }
    }
    Ok(found)
}
type Reason<S> = (&'static str, &'static str, Vec<Kind>, Finder<S>);
pub fn origins<S: RangeState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
) -> Vec<Origin<S>> {
    let reasons: Vec<Reason<S>> = vec![
        (
            "crown",
            "The tallest point of a range, however it rises.",
            vec![],
            Rc::new(|state, _| crowns(state)),
        ),
        (
            "carried",
            "The greatest top where the coarser map named a peak.",
            vec![],
            Rc::new(|state, _| carried(state)),
        ),
        (
            "high",
            "A top ruling its part of a range.",
            vec![],
            Rc::new(high),
        ),
        (
            "lone",
            "A top standing well clear of its country.",
            vec![],
            Rc::new(lone),
        ),
        (
            "seaMark",
            "A top rising from the sea that sailors steer by.",
            vec![],
            Rc::new(sea_marks),
        ),
        (
            "horn",
            "The top a great crossing is known by.",
            vec![],
            Rc::new(horns),
        ),
        (
            "town",
            "The mountain a town in the hills lives under, by chance and by its size.",
            vec![Kind::Settlement],
            Rc::new(|state, _| towns(state)),
        ),
    ];
    reasons
        .into_iter()
        .map(|(id, statement, reads, finds)| Origin {
            id: id.into(),
            statement: statement.into(),
            reads,
            finds,
        })
        .collect()
}
