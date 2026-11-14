use crate::{
    field::shared::Scalar as F,
    magic::{
        inventory::Inventory,
        sources::{geothermal::mineralize, Context, Environment},
        state::MagicField,
    },
    rock::{
        cargo::CargoMixture,
        catalogue::material,
        ground::{alteration::Alteration, Charge},
        load::MaterialLoad,
        organic,
    },
    scale::MapScale,
    water::network::RiverReader,
};
use std::io;
pub fn buried_charge(sap: f64, buried: f64, remaining: f64, share: f64) -> f64 {
    let carbon = buried.max(0.0) + remaining.max(0.0);
    if carbon > 0.0 {
        sap.max(0.0) * buried.max(0.0) / carbon * share.clamp(0.0, 1.0)
    } else {
        0.0
    }
}
pub struct LitterPacket {
    pub carbon: f64,
    pub volume: f64,
    pub density: f64,
    pub amount: f64,
}
pub fn litter_packet(
    sap: f64,
    carbon: f64,
    area: f64,
    share: f64,
    affinity: f64,
) -> Option<LitterPacket> {
    let carbon = carbon.max(0.0) * share.clamp(0.0, 1.0);
    let mass = carbon * area;
    let volume = mass / organic::DENSITY;
    if volume <= 0.0 || sap <= 0.0 {
        return None;
    }
    let density = (sap * share / mass).min(affinity) * organic::DENSITY;
    let amount = volume * density;
    (amount > 0.0).then_some(LitterPacket {
        carbon,
        volume,
        density,
        amount,
    })
}
pub fn bury_living_charge(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
) -> io::Result<()> {
    let Some(sap) = field.stock_index(context.origin, "sap") else {
        return Ok(());
    };
    let Inventory::Ground(key) = field.origins[context.origin].stocks[stock] else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let burial = env.scalar(F::OrganicBurialInput, cell)?;
        let amount = buried_charge(
            field.origins[context.origin].stocks[sap].get(env.ground, cell)?,
            burial,
            env.scalar(F::SoilCarbon, cell)? + env.scalar(F::PeatCarbon, cell)?,
            p.strata_share,
        )
        .min(burial * env.mesh.area(cell) * p.organic_charge_affinity);
        let thickness = env.scalar(F::OrganicBurialThickness, cell)?;
        let depth = MapScale::native(thickness.min(burial / organic::DENSITY));
        let offset = (MapScale::native(thickness) - depth).max(0.0);
        if amount <= 0.0 || depth <= 0.0 {
            continue;
        }
        let epoch = env.ground.completed_epochs();
        env.ground.alter(
            cell,
            &Alteration {
                depth,
                offset,
                retained_only: true,
                from_rock: false,
                facet: None,
                transform: &|layer| mineralize(layer, 20, epoch),
            },
        )?;
        let admitted = env.ground.inventory_charge(
            key,
            cell,
            &Charge {
                amount,
                reach: depth,
                hosts: &[20],
                from_rock: false,
                start: offset,
            },
        )?;
        field.origins[context.origin].stocks[sap].add(env.ground, cell, -admitted)?;
    }
    Ok(())
}
pub fn carry_litter(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    rivers: &RiverReader<'_>,
    load: &mut MaterialLoad,
) -> io::Result<()> {
    let Some(stratum) = field.stock_index(context.origin, "stratum") else {
        return Ok(());
    };
    let Inventory::Ground(key) = field.origins[context.origin].stocks[stratum] else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    let carbon_key = organic::cargo_key(env.ground)?;
    for cell in 0..env.mesh.len() {
        let kind = env.water.column.kind.get(cell)?;
        if kind == 1 || rivers.order_at(cell, kind) == 0 {
            continue;
        }
        let Some(packet) = litter_packet(
            field.origins[context.origin].stocks[stock].get(env.ground, cell)?,
            env.scalar(F::SoilCarbon, cell)?,
            env.mesh.area(cell),
            p.placer_mobility * (env.water.runoff.mean.get(cell)? / 1000.0).clamp(0.0, 1.0),
            p.organic_charge_affinity,
        ) else {
            continue;
        };
        let mut carbon = env.fields.scalar_mut(F::SoilCarbon);
        carbon.set(cell, carbon.get(cell)? - packet.carbon)?;
        field.origins[context.origin].stocks[stock].add(env.ground, cell, -packet.amount)?;
        let mut parcel = material(20, packet.volume, env.ground.completed_epochs());
        let mut cargo = CargoMixture::default();
        cargo.add(Some(&key.cargo(20, packet.density)), 1.0);
        cargo.add(Some(&carbon_key.cargo(0, organic::DENSITY)), 1.0);
        parcel.cargo = cargo.finish(1.0);
        load.add(cell, &parcel)?;
    }
    Ok(())
}
