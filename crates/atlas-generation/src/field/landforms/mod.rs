mod rivers;
mod settings;
use super::{
    shared::{CellCode as C, FloatField as F, Scalar as S},
    Field,
};
use crate::{
    execution::{ExecutionError, Query, QueryDependency},
    lattice::sampling::Sampler,
    prominence::{topographic_prominence, Prominence},
    rock::ground::GroundField,
    scale::{MapScale, RelativeMeasure},
    storage::{Band, ReadBand},
    water::{
        network::{RiverReader, RiverTerrain},
        WaterView,
    },
};
pub use settings::{settings, Settings};
use std::{io, rc::Rc};
pub struct Landscape<'a> {
    field: &'a Field,
    water: WaterView,
    rivers: RiverReader<'a>,
    elevation: ReadBand<f64>,
}
fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
impl Landscape<'_> {
    fn successor(&self, cell: usize) -> io::Result<Option<usize>> {
        self.rivers.successor(
            cell,
            None,
            &RiverTerrain {
                mesh: &self.field.mesh,
                water_kind: &self.water.column.kind,
                targets: &self.water.routing.targets,
            },
        )
    }
    fn higher(&self, cell: usize, radius: f64, sampler: &mut Sampler<'_>) -> io::Result<f64> {
        let [x, y] = self.field.mesh.position(cell);
        let here = self.elevation.get(cell)?;
        let (mut count, mut higher) = (0, 0);
        for direction in 0..16 {
            let angle = direction as f64 * std::f64::consts::PI / 8.0;
            let height = sampler.sample(
                [x + angle.cos() * radius, y + angle.sin() * radius],
                |cell| self.elevation.get(cell),
            )?;
            if !height.is_finite() {
                continue;
            }
            count += 1;
            if height > here {
                higher += 1;
            }
        }
        Ok(if count > 0 {
            f64::from(higher) * 3.0 / f64::from(count)
        } else {
            0.0
        })
    }
    fn dry_flank(
        &self,
        cell: usize,
        direction: usize,
        radius: f64,
        sampler: &mut Sampler<'_>,
    ) -> io::Result<bool> {
        let angle = direction as f64 * std::f64::consts::PI / 8.0;
        let [x, y] = self.field.mesh.position(cell);
        for step in 1..=3 {
            let reach = radius * f64::from(step) / 3.0;
            if sampler.sample([x + angle.cos() * reach, y + angle.sin() * reach], |cell| {
                self.elevation.get(cell)
            })? > self.water.effective_sea_level
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn flanked(&self, cell: usize, p: &Settings, sampler: &mut Sampler<'_>) -> io::Result<bool> {
        for direction in 0..8 {
            if self.dry_flank(cell, direction, p.fjord_maximum_half_width, sampler)?
                && self.dry_flank(cell, direction + 8, p.fjord_maximum_half_width, sampler)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn retained(&self, cell: usize, p: &Settings, sampler: &mut Sampler<'_>) -> io::Result<i32> {
        let glacial = self.field.shared.code(C::LandformCodes).get(cell)?;
        let kind = self.water.column.kind.get(cell)?;
        if kind == 1 {
            let scoured = matches!(glacial, 9 | 10)
                || self.read(S::CumulativeGlacialErosion, cell)?
                    >= MapScale::native(p.fjord_minimum_glacial_erosion);
            return Ok(if scoured && self.flanked(cell, p, sampler)? {
                11
            } else {
                8
            });
        }
        Ok(if matches!(glacial, 9 | 10 | 12) {
            glacial
        } else if kind == 2 {
            4
        } else {
            0
        })
    }
    fn read(&self, name: S, cell: usize) -> io::Result<f64> {
        self.field.shared.scalar(name).get(cell)
    }
    fn historical(&self, cell: usize, higher: f64, p: &Settings) -> io::Result<i32> {
        let rim = self.read(S::ImpactRimUplift, cell)?;
        let excavation = self.read(S::ImpactExcavation, cell)?;
        if rim >= MapScale::native(p.impact_landform_minimum_rim_uplift) && rim * 2.0 > excavation {
            return Ok(15);
        }
        if excavation >= MapScale::native(p.impact_landform_minimum_excavation) && higher >= 2.0 {
            return Ok(14);
        }
        Ok(
            if self.read(S::CumulativeGlacialDeposition, cell)?
                >= MapScale::native(p.outwash_minimum_glacial_deposition)
                && self.read(S::Slope, cell)? <= p.plain_slope_threshold
            {
                13
            } else {
                0
            },
        )
    }
    fn ridge(&self, cell: usize, p: &Settings) -> io::Result<bool> {
        Ok(
            self.elevation.get(cell)? >= MapScale::native(p.ridge_elevation_threshold)
                && self.read(S::Slope, cell)? >= p.ridge_slope_threshold
                && (self.field.shared.float(F::RidgeInfluence).get(cell)? >= 0.26f32
                    || self.field.shared.float(F::Uplift).get(cell)? >= 0.42f32
                    || self.read(S::TectonicActivityHistory, cell)?
                        >= p.inherited_ridge_activity_threshold),
        )
    }
    fn valley(&self, cell: usize, higher: f64, p: &Settings) -> io::Result<bool> {
        Ok(self.on_river(cell)?
            || self.read(S::CumulativeFluvialErosion, cell)?
                >= MapScale::native(p.ancestral_valley_minimum_erosion)
            || (higher >= 2.0
                && self.read(S::Slope, cell)? > p.plain_slope_threshold
                && self.water.flow.mean.get(cell)?
                    >= (p.river_accumulation_threshold / 3.0).trunc()))
    }
    pub fn incised_reach(&self, cell: usize, p: &Settings) -> io::Result<bool> {
        Ok(self.on_river(cell)?
            && self.read(S::Slope, cell)? >= p.gorge_minimum_slope
            && self.read(S::CumulativeFluvialErosion, cell)?
                >= MapScale::native(p.gorge_minimum_incision))
    }
    fn classify(&self, cell: usize, p: &Settings, sampler: &mut Sampler<'_>) -> io::Result<i32> {
        let retained = self.retained(cell, p, sampler)?;
        if retained != 0 {
            return Ok(retained);
        }
        let higher = self.higher(cell, p.landform_neighborhood_radius, sampler)?;
        let historical = self.historical(cell, higher, p)?;
        if historical != 0 {
            return Ok(historical);
        }
        Ok(if self.incised_reach(cell, p)? {
            16
        } else if self.ridge(cell, p)? {
            5
        } else if self.valley(cell, higher, p)? {
            3
        } else if self.read(S::Slope, cell)? <= p.plain_slope_threshold {
            1
        } else {
            2
        })
    }
}
impl Field {
    pub fn with_landscape<T>(
        &self,
        read: impl FnOnce(&Landscape<'_>) -> io::Result<T>,
    ) -> io::Result<T> {
        let water = self.water.borrow();
        read(&Landscape {
            field: self,
            water: water.read_only(),
            rivers: water.river_reader(),
            elevation: self.ground().view(GroundField::Elevation),
        })
    }
    pub fn topographic_prominence(&self) -> io::Result<Prominence> {
        topographic_prominence(
            &mut self.coverage.borrow_mut(),
            &self.mesh,
            &self.ground().view(GroundField::Elevation),
            self.water().effective_sea_level,
        )
    }
    /// The cell-indexed maximum rise represented by each qualifying key col; zero elsewhere.
    pub fn key_cols(&self) -> io::Result<Band<f64>> {
        let prominence = self.topographic_prominence()?;
        let mut cols = self.coverage.borrow_mut().scratch(self.mesh.len(), 0.0f64);
        let least = MapScale::native(length(self, 0.0000125)?);
        for cell in 0..self.mesh.len() {
            let rise = prominence.rise.get(cell)?;
            if rise < least {
                continue;
            }
            if let Ok(col) = usize::try_from(prominence.saddle.get(cell)?) {
                cols.set(col, cols.get(col)?.max(rise))?;
            }
        }
        Ok(cols)
    }
    pub fn landform_classification(
        p: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "landform-classification",
            dependencies,
            move |field: &Field, _| {
                let run = || -> io::Result<()> {
                    field.measure_slopes()?;
                    field.with_landscape(|landscape| {
                        let mut sampler = Sampler::new(&field.mesh);
                        for cell in 0..field.mesh.len() {
                            let code = landscape.classify(cell, &p, &mut sampler)?;
                            field.shared.derive_code(C::LandformCodes).set(cell, code)?;
                        }
                        let cols = field.key_cols()?;
                        for cell in 0..field.mesh.len() {
                            if cols.get(cell)? > 0.0
                                && matches!(
                                    field.shared.code(C::LandformCodes).get(cell)?,
                                    1 | 2 | 3 | 5
                                )
                                && landscape.water.column.kind.get(cell)? == 0
                                && !landscape.on_river(cell)?
                            {
                                field.shared.derive_code(C::LandformCodes).set(cell, 7)?;
                            }
                        }
                        Ok(())
                    })
                };
                run().map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
}
