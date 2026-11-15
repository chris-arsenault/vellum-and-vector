//! An explicit water occurrence commits ending stocks and twelve months of supply together.
use super::{
    balance::{water_year, HeldWater, WaterGround, WaterYear, MONTHS},
    column::{Store, WaterColumn},
    ledger::{Move, WaterLedger},
};
use crate::{
    climate::{air_year, seasonal_swing, LatitudeFrame, RainBelts},
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Runoff {
    mean: Band<f64>,
    flood: Band<f64>,
    dry: Band<f64>,
}
pub struct RunoffView {
    pub mean: ReadBand<f64>,
    pub flood: ReadBand<f64>,
    pub dry: ReadBand<f64>,
}
pub struct ClimateSettings<'a> {
    pub frame: &'a LatitudeFrame,
    pub belts: &'a RainBelts,
    pub seasonality_equator: f64,
    pub seasonality_polar: f64,
    pub snow_melt_per_degree: f64,
    pub storm_runoff_share: f64,
}
pub struct ClimateBands {
    pub temperature: ReadBand<f64>,
    pub seasonality: ReadBand<f64>,
    pub rainfall: ReadBand<f64>,
    pub snowfall: ReadBand<f64>,
    pub river_warmth: ReadBand<f64>,
}
pub struct LandWaterInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub climate: &'a ClimateBands,
    pub settings: ClimateSettings<'a>,
    pub sinking: &'a dyn Fn(usize) -> io::Result<f64>,
    pub bare: &'a dyn Fn(usize) -> io::Result<f64>,
    pub wetting: &'a ReadBand<f64>,
    pub held: &'a ReadBand<f64>,
}
pub fn sinking_share(
    taken: f64,
    wetland_cover: f64,
    peat_carbon: f64,
    ecology_initialized: bool,
) -> f64 {
    let held = if ecology_initialized {
        (0.3 * wetland_cover + peat_carbon / 60.0).min(1.0)
    } else {
        0.0
    };
    1.0 - (1.0 - taken.clamp(0.0, 1.0)) * (1.0 - held)
}
pub fn bare(tree: f64, grass: f64, wetland: f64) -> f64 {
    1.0 - (tree + grass + wetland).min(1.0)
}
impl Runoff {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("runoff-mean", &mut self.mean)?;
        archive.band("runoff-flood", &mut self.flood)?;
        archive.band("runoff-dry", &mut self.dry)
    }
    pub(super) fn inherit_mean(&mut self, cell: usize, value: f64) -> io::Result<()> {
        self.mean.set(cell, value)
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            mean: coverage.allocate(0.0),
            flood: coverage.allocate(0.0),
            dry: coverage.allocate(0.0),
        }
    }
    pub fn read_only(&self) -> RunoffView {
        RunoffView {
            mean: self.mean.read_only(),
            flood: self.flood.read_only(),
            dry: self.dry.read_only(),
        }
    }
    pub fn project(&mut self, water: &WaterColumn) -> io::Result<()> {
        let view = water.read_only();
        for cell in 0..self.mean.len() {
            let (mut total, mut least, mut greatest) = (0.0, f64::INFINITY, 0.0f64);
            for band in &view.year[..MONTHS] {
                let quick = band.get(cell)?;
                total += quick;
                least = least.min(quick);
                greatest = greatest.max(quick);
            }
            self.mean.set(cell, total)?;
            self.flood.set(cell, greatest * MONTHS as f64)?;
            self.dry.set(cell, least * MONTHS as f64)?;
        }
        Ok(())
    }
}
impl LandWaterInputs<'_> {
    fn climate_year(&self, cell: usize) -> io::Result<WaterGround> {
        let latitude = self
            .settings
            .frame
            .latitude_at_y(self.mesh.position(cell)[1] + self.mesh.origin()[1]);
        let air = air_year(
            latitude,
            self.settings.belts.axial_tilt,
            self.climate.temperature.get(cell)?,
            self.climate.seasonality.get(cell)?,
            self.climate.river_warmth.get(cell)?,
        );
        let swing = seasonal_swing(
            self.settings.seasonality_equator,
            self.settings.seasonality_polar,
            latitude,
            self.climate.seasonality.get(cell)?,
        );
        let share = self.settings.belts.through_year(latitude, swing);
        let fell = self.climate.rainfall.get(cell)? + self.climate.snowfall.get(cell)?;
        Ok(WaterGround {
            rain: std::array::from_fn(|month| {
                if air.warmth[month] > 0.0 {
                    fell * share[month]
                } else {
                    0.0
                }
            }),
            snow: std::array::from_fn(|month| {
                if air.warmth[month] > 0.0 {
                    0.0
                } else {
                    fell * share[month]
                }
            }),
            demand: air.demand,
            melt: std::array::from_fn(|month| {
                self.settings.snow_melt_per_degree * air.warmth[month].max(0.0)
            }),
            soil_capacity: 0.0,
            sinking: 0.0,
            storm_share: 0.0,
        })
    }
}
const LAND_MOVES: [Move; 7] = [
    Move::Rain,
    Move::Snowfall,
    Move::Thaw,
    Move::Firn,
    Move::Evaporation,
    Move::Runoff,
    Move::Recharge,
];
fn note_year(moved: &mut [f64; 7], fell: &WaterGround, water: &WaterYear, area: f64) {
    let depths = [
        fell.rain.iter().sum(),
        fell.snow.iter().sum(),
        water.thaw.iter().sum(),
        water.kept_snow,
        water.evaporated,
        water.quick.iter().sum(),
        water.recharge,
    ];
    for (total, depth) in moved.iter_mut().zip(depths) {
        *total += MapScale::metres(depth, LengthUnit::Millimetre) * area;
    }
}
impl WaterColumn {
    pub fn advance_year(
        &mut self,
        input: LandWaterInputs<'_>,
        ledger: &mut WaterLedger,
    ) -> io::Result<()> {
        let mut moved = [0.0; 7];
        let view = self.read_only();
        for cell in 0..input.mesh.len() {
            if view.kind.get(cell)? == 1 {
                self.set_year(cell, [0.0; MONTHS + 2])?;
                self.put_soil_water(cell, 0.0)?;
                self.put_snow(cell, 0.0)?;
                continue;
            }
            let sinking = (input.sinking)(cell)?;
            let mut fell = input.climate_year(cell)?;
            fell.soil_capacity = MapScale::in_units(
                view.store(Store::Soil).capacity(cell)?,
                LengthUnit::Millimetre,
            );
            fell.sinking = sinking;
            fell.storm_share =
                input.settings.storm_runoff_share * (1.0 - sinking) * (input.bare)(cell)?;
            let water = water_year(
                &fell,
                HeldWater {
                    soil: Some(MapScale::in_units(
                        view.store(Store::Soil).held(cell)?,
                        LengthUnit::Millimetre,
                    )),
                    snow: Some(MapScale::in_units(
                        view.store(Store::Snow).held(cell)?,
                        LengthUnit::Millimetre,
                    )),
                },
            );
            let mut year = [0.0; MONTHS + 2];
            year[..MONTHS].copy_from_slice(&water.quick);
            year[MONTHS] = water.recharge;
            year[MONTHS + 1] = water.kept_snow;
            self.set_year(cell, year)?;
            self.put_snow(
                cell,
                MapScale::metres(water.end_snow, LengthUnit::Millimetre),
            )?;
            self.hold_soil(
                cell,
                water.end_soil,
                input.wetting.get(cell)?,
                input.held.get(cell)?,
            )?;
            note_year(&mut moved, &fell, &water, input.mesh.area(cell));
        }
        for (cause, amount) in LAND_MOVES.into_iter().zip(moved) {
            ledger.state(cause, amount);
        }
        Ok(())
    }
}
