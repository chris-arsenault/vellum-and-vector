//! Natural surface codes retain the existing map palette order.
use super::sources::Environment;
use crate::{
    field::shared::{CellCode as I, Scalar as F},
    scale::{MapScale, RelativeMeasure},
    storage::{Band, Coverage},
    water::{column::Store, network::RiverReader},
};
use std::io;
#[derive(Clone, Copy)]
#[repr(i32)]
pub enum Surface {
    Tundra,
    OpenField,
    Ridge,
    Glacier,
    Moraine,
    Lake,
    Fjord,
    ExposedShelf,
    Shelf,
    Ocean,
    Reef,
    PackIce,
    SeaIce,
    IceShelf,
    Polynya,
    Snowfield,
    PolarBarrens,
    WetTundra,
    ColdSteppe,
    ScreeField,
    RiverValley,
    RiverChannel,
    Floodplain,
    Delta,
    Gorge,
    Waterfall,
    CurrentChannel,
    Trench,
    Grassland,
    Savanna,
    Woodland,
    TemperateForest,
    BorealForest,
    Rainforest,
    Marsh,
    Swamp,
    Desert,
    Barren,
    EmberGrove,
    ThawMeadow,
    RimeForest,
    GlowLichenBarrens,
    FogHeath,
    MossForest,
    UpwellingWater,
    WarmWaterReach,
}
pub const NAMES: &[&str] = &[
    "Tundra",
    "Open field",
    "Ridge",
    "Glacier",
    "Moraine",
    "Lake",
    "Fjord",
    "Exposed shelf",
    "Shelf",
    "Ocean",
    "Reef",
    "Pack ice",
    "Sea ice",
    "Ice shelf",
    "Polynya",
    "Snowfield",
    "Polar barrens",
    "Wet tundra",
    "Cold steppe",
    "Scree field",
    "River valley",
    "River channel",
    "Floodplain",
    "Delta",
    "Gorge",
    "Waterfall",
    "Current channel",
    "Trench",
    "Grassland",
    "Savanna",
    "Woodland",
    "Temperate forest",
    "Boreal forest",
    "Rainforest",
    "Marsh",
    "Swamp",
    "Desert",
    "Barren",
    "Ember grove",
    "Thaw meadow",
    "Rime forest",
    "Glow-lichen barrens",
    "Fog heath",
    "Moss forest",
    "Upwelling water",
    "Warm-water reach",
];
const BIOME_SURFACES: &[Option<Surface>] = &[
    None,
    Some(Surface::Ocean),
    None,
    None,
    Some(Surface::Barren),
    Some(Surface::Desert),
    Some(Surface::Tundra),
    Some(Surface::Grassland),
    Some(Surface::Savanna),
    Some(Surface::Woodland),
    Some(Surface::TemperateForest),
    Some(Surface::BorealForest),
    Some(Surface::Rainforest),
    Some(Surface::Marsh),
    Some(Surface::Swamp),
    Some(Surface::EmberGrove),
    Some(Surface::ThawMeadow),
    Some(Surface::RimeForest),
    Some(Surface::GlowLichenBarrens),
    Some(Surface::FogHeath),
    Some(Surface::MossForest),
    None,
    None,
    None,
    None,
    None,
    None,
];
pub struct Surfaces {
    pub natural: Band<i32>,
    pub final_surface: Band<i32>,
    pub second: Band<i32>,
}
impl Surfaces {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            natural: coverage.allocate(0),
            final_surface: coverage.allocate(0),
            second: coverage.allocate(-1),
        }
    }
    pub fn classify(
        &mut self,
        env: &Environment<'_>,
        rivers: &RiverReader<'_>,
        ecology_initialized: bool,
    ) -> io::Result<()> {
        for cell in 0..env.mesh.len() {
            let surface = if env.water.column.kind.get(cell)? == 1 {
                ocean(env, cell)?
            } else {
                land(env, rivers, cell, ecology_initialized)?
            };
            self.natural.set(cell, surface as i32)?;
            self.final_surface.set(cell, surface as i32)?;
        }
        Ok(())
    }
}
fn length(env: &Environment<'_>, fraction: f64) -> io::Result<f64> {
    Ok(env
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn frozen_neighbor(env: &Environment<'_>, cell: usize) -> io::Result<bool> {
    let cover = length(env, 0.0000125)?;
    for edge in 0..3 {
        if let Some(next) = env.mesh.neighbor(cell, edge) {
            if env.water.column.kind.get(next)? == 1 && env.scalar(F::IceThickness, next)? >= cover
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn special_ocean(env: &Environment<'_>, cell: usize, shallow: bool) -> io::Result<Option<Surface>> {
    if env.scalar(F::DeltaIntensity, cell)? > 0.0 {
        return Ok(Some(Surface::Delta));
    }
    if env.fields.code(I::LandformCodes).get(cell)? == 11 {
        return Ok(Some(Surface::Fjord));
    }
    if shallow
        && env
            .water
            .column
            .store(Store::Standing)
            .contents()
            .get(cell)?
            <= MapScale::native(length(env, 0.00004)?)
        && (env.scalar(F::Temperature, cell)? >= 260.0
            || env.scalar(F::OceanCurrentHeat, cell)? >= 420.0)
        && env.scalar(F::Geothermal, cell)? >= 60.0
    {
        return Ok(Some(Surface::Reef));
    }
    Ok(None)
}
pub fn marine_ice_surface(
    thickness: f64,
    shallow: bool,
    flags: i32,
    scale: &crate::scale::MapScale,
) -> io::Result<Option<Surface>> {
    let length = |fraction| {
        Ok::<_, io::Error>(
            scale
                .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
                .value(),
        )
    };
    if thickness < length(0.0000125)? {
        return Ok(None);
    }
    if shallow && thickness >= length(0.00001875)? {
        return Ok(Some(Surface::IceShelf));
    }
    Ok(Some(if flags & (1 << 1) != 0 {
        Surface::PackIce
    } else {
        Surface::SeaIce
    }))
}
fn ocean(env: &Environment<'_>, cell: usize) -> io::Result<Surface> {
    let zone = env.fields.code(I::BathymetricZoneCodes).get(cell)?;
    let shallow = matches!(zone, 2 | 3);
    if let Some(surface) = special_ocean(env, cell, shallow)? {
        return Ok(surface);
    }
    if let Some(surface) = marine_ice_surface(
        env.scalar(F::IceThickness, cell)?,
        shallow,
        env.fields.code(I::FeatureFlags).get(cell)?,
        env.scale,
    )? {
        return Ok(surface);
    }
    if frozen_neighbor(env, cell)? {
        return Ok(Surface::Polynya);
    }
    if zone == 4
        && matches!(env.fields.code(I::TectonicBoundaryCodes).get(cell)?, 1 | 2)
        && env.scalar(F::TectonicStrain, cell)? >= 430.0
    {
        return Ok(Surface::Trench);
    }
    if env.scalar(F::Upwelling, cell)? >= 450.0 {
        return Ok(Surface::UpwellingWater);
    }
    if env.scalar(F::OceanCurrentStrength, cell)? >= 780.0 {
        return Ok(Surface::CurrentChannel);
    }
    Ok(if shallow {
        Surface::Shelf
    } else {
        Surface::Ocean
    })
}
fn climate(env: &Environment<'_>, cell: usize) -> io::Result<Surface> {
    let biome = env.fields.code(I::BiomeCodes).get(cell)?;
    if let Some(Some(surface)) = usize::try_from(biome)
        .ok()
        .and_then(|i| BIOME_SURFACES.get(i))
    {
        return Ok(*surface);
    }
    let temperature = env.scalar(F::Temperature, cell)?;
    let moisture = env.scalar(F::Moisture, cell)?;
    if temperature >= 335.0 && moisture >= 260.0 {
        return Ok(Surface::OpenField);
    }
    if moisture >= 620.0 {
        return Ok(Surface::WetTundra);
    }
    if temperature <= 255.0 && moisture <= 210.0 {
        return Ok(Surface::PolarBarrens);
    }
    if temperature >= 235.0
        && (150.0..=520.0).contains(&moisture)
        && env.scalar(F::Slope, cell)? <= 0.0042
    {
        return Ok(Surface::ColdSteppe);
    }
    Ok(Surface::Tundra)
}
fn relief(
    env: &Environment<'_>,
    cell: usize,
    river: bool,
    ecology_initialized: bool,
) -> io::Result<Surface> {
    let bare = env.scalar(F::TreeCover, cell)?
        + env.scalar(F::GrassCover, cell)?
        + env.scalar(F::WetlandCover, cell)?
        < 0.12;
    if bare
        && env.fields.code(I::BathymetricZoneCodes).get(cell)? == 1
        && env.scalar(F::WaveExposureHistory, cell)? > 0.0
    {
        return Ok(Surface::ExposedShelf);
    }
    if bare && env.scalar(F::Slope, cell)? >= 0.0235 {
        return Ok(Surface::ScreeField);
    }
    if bare && matches!(env.fields.code(I::LandformCodes).get(cell)?, 5 | 6 | 15) {
        return Ok(Surface::Ridge);
    }
    if !ecology_initialized && river {
        return Ok(Surface::RiverValley);
    }
    climate(env, cell)
}
fn fluvial(env: &Environment<'_>, cell: usize, order: u16) -> io::Result<Option<Surface>> {
    if env.scalar(F::DeltaIntensity, cell)? > 0.0 {
        return Ok(Some(Surface::Delta));
    }
    match env.fields.code(I::LandformCodes).get(cell)? {
        17 => return Ok(Some(Surface::Waterfall)),
        16 => return Ok(Some(Surface::Gorge)),
        _ => {}
    }
    if order >= 1 && env.water.warmth.get(cell)? >= 50.0 {
        return Ok(Some(Surface::WarmWaterReach));
    }
    if env.water.channels.strength.get(cell)? > 0.0 && order >= 4 {
        return Ok(Some(Surface::RiverChannel));
    }
    if env.scalar(F::FloodplainIntensity, cell)? >= 250.0 {
        return Ok(Some(Surface::Floodplain));
    }
    Ok(None)
}
fn land(
    env: &Environment<'_>,
    rivers: &RiverReader<'_>,
    cell: usize,
    ecology_initialized: bool,
) -> io::Result<Surface> {
    let kind = env.water.column.kind.get(cell)?;
    let order = rivers.order_at(cell, kind);
    if let Some(surface) = fluvial(env, cell, order)? {
        return Ok(surface);
    }
    if kind == 2 {
        return Ok(Surface::Lake);
    }
    if env.fields.code(I::LandformCodes).get(cell)? == 12 {
        return Ok(Surface::Moraine);
    }
    let ice = env.scalar(F::IceThickness, cell)?;
    if ice >= length(env, 0.000075)? {
        return Ok(Surface::Glacier);
    }
    if ice >= length(env, 0.0000625)? {
        return Ok(Surface::Snowfield);
    }
    relief(env, cell, order > 0, ecology_initialized)
}
