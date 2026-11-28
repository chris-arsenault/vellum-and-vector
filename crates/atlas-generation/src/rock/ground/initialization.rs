use super::{placement::rock_column, Ground, GroundField as F};
use crate::{
    chance::Chance,
    rock::{
        catalogue::{self, BASALT, GNEISS, GRANITE, LIMESTONE, SANDSTONE, SHALE},
        columns::Column,
        material::MaterialLayer,
    },
    scale::MapScale,
    settlement::removal::Facet,
    storage::ReadBand,
};
use std::io;

const PLATFORMS: [[usize; 5]; 4] = [
    [LIMESTONE, SHALE, SANDSTONE, SHALE, LIMESTONE],
    [SANDSTONE, SHALE, LIMESTONE, SANDSTONE, SHALE],
    [SHALE, SANDSTONE, LIMESTONE, SHALE, SANDSTONE],
    [SANDSTONE, LIMESTONE, SHALE, LIMESTONE, SANDSTONE],
];
const BED_THICKNESS: [f64; 5] = [0.000075, 0.00015, 0.000225, 0.0003, 0.000375];
const BASEMENT_DEPTH: f64 = 0.0075;
const OCEAN_DEPTH: f64 = 0.002;
const PLATFORM_SWELL_LENGTH: f64 = 0.045;

fn empty_layer() -> MaterialLayer {
    MaterialLayer {
        kind: 0,
        depth: 0.0,
        secondary_kind: 0,
        secondary_share: 0.0,
        strength: 0.0,
        damage: 0.0,
        grain_x: 0.0,
        grain_y: 0.0,
        bed_slope_x: 0.0,
        bed_slope_y: 0.0,
        deposited: 0.0,
        consolidation: 0.0,
        formed_min: 0.0,
        formed_max: 0.0,
        altered: 0.0,
        mixed: 0.0,
        cargo: None,
    }
}
impl Ground {
    /// Completed deposition is carried with the captured ground, not counted as new work.
    pub fn capture_deposition(&mut self) -> io::Result<()> {
        let mut amount = 0.0;
        for cell in 0..self.mesh.len() {
            amount += self.volume(cell, self.get(F::CumulativeDeposition, cell)?);
        }
        self.produced = amount;
        self.deposited = amount;
        Ok(())
    }
    pub fn reset_rock_strength(&mut self) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            for facet in Facet::ALL {
                if self.share(cell, facet)? <= 0.0 {
                    continue;
                }
                let column = rock_column(facet);
                let mut layer = self.columns.read_layer(cell, column, 0)?;
                layer.strength = catalogue::BASELINE_ROCK;
                layer.altered = self.epoch;
                self.columns.set_layer(cell, column, 0, &layer)?;
            }
            self.project(cell)?;
        }
        Ok(())
    }
    pub fn reset_shares(&mut self, cell: usize) -> io::Result<()> {
        for name in [F::GroundCutShare, F::GroundCutDepth, F::GroundCutCover] {
            self.set(name, cell, 0.0)?;
        }
        let empty = empty_layer();
        for column in [Column::Cut, Column::CutLoose, Column::Loose] {
            for slot in 0..column.size() {
                self.columns.set_layer(cell, column, slot, &empty)?;
            }
        }
        Ok(())
    }
    pub fn reset_landscape_history(&mut self) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            for name in [F::SedimentThickness, F::CumulativeDeposition] {
                self.set(name, cell, 0.0)?;
            }
            let elevation = self.get(F::Elevation, cell)?;
            self.set(F::BedrockElevation, cell, elevation)?;
            self.set(F::CrustSupportElevation, cell, elevation)?;
        }
        self.epoch = 0.0;
        self.produced = 0.0;
        self.deposited = 0.0;
        self.exported = 0.0;
        self.support_initialized = true;
        Ok(())
    }
    fn initial_layer(
        &mut self,
        cell: usize,
        slot: usize,
        kind: usize,
        metres: f64,
    ) -> io::Result<()> {
        self.columns.set_layer(
            cell,
            Column::Land,
            slot,
            &catalogue::material(kind, MapScale::native(metres), self.epoch),
        )
    }
    fn continental_column(&mut self, cell: usize, province: i32, seed: i32) -> io::Result<()> {
        // A province is all shield or all platform, on one basement and one stack of
        // beds, each drawn once for the province; the beds swell and thin across it.
        let province = f64::from(province);
        let basement_draws = Chance::of(seed, 0x5a13);
        let shield = basement_draws.happens([province, 0.0], 0.3);
        let basement = if basement_draws.happens([province, 1.0], 0.5) {
            GNEISS
        } else {
            GRANITE
        };
        let depth = self.relative_length(BASEMENT_DEPTH)?;
        if shield {
            return self.initial_layer(cell, 0, basement, depth);
        }
        let stack = &PLATFORMS[Chance::of(seed, 0x5a11).one_of([province, 0.0], PLATFORMS.len())];
        let [x, y] = self.mesh.position(cell);
        let swell = 1.0
            + 0.6
                * Chance::of(seed, 0x5a12)
                    .noise(self.relative_length(PLATFORM_SWELL_LENGTH)?, 2)
                    .on(&self.mesh, [x, y]);
        for (slot, &kind) in stack.iter().enumerate() {
            self.initial_layer(
                cell,
                slot,
                kind,
                self.relative_length(BED_THICKNESS[slot])? * swell,
            )?;
        }
        self.initial_layer(cell, stack.len(), basement, depth)
    }
    pub fn initialize_rock(&mut self, provinces: &ReadBand<i32>, seed: i32) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            if self.get(F::CrustContinentalFraction, cell)? >= 500.0 {
                self.continental_column(cell, provinces.get(cell)?, seed)?;
            } else {
                self.initial_layer(cell, 0, BASALT, self.relative_length(OCEAN_DEPTH)?)?;
            }
            self.project(cell)?;
        }
        Ok(())
    }
    pub fn stand_surface(&mut self, cell: usize, elevation: f64) -> io::Result<()> {
        self.set(F::BedrockElevation, cell, elevation)?;
        self.project(cell)
    }
}
