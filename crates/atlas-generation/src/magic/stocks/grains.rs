use super::Transport;
use crate::{
    magic::{carriers::passage, inventory::Inventory, sources::Environment, state::MagicField},
    rock::{
        ground::{inventory::InventoryKey, InventoryAccess},
        load::MaterialLoad,
    },
    scale::{LengthUnit, MapScale},
    settlement::stage::Pool,
};
use std::io;
pub(super) fn key(field: &MagicField, origin: usize, stock: usize) -> io::Result<InventoryKey> {
    match field.origins[origin].stocks[stock] {
        Inventory::Ground(key) => Ok(key),
        _ => Err(io::Error::other("Solid Salt must belong to Ground")),
    }
}
pub(super) struct Hop {
    pub origin: usize,
    pub stock: usize,
    pub destination: Option<usize>,
    pub cell: usize,
    pub target: usize,
    pub amount: f64,
    pub loose_only: bool,
}
pub(super) fn move_grains(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    cargo: &mut MaterialLoad,
    transport: &mut Transport<'_>,
    hop: Hop,
) -> io::Result<()> {
    let key = key(field, hop.origin, hop.stock)?;
    let destination =
        hop.destination
            .and_then(|stock| match field.origins[hop.origin].stocks[stock] {
                Inventory::Ground(key) => Some(key),
                _ => None,
            });
    let sea = env.water.column.kind.get(hop.target)? == 1;
    let amount = hop.amount * passage(env, transport.costs.wind.as_ref(), hop.target)?;
    if amount <= 0.0 {
        return Ok(());
    }
    let available = env.ground.inventory_get(key, hop.cell)?;
    let carried = env.ground.inventory_extract(
        key,
        hop.cell,
        amount.min(available),
        &InventoryAccess {
            reach: f64::INFINITY,
            surface_only: true,
            loose_only: hop.loose_only,
        },
        &mut |mut material| {
            material.cargo = material.cargo.as_ref().and_then(|held| {
                if sea {
                    Some(key.remove_cargo(held))
                } else if let Some(destination) = destination {
                    key.rekey_cargo(held, destination)
                } else {
                    Some(held.clone())
                }
            });
            material.depth =
                MapScale::metres(material.depth, LengthUnit::Native) * env.mesh.area(hop.cell);
            if sea {
                transport.sea.add(hop.target, &material)
            } else {
                cargo.add(hop.target, &material)
            }
        },
    )?;
    if sea {
        field.lost += carried;
    }
    Ok(())
}
pub(super) fn deposit(env: &mut Environment<'_>, cargo: &MaterialLoad) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        let mut material = cargo.get(cell)?;
        if material.depth <= 0.0 {
            continue;
        }
        material.depth =
            MapScale::in_units(material.depth / env.mesh.area(cell), LengthUnit::Native);
        env.ground
            .deposit_package(cell, &[material], "salt", Pool::Load, None)?;
    }
    Ok(())
}
pub(super) fn dissolve(
    env: &mut Environment<'_>,
    field: &MagicField,
    origin: usize,
    stock: usize,
    cell: usize,
    amount_reach: [f64; 2],
) -> io::Result<f64> {
    let [amount, reach] = amount_reach;
    if amount <= 0.0 {
        return Ok(0.0);
    }
    let key = key(field, origin, stock)?;
    let amount = amount.min(env.ground.inventory_get(key, cell)?);
    env.ground.inventory_extract(
        key,
        cell,
        amount,
        &InventoryAccess {
            reach,
            surface_only: false,
            loose_only: false,
        },
        &mut |_| Ok(()),
    )
}
