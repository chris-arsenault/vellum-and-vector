use super::{configuration::Effects, Workspace};
use crate::{
    chance::Chance,
    field::{shared::Scalar as F, surface_media::Melt},
    magic::{material, sources::Environment, state::MagicField, stocks::ice},
    rock::{catalogue, ground::alteration::Alteration, material::MaterialLayer},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    water::Water,
};
use std::io;
pub fn apply(
    env: &mut Environment<'_>,
    water: &mut Water,
    fields: &mut [MagicField],
    meetings: &Workspace,
    seed: i32,
    exposure: f64,
) -> io::Result<()> {
    if exposure <= 0.0 {
        return Ok(());
    }
    for held in &meetings.states {
        let definition = &meetings.definitions[held.definition];
        let salt = seed ^ 0x51f7 ^ definition.rule.id.encode_utf16().count() as i32;
        for cell in 0..env.mesh.len() {
            let share = held.coverage.get(cell)?;
            if share <= 0.0 {
                continue;
            }
            rock(env, water, cell, share, &definition.effects, salt)?;
            material::meeting(
                env,
                definition.ground_material.map(|kind| kind.code()),
                cell,
                share,
                salt,
            )?;
            life(
                env,
                water,
                fields,
                (cell, share),
                &definition.effects,
                exposure,
            )?;
        }
    }
    Ok(())
}
fn rock(
    env: &mut Environment<'_>,
    water: &mut Water,
    cell: usize,
    share: f64,
    effects: &Effects,
    salt: i32,
) -> io::Result<()> {
    if effects.fracture_conductance != 0.0 {
        let mut band = env.fields.scalar_mut(F::FractureConductance);
        band.set(
            cell,
            (band.get(cell)? + (effects.fracture_conductance * share + 0.5).floor())
                .clamp(0.0, 1000.0),
        )?;
    }
    if effects.rock_resistance != 0.0 {
        alter_resistance(env, cell, (effects.rock_resistance * share + 0.5).floor())?;
    }
    if effects.relief != 0.0 {
        let sign = Chance::of(salt, 0).signed([cell as f64, 0.0]);
        env.ground.displace(
            cell,
            MapScale::native(effects.relief * share * sign),
            "confluences",
        )?;
    }
    if effects.soil_removal != 0.0 {
        env.ground
            .spoil_soil(cell, effects.soil_removal * share, "confluences")?;
        water.lose_soil_water(cell, effects.soil_removal * share)?;
    }
    Ok(())
}
pub(crate) fn alter_resistance(
    env: &mut Environment<'_>,
    cell: usize,
    change: f64,
) -> io::Result<()> {
    if change == 0.0 {
        return Ok(());
    }
    let depth = MapScale::native(
        env.scale
            .resolve(RelativeMeasure::length(0.000035).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value(),
    );
    let epoch = env.ground.completed_epochs();
    env.ground.alter(
        cell,
        &Alteration {
            depth,
            offset: 0.0,
            from_rock: false,
            retained_only: false,
            facet: None,
            transform: &|layer| {
                Some(MaterialLayer {
                    strength: (layer.strength + change)
                        .clamp(catalogue::SOFTEST_ROCK, catalogue::HARDEST_ROCK),
                    altered: epoch,
                    ..layer.clone()
                })
            },
        },
    )
}
fn life(
    env: &mut Environment<'_>,
    water: &mut Water,
    fields: &mut [MagicField],
    at: (usize, f64),
    effects: &Effects,
    exposure: f64,
) -> io::Result<()> {
    let (cell, share) = at;
    if effects.fog != 0.0 {
        let mut values = env.fields.scalar_mut(F::FogForcing);
        values.set(cell, values.get(cell)?.max(effects.fog * share))?;
    }
    if effects.ice_melt != 0.0 {
        ice::melt(
            env,
            water,
            fields,
            &Melt {
                cell,
                amount: effects.ice_melt * share * exposure,
                cause: "confluences".into(),
                beneath: true,
                exposure,
            },
        )?;
    }
    if effects.debris != 0.0 {
        let depth = MapScale::native(effects.debris * share);
        if depth > 0.0 {
            env.ground.weather_facets(cell, [depth; 2], "confluences")?;
            env.ground.record_sediment_export(
                MapScale::metres(depth, LengthUnit::Native) * env.mesh.area(cell),
                0.0,
            );
        }
    }
    if effects.toxicity != 0.0 {
        let mut values = env.fields.scalar_mut(F::EcologicalToxicity);
        values.set(cell, values.get(cell)?.max(effects.toxicity * share))?;
    }
    Ok(())
}
