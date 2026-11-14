use super::{
    country,
    identity_era::{place, Era},
    identity_reads::leading_of,
    traditions::{Founding, Kind},
    work::km2,
};
use crate::{
    execution::{Command, CommandKind},
    field::Field,
    human::operations::{self, Rename},
    scale::RelativeMeasure,
};
use std::{io, rc::Rc};

fn gathering(field: &Field, cells: &[usize]) -> io::Result<(f64, Option<usize>)> {
    let mut total = 0.0;
    let mut centre = None;
    let mut most = f64::NEG_INFINITY;
    for &cell in cells {
        let count = field.people.people(cell)? * km2(field, cell);
        total += count;
        if count > most {
            most = count;
            centre = Some(cell);
        }
    }
    Ok((total, centre))
}
fn countries(field: &Field, cells: &[usize]) -> Vec<Vec<usize>> {
    let mut waiting = vec![false; field.mesh.len()];
    for &cell in cells {
        waiting[cell] = true;
    }
    let mut found = Vec::new();
    for &start in cells {
        if !std::mem::replace(&mut waiting[start], false) {
            continue;
        }
        let mut country = vec![start];
        let mut at = 0;
        while at < country.len() {
            for edge in 0..3 {
                if let Some(next) = field.mesh.neighbor(country[at], edge) {
                    if std::mem::replace(&mut waiting[next], false) {
                        country.push(next);
                    }
                }
            }
            at += 1;
        }
        found.push(country);
    }
    found
}
fn sundered(
    field: &Field,
    era: &Era,
    leading: &[i32],
    code: i32,
) -> io::Result<Vec<(Vec<usize>, usize)>> {
    let holders: Vec<usize> = leading
        .iter()
        .enumerate()
        .filter_map(|(cell, &held)| (held == code).then_some(cell))
        .collect();
    let (whole, centre) = gathering(field, &holders)?;
    let Some(centre) = centre else {
        return Ok(Vec::new());
    };
    let travel = era.travel(field)?;
    let reach = field
        .scale
        .resolve(RelativeMeasure::length(0.2).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let within = country::spread(
        field,
        &[centre],
        &|a, b| travel.step(a, b),
        reach,
        None,
        &era.links,
    )?;
    let away: Vec<usize> = holders
        .into_iter()
        .filter(|&cell| within.owner[cell] < 0)
        .collect();
    let mut daughters = Vec::new();
    for cells in countries(field, &away) {
        let (people, centre) = gathering(field, &cells)?;
        if people >= 0.05 * whole {
            if let Some(centre) = centre {
                daughters.push((cells, centre));
            }
        }
    }
    Ok(daughters)
}
pub fn operation(owner: Rc<operations::Operations<Field>>) -> Command<Field, Era> {
    Command::with_inputs(
        "human.identity.sunder",
        CommandKind::Event,
        vec![],
        move |context, era: &Era| {
            for kind in [Kind::Tongue, Kind::Custom] {
                let leading = leading_of(context.state(), kind.field())?;
                let known = era.memory.borrow().traditions.known.clone();
                for tradition in known
                    .into_iter()
                    .filter(|t| t.kind == kind && t.ended.is_none())
                {
                    let field = context.state();
                    let mut becomes = field.coverage.borrow_mut().scratch(field.mesh.len(), -1i32);
                    for (cells, centre) in sundered(field, era, &leading.code, tradition.code)? {
                        let daughter = era.memory.borrow_mut().found(Founding {
                            kind,
                            key: format!("{}:{}:{centre}", tradition.entity, era.era),
                            origin: place(field, centre),
                            era: era.era.clone(),
                            parent: Some(tradition.code),
                            tongue: (kind == Kind::Tongue).then_some(tradition.code),
                        })?;
                        for cell in cells {
                            becomes.set(cell, daughter)?;
                        }
                    }
                    context.run(
                        &owner.rename,
                        &Rename {
                            tradition: kind.field(),
                            from: tradition.code,
                            to: becomes.read_only(),
                        },
                    )?;
                }
            }
            Ok(())
        },
    )
}
