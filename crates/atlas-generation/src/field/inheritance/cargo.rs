//! Sparse material custody uses the same complete donor as its column resources.
use super::{donor, resources::Cargo};
use crate::{
    field::FieldSeed,
    lattice::TriangularLattice,
    reconstruction::Grid,
    rock::{cargo::MaterialCargo, columns::Column},
};
use std::io;

fn integer(value: f64, max: usize) -> io::Result<usize> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > max as f64 {
        Err(io::Error::other(
            "Cargo requires a representable integer identity",
        ))
    } else {
        Ok(value as usize)
    }
}
fn slots() -> Vec<(Column, usize)> {
    Column::ALL
        .into_iter()
        .flat_map(|column| (0..column.size()).map(move |slot| (column, slot)))
        .collect()
}
fn keys(input: &Cargo, seed: &mut FieldSeed) -> io::Result<Vec<i32>> {
    let mut expected = Vec::new();
    for (column, name) in Column::ALL
        .into_iter()
        .zip(["land", "cut", "loose", "cutLoose"])
    {
        for slot in 0..column.size() {
            expected.push(format!("{name}:{slot}"));
        }
    }
    expected.extend(["ground-load".into(), "sea-load".into()]);
    if input.slots != expected || input.keys.len() != input.released_to.len() {
        return Err(io::Error::other(
            "Cargo import requires complete current slots and release targets",
        ));
    }
    let keys = input
        .keys
        .iter()
        .map(|name| {
            seed.ground
                .identities
                .declare(name, None)
                .map_err(io::Error::other)
        })
        .collect::<io::Result<Vec<_>>>()?;
    for (index, name) in input.keys.iter().enumerate() {
        let target = &input.released_to[index];
        let target_index = input
            .keys
            .iter()
            .position(|name| name == target)
            .ok_or_else(|| io::Error::other("Cargo release target is missing"))?;
        if input.released_to[target_index] != *target {
            return Err(io::Error::other(
                "Captured custody must return directly to an ordinary identity",
            ));
        }
        seed.ground
            .identities
            .declare(name, Some(target))
            .map_err(io::Error::other)?;
    }
    Ok(keys)
}
pub fn import(
    seed: &mut FieldSeed,
    mesh: &TriangularLattice,
    grid: &Grid,
    input: &Cargo,
) -> io::Result<()> {
    let keys = keys(input, seed)?;
    let slots = slots();
    for cell in 0..mesh.len() {
        let source = donor(mesh, grid, cell)?;
        if source + 1 >= input.offsets.len() {
            return Err(io::Error::other(
                "Material donor must address captured cells",
            ));
        }
        let start = input.offsets.get(source)? as usize;
        let end = input.offsets.get(source + 1)? as usize;
        if start > end || end > input.records.len() / 4 {
            return Err(io::Error::other(
                "Material offsets must address their records",
            ));
        }
        clear(seed, cell, &slots)?;
        install_cell(seed, cell, &slots, input, &keys, start..end)?;
    }
    Ok(())
}
fn clear(seed: &mut FieldSeed, cell: usize, slots: &[(Column, usize)]) -> io::Result<()> {
    for &(column, slot) in slots {
        seed.ground.columns.import_cargo(cell, column, slot, None)?;
    }
    seed.ground_load.import_cargo(cell, None)?;
    seed.sea_load.import_cargo(cell, None)
}
fn install_cell(
    seed: &mut FieldSeed,
    cell: usize,
    slots: &[(Column, usize)],
    input: &Cargo,
    keys: &[i32],
    records: std::ops::Range<usize>,
) -> io::Result<()> {
    let (mut at, end) = (records.start, records.end);
    while at < end {
        let slot = integer(input.records.get(at * 4)?, slots.len() + 1)?;
        let mut entries = Vec::new();
        loop {
            entries.push(entry(input, at, keys)?);
            at += 1;
            if at >= end || input.records.get(at * 4)? != slot as f64 {
                break;
            }
        }
        let cargo = MaterialCargo::from_entries(entries);
        if let Some(&(column, layer)) = slots.get(slot) {
            seed.ground
                .columns
                .import_cargo(cell, column, layer, Some(&cargo))?;
        } else {
            let load = if slot == slots.len() {
                &mut seed.ground_load
            } else {
                &mut seed.sea_load
            };
            load.import_cargo(cell, Some(&cargo))?;
        }
    }
    Ok(())
}
fn entry(input: &Cargo, at: usize, keys: &[i32]) -> io::Result<(i32, i32, f64)> {
    let key = integer(input.records.get(at * 4 + 1)?, keys.len())?
        .checked_sub(1)
        .and_then(|index| keys.get(index))
        .copied()
        .ok_or_else(|| io::Error::other("Cargo requires a named reservoir"))?;
    let host = integer(input.records.get(at * 4 + 2)?, i32::MAX as usize)? as i32;
    let density = input.records.get(at * 4 + 3)?;
    if !density.is_finite() || density <= 0.0 {
        return Err(io::Error::other("Cargo requires positive finite density"));
    }
    Ok((key, host, density))
}
