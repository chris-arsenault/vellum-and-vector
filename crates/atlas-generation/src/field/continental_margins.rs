//! Today's coast supplies the sediment frame; crust support owns structural relief.
use super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, QueryDependency},
    hpc::{Direction, KeyedHeap},
    storage::ReadBand,
};
use std::io;

fn land_margin(field: &Field, water: &ReadBand<u8>, cell: usize) -> io::Result<Option<(i32, f64)>> {
    let mut selected = None;
    let mut priority = -1;
    let mut distance = f64::INFINITY;
    for edge in 0..3 {
        let Some(next) = field.mesh.neighbor(cell, edge) else {
            continue;
        };
        if water.get(next)? == 1 {
            continue;
        }
        let margin = field.shared.code(C::MarginCodes).get(next)?;
        let rank = [0, 1, 4, 3, 2][margin as usize];
        if rank > priority {
            selected = Some(margin);
            priority = rank;
        }
        distance = distance.min(field.mesh.edge_length(cell, edge) / 2.0);
    }
    Ok(selected.map(|margin| (margin, distance)))
}
fn seed(field: &mut Field, water: &ReadBand<u8>) -> io::Result<KeyedHeap> {
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for cell in 0..field.mesh.len() {
        field
            .shared
            .scalar_mut(S::OceanMarginDistance)
            .set(cell, f64::INFINITY)?;
        field.shared.code_mut(C::CoastalMarginCodes).set(cell, 0)?;
        if water.get(cell)? == 1 {
            if let Some((margin, distance)) = land_margin(field, water, cell)? {
                field
                    .shared
                    .scalar_mut(S::OceanMarginDistance)
                    .set(cell, distance)?;
                field
                    .shared
                    .code_mut(C::CoastalMarginCodes)
                    .set(cell, margin)?;
                queue.push(u32::try_from(cell).map_err(io::Error::other)?, [distance]);
            }
        } else {
            for edge in 0..3 {
                let Some(next) = field.mesh.neighbor(cell, edge) else {
                    continue;
                };
                if water.get(next)? == 1 {
                    field
                        .shared
                        .scalar_mut(S::OceanMarginDistance)
                        .set(cell, -1.0)?;
                    let margin = field.shared.code(C::MarginCodes).get(cell)?;
                    field
                        .shared
                        .code_mut(C::CoastalMarginCodes)
                        .set(cell, margin)?;
                    break;
                }
            }
        }
    }
    Ok(queue)
}
fn frame(field: &mut Field) -> io::Result<()> {
    let water = field.water().column.kind;
    let mut queue = seed(field, &water)?;
    while let Some((cell, [distance])) = queue.pop() {
        let cell = cell as usize;
        if distance != field.shared.scalar(S::OceanMarginDistance).get(cell)? {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            let d = distance + field.mesh.edge_length(cell, edge);
            if field.shared.scalar(S::OceanMarginDistance).get(next)? <= d || water.get(next)? != 1
            {
                continue;
            }
            field
                .shared
                .scalar_mut(S::OceanMarginDistance)
                .set(next, d)?;
            let margin = field.shared.code(C::CoastalMarginCodes).get(cell)?;
            field
                .shared
                .code_mut(C::CoastalMarginCodes)
                .set(next, margin)?;
            queue.push(u32::try_from(next).map_err(io::Error::other)?, [d]);
        }
    }
    for cell in 0..field.mesh.len() {
        let distance = field.shared.scalar_mut(S::OceanMarginDistance);
        if !distance.get(cell)?.is_finite() {
            distance.set(cell, 0.0)?;
        }
    }
    Ok(())
}
impl Field {
    pub fn continental_margin_evolution(dependencies: Vec<QueryDependency<Self>>) -> Command<Self> {
        Command::new(
            "continental-margin-evolution",
            CommandKind::Work,
            dependencies,
            |field, _| frame(field).map_err(Into::into),
        )
    }
}
