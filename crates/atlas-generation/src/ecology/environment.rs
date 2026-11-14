use super::{unit, Forcing, ReadHabitat};
use crate::{
    field::shared::Scalar as S,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
    water::column::Store,
};
use std::io;
pub const WETLAND_COVER: f64 = 0.3;
pub const STANDING_WATER_SLOPE: f64 = 0.015;
pub struct Environment {
    pub temperature: f64,
    pub depth: f64,
    pub water: u8,
    pub frozen: bool,
    pub warmth: f64,
    pub moisture: f64,
    pub wetness: f64,
    pub submerged: bool,
    pub summer: f64,
    pub winter: f64,
    pub drought: f64,
}
pub fn flood_wetness(floodplain: f64, delta: f64) -> f64 {
    unit(floodplain.max(delta) / 1000.0)
}
pub fn is_wetland(map: &impl ReadHabitat, cell: usize) -> io::Result<bool> {
    Ok(wetland(
        map.with_water(|water| water.column.kind.get(cell))?,
        map.get(S::WetlandCover, cell)?,
    ))
}
pub fn wetland(water_kind: u8, cover: f64) -> bool {
    water_kind == 0 && cover >= WETLAND_COVER
}
pub fn wind_strength(map: &impl ReadHabitat, cell: usize) -> io::Result<f64> {
    let speed = map.get(S::WindSpeed, cell)?;
    Ok(if speed > 0.0 {
        speed / map.length(0.00000175)?
    } else {
        1.0
    })
}
pub fn plant_water(map: &impl ReadHabitat, cell: usize) -> io::Result<f64> {
    let fell = map.get(S::Rainfall, cell)? + map.get(S::Snowfall, cell)?;
    let demand = map.get(S::AirDemand, cell)?;
    Ok(if demand > 0.0 {
        (fell / demand).min(1.0)
    } else if fell > 0.0 {
        1.0
    } else {
        0.0
    })
}
pub fn environment(map: &impl ReadHabitat, cell: usize, f: &Forcing) -> io::Result<Environment> {
    map.with_water(|water| environment_with_water(map, water, cell, f))
}
fn environment_with_water(
    map: &impl ReadHabitat,
    water_view: &crate::water::WaterView,
    cell: usize,
    f: &Forcing,
) -> io::Result<Environment> {
    let warmth = if map.on_river(cell)? {
        water_view.warmth.get(cell)?
    } else {
        0.0
    };
    let temperature = (map.get(S::Temperature, cell)? + warmth) / 10.0 - 30.0;
    let depth = water_view.column.store(Store::Standing).held(cell)?;
    let water = water_view.column.kind.get(cell)?;
    let ice = map.get(S::IceThickness, cell)?;
    let frozen = ice > map.length(2.5e-7)? && !(warmth >= 50.0 && ice <= map.length(0.0000125)?);
    let moisture = plant_water(map, cell)?;
    let seasonality = map.get(S::Seasonality, cell)?;
    let range = if seasonality > 0.0 {
        seasonality * f.seasonality / 0.3
    } else {
        f.seasonality * 25.0
    };
    let drought = unit(
        1.0 - moisture * (1.0 - f.seasonality * 0.55)
            - water_view.column.store(Store::Soil).held(cell)? / map.length(2.5e-7)?,
    );
    let flat = unit(1.0 - map.get(S::Slope, cell)? / STANDING_WATER_SLOPE);
    let drainage = unit(
        MapScale::metres(
            water_view.drainage.elevations.get(cell)? - map.substrate(G::Elevation, cell)?,
            LengthUnit::Native,
        ) / map.length(7.5e-7)?,
    );
    let flood = flood_wetness(
        map.get(S::FloodplainIntensity, cell)?,
        map.get(S::DeltaIntensity, cell)?,
    );
    let wetness = if water != 0 {
        unit(1.0 - depth / map.length(7.5e-7)?)
    } else {
        flat * unit(drainage + flood + (moisture - 0.7) * 1.8)
    };
    Ok(Environment {
        temperature,
        depth,
        water,
        frozen,
        warmth: unit((temperature + 8.0) / 18.0) * unit((52.0 - temperature) / 18.0),
        moisture,
        wetness,
        submerged: water != 0 && (water == 1 || depth > map.length(3.75e-7)?),
        summer: temperature + range,
        winter: temperature - range,
        drought,
    })
}
