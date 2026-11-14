//! Captured atmospheric context responds to local relief without reapplying old forcing.
use super::{latitude, read, thermal, wind::Terrain, write, Settings};
use crate::{
    climate::air_year,
    field::{
        contributions::{Contributions, Medium},
        refinement::media::{gradients, Media},
        shared::Scalar as S,
        Field,
    },
    lattice::Membership,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::RelativeOverrides,
    storage::{Band, ReadBand},
};
use std::io;
pub struct Lengths {
    elevation: f64,
    continentality: f64,
    moisture: f64,
    fog_drip: f64,
}
impl Lengths {
    pub fn new(p: &Settings, cell_span: f64) -> io::Result<Self> {
        let x = p
            .world_extent_x
            .ok_or_else(|| io::Error::other("Inherited atmosphere requires the world frame"))?;
        let y = p
            .world_extent_y
            .ok_or_else(|| io::Error::other("Inherited atmosphere requires the world frame"))?;
        let scale =
            MapScale::from_bounds([x[0], y[0], x[1], y[1]], cell_span).map_err(io::Error::other)?;
        let defaults = Settings::from_resolved(
            &scale
                .resolve_settings(&super::settings::settings(), &RelativeOverrides::default())
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?;
        Ok(Self {
            elevation: defaults.elevation_scale,
            continentality: defaults.continentality_distance,
            fog_drip: defaults.fog_drip,
            moisture: scale
                .resolve(RelativeMeasure::length(0.0000025).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
                .value(),
        })
    }
}
pub struct Capture {
    temperature: Band<f64>,
    rainfall: Band<f64>,
    snowfall: Band<f64>,
    moisture: Band<f64>,
    wind_x: Band<f64>,
    wind_y: Band<f64>,
    ocean_distance: Band<f64>,
    heat: Band<f64>,
    fog: Band<f64>,
    lengths: Lengths,
}
impl Capture {
    pub fn new(field: &Field, p: &Settings) -> io::Result<Self> {
        let lengths = Lengths::new(p, field.scale.cells(1.0))?;
        let mut coverage = field.coverage.borrow_mut();
        let mut copy = |name| coverage.copy_band(&field.shared.derive_scalar(name));
        let temperature = copy(S::Temperature)?;
        let rainfall = copy(S::Rainfall)?;
        let snowfall = copy(S::Snowfall)?;
        let moisture = copy(S::Moisture)?;
        let wind_x = copy(S::WindX)?;
        let wind_y = copy(S::WindY)?;
        let ocean_distance = copy(S::OceanDistance)?;
        let mut heat = coverage.allocate(0.0);
        let mut fog = coverage.allocate(0.0);
        for cell in 0..field.mesh.len() {
            heat.set(cell, thermal::forcing(field, p, cell)? / 10.0)?;
            fog.set(cell, read(field, S::FogForcing, cell)? * lengths.fog_drip)?;
        }
        Ok(Self {
            temperature,
            rainfall,
            snowfall,
            moisture,
            wind_x,
            wind_y,
            ocean_distance,
            heat,
            fog,
            lengths,
        })
    }
    pub fn ocean_distance(&self) -> ReadBand<f64> {
        self.ocean_distance.read_only()
    }
    pub fn respond(
        &self,
        field: &Field,
        p: &Settings,
        inherited_height: &ReadBand<f64>,
        applied: &Contributions,
        media: Option<&Media>,
    ) -> io::Result<()> {
        self.deflect_wind(field, p)?;
        let (gx, gy) = gradients(field)?;
        let height = field.ground().view(GroundField::Elevation);
        for cell in 0..field.mesh.len() {
            if field.mesh.membership(cell) != Membership::Content {
                continue;
            }
            let delta = MapScale::metres(
                height.get(cell)? - inherited_height.get(cell)?,
                LengthUnit::Native,
            );
            let exposure = MapScale::metres(
                gx[cell] * read(field, S::WindX, cell)? + gy[cell] * read(field, S::WindY, cell)?,
                LengthUnit::Millimetre,
            );
            let rain_factor = 1.0 + 0.35 * (exposure / 0.01).tanh();
            let aspect = media.map_or(0.0, |m| m.insolation[cell] * 3.0 - m.pooling[cell] * 4.0);
            let terrain = -delta * p.elevation_temperature_lapse / self.lengths.elevation / 10.0
                + aspect
                + applied.applied_to(Medium::Shared(S::Temperature), cell)? / 10.0;
            let temperature = self.temperature(field, p, cell, terrain)?;
            write(
                field,
                S::Temperature,
                cell,
                ((temperature + 30.0) * 10.0 + 0.5).floor(),
            )?;
            self.precipitation(field, p, cell, rain_factor, applied)?;
            let moisture = self.moisture.get(cell)? * rain_factor - delta / self.lengths.moisture
                + applied.applied_to(Medium::Shared(S::Moisture), cell)?;
            write(
                field,
                S::Moisture,
                cell,
                (moisture.clamp(0.0, 1000.0) + 0.5).floor(),
            )?;
        }
        Ok(())
    }
    fn temperature(
        &self,
        field: &Field,
        p: &Settings,
        cell: usize,
        terrain: f64,
    ) -> io::Result<f64> {
        Ok(
            self.temperature.get(cell)? / 10.0 - 30.0 - self.heat.get(cell)?
                + thermal::forcing(field, p, cell)? / 10.0
                + terrain,
        )
    }
    fn deflect_wind(&self, field: &Field, p: &Settings) -> io::Result<()> {
        let terrain = Terrain::new(field, p)?;
        for cell in 0..field.mesh.len() {
            if field.mesh.membership(cell) != Membership::Content {
                continue;
            }
            let x = self.wind_x.get(cell)? / 1000.0;
            let y = self.wind_y.get(cell)? / 1000.0;
            let speed = x.hypot(y);
            if speed == 0.0 {
                continue;
            }
            let [dx, dy] = terrain.deflect(p, cell, [x / speed, y / speed])?;
            write(field, S::WindX, cell, (dx * speed * 1000.0 + 0.5).floor())?;
            write(field, S::WindY, cell, (dy * speed * 1000.0 + 0.5).floor())?;
        }
        Ok(())
    }
    fn precipitation(
        &self,
        field: &Field,
        p: &Settings,
        cell: usize,
        rain_factor: f64,
        applied: &Contributions,
    ) -> io::Result<()> {
        let captured = self.rainfall.get(cell)? + self.snowfall.get(cell)?;
        let current_fog = read(field, S::FogForcing, cell)? * self.lengths.fog_drip;
        let total = (((captured - self.fog.get(cell)?).max(0.0) * rain_factor + current_fog)
            .max(0.0)
            + applied.applied_to(Medium::Shared(S::Rainfall), cell)?
            + applied.applied_to(Medium::Shared(S::Snowfall), cell)?)
        .max(0.0);
        let distance = read(field, S::OceanDistance, cell)?;
        let continentality = if super::ocean(field, cell)? || distance < 0.0 {
            0.0
        } else {
            distance / self.lengths.continentality
        };
        let half_range = thermal::seasonality(p, latitude(field, p, cell), continentality);
        let temperature = read(field, S::Temperature, cell)?;
        let snow = total * thermal::snow_share(p, temperature, half_range * 10.0) / 1000.0;
        write(field, S::Seasonality, cell, half_range)?;
        write(field, S::Snowfall, cell, snow)?;
        write(field, S::Rainfall, cell, total - snow)?;
        let year = air_year(
            latitude(field, p, cell),
            p.axial_tilt,
            temperature,
            half_range,
            0.0,
        );
        write(field, S::AirDemand, cell, year.demand.iter().sum())
    }
}
