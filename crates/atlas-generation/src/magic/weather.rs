use super::{carriers::passage, sources::Environment};
use crate::{
    climate::aligned_neighbor,
    field::shared::Scalar as F,
    rock::{
        catalogue::KIND_COUNT, ground::GroundField, load::MaterialLoad, material::MaterialMixture,
    },
    scale::{LengthUnit, MapScale},
    settlement::{
        removal::{Facet, MaterialPool, RemovalGround, Withdrawal},
        stage::Pool,
    },
    storage::ReadBand,
    water::Water,
};
use std::io;
pub struct Settings {
    pub storm_scour: f64,
    pub dune_mobility: f64,
}
pub struct Carriers<'a> {
    pub load: &'a mut MaterialLoad,
    pub sea: &'a mut MaterialLoad,
    pub wind: Option<&'a ReadBand<f64>>,
}
pub fn write(
    env: &mut Environment<'_>,
    water: &mut Water,
    settings: &Settings,
    carriers: &mut Carriers<'_>,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        let track = env.scalar(F::StormTrack, cell)? / 1000.0;
        if track <= 0.0 || env.water.column.kind.get(cell)? != 0 {
            continue;
        }
        let scour =
            settings.storm_scour * track * (env.scalar(F::Slope, cell)? / 0.05).clamp(0.0, 1.0);
        env.ground.spoil_soil(cell, scour, "storms")?;
        water.lose_soil_water(cell, scour)?;
        let cover = env.scalar(F::TreeCover, cell)?
            + env.scalar(F::GrassCover, cell)?
            + env.scalar(F::WetlandCover, cell)?;
        if cover < 0.12 {
            drive_dunes(env, cell, settings.dune_mobility * track, carriers)?;
        }
    }
    Ok(())
}
fn drive_dunes(
    env: &mut Environment<'_>,
    cell: usize,
    share: f64,
    carriers: &mut Carriers<'_>,
) -> io::Result<()> {
    let available = env.ground.view(GroundField::SedimentThickness).get(cell)? * share;
    if available <= 0.0 {
        return Ok(());
    }
    let Some(target) = aligned_neighbor(
        env.mesh,
        cell,
        [
            env.scalar(F::WindX, cell)? / 1000.0,
            env.scalar(F::WindY, cell)? / 1000.0,
        ],
    ) else {
        return Ok(());
    };
    let moving = available * passage(env, carriers.wind, target)?;
    if moving <= 0.0 {
        return Ok(());
    }
    let skin = env.ground.view(GroundField::SoilDepth).get(cell)?;
    let mut mixture = MaterialMixture::new(KIND_COUNT);
    let mut volume = 0.0;
    for facet in Facet::ALL {
        if env.ground.share(cell, facet)? <= 0.0 {
            continue;
        }
        env.ground.withdraw(
            Withdrawal {
                cell,
                facet,
                pool: MaterialPool::Loose,
                amount: moving,
                cause: "pressure",
                soil: skin,
            },
            &mut |material| {
                let amount =
                    MapScale::metres(material.depth, LengthUnit::Native) * env.mesh.area(cell);
                mixture.add(&material, amount).map_err(io::Error::other)?;
                volume += amount;
                Ok(())
            },
        )?;
    }
    let Some(mut carried) = mixture.material(volume) else {
        return Ok(());
    };
    if env.water.column.kind.get(target)? == 1 {
        return env.ground.carry_out(
            volume,
            "pressure",
            Some(&carried),
            Some((target, carriers.sea)),
        );
    }
    let area = env.mesh.area(target);
    carried.depth = MapScale::native(volume / area);
    let deposited =
        env.ground
            .deposit_package(target, &[carried.clone()], "pressure", Pool::Load, None)?;
    carried.depth = volume - MapScale::metres(deposited, LengthUnit::Native) * area;
    if carried.depth > 0.0 {
        carriers.load.add(target, &carried)?;
    }
    Ok(())
}
