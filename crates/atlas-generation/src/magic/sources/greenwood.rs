use super::{site_strength, Context, Environment};
use crate::{
    field::shared::Scalar as F,
    magic::{
        channels::Channel as C,
        state::{LocatedSource, MagicField},
    },
    rock::ground::{
        queries::surface_fact,
        query::{average, ground_fact, Fact, GroundQuery},
        GroundField,
    },
    water::ledger::SECONDS_PER_YEAR,
};
use std::io;
pub fn verdant(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let sap = field.stock_index(context.origin, "sap");
    for cell in 0..env.mesh.len() {
        if !env.land_without_ice(cell)? {
            continue;
        }
        let canopy = env.scalar(F::BroadleafCover, cell)? + env.scalar(F::ConiferCover, cell)?;
        let age = env.scalar(F::CanopyAge, cell)?;
        let peat = env.scalar(F::PeatCarbon, cell)?;
        let mut strength: f64 = 0.0;
        if canopy >= p.stand_cover && age >= p.stand_age {
            strength = 500.0 + 300.0 * ((age - p.stand_age) / p.stand_age.max(1.0)).clamp(0.0, 1.0);
        }
        if peat >= p.peat_depth {
            strength =
                strength.max(400.0 + 300.0 * (peat / p.peat_depth.max(1e-9) - 1.0).clamp(0.0, 1.0));
        }
        strength *= context.activity;
        if let Some(sap) = sap {
            if canopy >= p.stand_cover && age > 0.0 {
                let grove = (field.origins[context.origin].stocks[sap].get(env.ground, cell)?
                    / env.mesh.area(cell)
                    / p.grove_sap)
                    .clamp(0.0, 1.0);
                strength = strength.max(500.0 * grove);
            }
        }
        let site = site_strength(strength);
        if site > 0.0 {
            field.channels.band_mut(C::Source).set(cell, site)?;
        }
    }
    Ok(())
}
pub fn supply_sap(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
) -> io::Result<()> {
    let Some(sap) = field.stock_index(context.origin, "sap") else {
        return Ok(());
    };
    if context.activity <= 0.0 {
        return Ok(());
    }
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        if !env.land_without_ice(cell)? {
            continue;
        }
        let canopy = env.scalar(F::BroadleafCover, cell)? + env.scalar(F::ConiferCover, cell)?;
        let mature = canopy >= p.stand_cover && env.scalar(F::CanopyAge, cell)? >= p.stand_age;
        if mature || env.scalar(F::PeatCarbon, cell)? >= p.peat_depth {
            field.origins[context.origin].stocks[sap].add(
                env.ground,
                cell,
                context.activity * env.mesh.area(cell) * 500.0 * p.sap_loss,
            )?;
        }
    }
    Ok(())
}
pub fn forge(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let Some(cracked) = field.stock_index(context.origin, "cracked") else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let held = field.origins[context.origin].stocks[cracked].get(env.ground, cell)?;
        if held <= 0.0 {
            continue;
        }
        let strength = site_strength(1000.0 * held / env.mesh.area(cell) / p.forge_strength);
        if strength <= 0.0 {
            continue;
        }
        field.channels.band_mut(C::Source).set(cell, strength)?;
        record_site(env, field, context.origin, cell, "forge", strength);
    }
    Ok(())
}
pub fn spring_response(
    charge: f64,
    water_volume: f64,
    discharge: f64,
    concentration_scale: f64,
    discharge_scale: f64,
) -> f64 {
    if charge <= 0.0 || water_volume <= 0.0 || discharge <= 0.0 {
        return 0.0;
    }
    1000.0
        / (1.0 + concentration_scale / (charge / water_volume))
        / (1.0 + discharge_scale / discharge)
}
pub fn aquifer(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let Some(aquifer) = field.stock_index(context.origin, "springwater") else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    let resistance = surface_fact(Fact::Resistance);
    let mut entry = GroundQuery::new(0.0);
    entry.rock = Some(Box::new(|_, layer, _| {
        ground_fact(layer, Fact::Solubility).max(ground_fact(layer, Fact::Porosity))
    }));
    let entry = average(entry);
    let continental = env.ground.view(GroundField::CrustContinentalFraction);
    for cell in 0..env.mesh.len() {
        if field.channels.band(C::Sealed).get(cell)? > 0.0 || !env.land_without_ice(cell)? {
            continue;
        }
        if env.ground.fold(cell, &resistance, None)? > p.spring_rock {
            continue;
        }
        let returned = env.water.groundwater.returned.get(cell)?;
        let karst =
            continental.get(cell)? / 1000.0 * (0.3 + 0.7 * env.ground.fold(cell, &entry, None)?);
        if returned <= 0.0 || karst < 0.35 {
            continue;
        }
        let volume = returned * env.mesh.area(cell);
        let strength = spring_response(
            field.origins[context.origin].stocks[aquifer].get(env.ground, cell)?,
            volume,
            volume / SECONDS_PER_YEAR,
            p.spring_charge_saturation,
            p.spring_flow,
        );
        if strength <= 0.0 {
            continue;
        }
        field.channels.band_mut(C::Source).set(cell, strength)?;
        if site_strength(strength) > 0.0 {
            record_site(env, field, context.origin, cell, "spring", strength);
        }
    }
    Ok(())
}
fn record_site(
    env: &Environment<'_>,
    field: &mut MagicField,
    origin: usize,
    cell: usize,
    name: &str,
    strength: f64,
) {
    let [x, y] = env.mesh.position(cell);
    field.located.push(LocatedSource {
        origin: field.definition.origins[origin].id.clone(),
        id: format!("{name}:{cell}"),
        x,
        y,
        radius: env.mesh.area(cell).sqrt(),
        strength,
    });
}
