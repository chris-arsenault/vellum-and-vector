use super::{latitude, ocean, read, write, Field, Settings};
use crate::{
    climate::air_year,
    field::shared::Scalar as S,
    processes::runner::PhysicalContext,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
};
use std::io;

pub(super) fn seasonality(p: &Settings, latitude: f64, continentality: f64) -> f64 {
    (p.seasonality_equator + p.seasonality_polar * latitude.to_radians().sin().powi(2))
        * (p.maritime_seasonality + (1.0 - p.maritime_seasonality) * continentality.clamp(0.0, 1.0))
}
pub(super) fn forcing(field: &Field, p: &Settings, cell: usize) -> io::Result<f64> {
    let heat = ((read(field, S::Geothermal, cell)? - p.geothermal_surface_threshold).max(0.0)
        * p.geothermal_temperature_strength
        / 1000.0)
        .trunc();
    let current = ((read(field, S::OceanCurrentHeat, cell)?
        * read(field, S::OceanCurrentStrength, cell)?
        / 1000.0)
        .trunc()
        * p.ocean_current_temperature_strength
        / 1000.0)
        .trunc();
    Ok(heat
        + current
        + read(field, S::Warmth, cell)?
        + read(field, S::ExternalHeatForcing, cell)?
        + if ocean(field, cell)? {
            read(field, S::SeaSurfaceAnomaly, cell)?
        } else {
            0.0
        }
        - (read(field, S::FogForcing, cell)? * p.fog_cooling).round()
        - (read(field, S::Evapotranspiration, cell)? * 15.0).round())
}
pub(super) fn temperature(field: &Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    let ground = field.ground();
    let elevation = ground.view(G::Elevation);
    let level = ground.effective_sea_level();
    for cell in 0..field.mesh.len() {
        let lat = latitude(field, p, cell);
        let distance = read(field, S::OceanDistance, cell)?;
        let lapse = MapScale::metres((elevation.get(cell)? - level).max(0.0), LengthUnit::Native)
            * p.elevation_temperature_lapse
            / p.elevation_scale;
        let continentality = if ocean(field, cell)? || distance < 0.0 {
            0.0
        } else {
            distance / p.continentality_distance
        };
        write(
            field,
            S::Seasonality,
            cell,
            seasonality(p, lat, continentality),
        )?;
        let insolation =
            (-p.insolation_temperature_range * (3.0 * lat.to_radians().sin().powi(2) - 1.0) / 2.0)
                .round();
        write(
            field,
            S::Temperature,
            cell,
            p.temperature_baseline + c.temperature_offset + insolation + forcing(field, p, cell)?
                - lapse,
        )?;
    }
    Ok(())
}
pub(super) fn snow_share(p: &Settings, mean: f64, half_range: f64) -> f64 {
    let amplitude = half_range.max(p.snow_temperature_transition / 2.0);
    let x = (mean - p.snow_temperature_threshold) / amplitude;
    if x >= 1.0 {
        0.0
    } else if x <= -1.0 {
        1000.0
    } else {
        (x.acos() / std::f64::consts::PI * 1000.0).round()
    }
}
pub(super) fn precipitation(field: &Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        let total = ((p.precipitation_baseline + read(field, S::ColumnPrecipitation, cell)?)
            * c.rainfall_multiplier
            + read(field, S::FogForcing, cell)? * p.fog_drip)
            .max(0.0);
        let temperature = read(field, S::Temperature, cell)?;
        let half_range = read(field, S::Seasonality, cell)?;
        let snow = total * (snow_share(p, temperature, half_range * 10.0) / 1000.0);
        write(field, S::Snowfall, cell, snow)?;
        write(field, S::Rainfall, cell, total - snow)?;
        let year = air_year(
            latitude(field, p, cell),
            p.axial_tilt,
            temperature,
            half_range,
            0.0,
        );
        write(field, S::AirDemand, cell, year.demand.into_iter().sum())?;
    }
    Ok(())
}
