use super::{
    placement::{cover_column, rock_column},
    Ground, GroundField as F, MaterialReceiver,
};
use crate::{
    rock::{columns::Column, material::MaterialLayer},
    scale::{LengthUnit, MapScale},
    settlement::{removal::*, stage::*},
};
use std::io;
const ROCK_LOAD_RESPONSE: f64 = 0.8;
fn crust_per_rock(fraction: f64) -> f64 {
    (1.0 - ROCK_LOAD_RESPONSE) / ((300.0 + 400.0 * fraction.clamp(0.0, 1.0)) / 1000.0)
}
impl Ground {
    pub fn shift(&mut self, cell: usize, change: f64, cause: &str) -> io::Result<()> {
        self.add(F::BedrockElevation, cell, change)?;
        self.add(F::SurfaceRockLoad, cell, change)?;
        self.record_flow(
            cause,
            Pool::Rock,
            Pool::Rock,
            self.volume(cell, change.abs()),
        );
        self.project(cell)
    }
    pub fn raise(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<f64> {
        let per_rock = crust_per_rock(self.get(F::CrustContinentalFraction, cell)? / 1000.0);
        let amount = amount.min(self.get(F::CrustThickness, cell)?.max(0.0) / per_rock);
        if amount <= 0.0 {
            return Ok(0.0);
        }
        self.adjust_crust(cell, self.get(F::CrustThickness, cell)? - amount * per_rock)?;
        self.add(F::SurfaceRockLoad, cell, amount)?;
        self.displace(cell, amount, cause)?;
        Ok(amount)
    }
    pub fn construct_material(
        &mut self,
        cell: usize,
        material: &MaterialLayer,
        cause: &str,
        from: Pool,
        only: Option<Facet>,
    ) -> io::Result<f64> {
        let mut built = 0.0;
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            let depth = material.depth.max(0.0);
            if share <= 0.0 || depth <= 0.0 || only.is_some_and(|only| only != facet) {
                continue;
            }
            self.bury_cover(cell, Some(facet))?;
            self.insert_material(
                cell,
                rock_column(facet),
                &[MaterialLayer {
                    depth,
                    ..material.clone()
                }],
            )?;
            self.add(F::BedrockElevation, cell, depth * share)?;
            self.add(
                F::GroundCutDepth,
                cell,
                if facet == Facet::Land { depth } else { -depth },
            )?;
            built += depth * share;
        }
        if built <= 0.0 {
            return Ok(0.0);
        }
        self.add(F::SurfaceRockLoad, cell, built)?;
        self.record_flow(cause, from, Pool::Rock, self.volume(cell, built));
        self.project(cell)?;
        self.events.constructed(cell, material, cause, built)?;
        Ok(built)
    }
    pub fn initialize_crust(&mut self) -> io::Result<()> {
        if self.crust_initialized {
            return Ok(());
        }
        for cell in 0..self.mesh.len() {
            self.set(
                F::CrustContinentalColumn,
                cell,
                self.get(F::CrustThickness, cell)? * self.get(F::CrustContinentalFraction, cell)?
                    / 1000.0,
            )?;
        }
        self.crust_initialized = true;
        Ok(())
    }
    pub fn adjust_crust(&mut self, cell: usize, next: f64) -> io::Result<()> {
        if self.crust_initialized {
            let delta = next - self.get(F::CrustThickness, cell)?;
            let continental = delta * self.get(F::CrustContinentalFraction, cell)? / 1000.0;
            self.add(F::CrustContinentalColumn, cell, continental)?;
            self.crust_budget.continental_adjustment += self.volume(cell, continental);
            self.crust_budget.ocean_adjustment += self.volume(cell, delta - continental);
        }
        self.set(F::CrustThickness, cell, next)?;
        if self.crust_initialized {
            self.refresh_crust_fraction(cell)?;
        }
        Ok(())
    }
    pub(super) fn lower_rock(&mut self, cell: usize, amount: f64) -> io::Result<()> {
        let pile = self.get(F::SurfaceRockLoad, cell)?.max(0.0);
        let below = (amount - pile).max(0.0);
        let per_rock = crust_per_rock(self.get(F::CrustContinentalFraction, cell)? / 1000.0);
        let crust = self
            .get(F::CrustThickness, cell)?
            .max(0.0)
            .min(below * per_rock);
        self.add(F::BedrockElevation, cell, -amount)?;
        self.add(
            F::SurfaceRockLoad,
            cell,
            -(amount - below) - crust / per_rock / ROCK_LOAD_RESPONSE,
        )?;
        if crust > 0.0 {
            self.adjust_crust(cell, self.get(F::CrustThickness, cell)? - crust)?;
        }
        Ok(())
    }
    pub(super) fn remove_facet(
        &mut self,
        work: Withdrawal<'_>,
        source: GroundSource,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        self.remove_facet_to(work, source, Pool::Load, receive)
    }
    fn remove_facet_to(
        &mut self,
        work: Withdrawal<'_>,
        source: GroundSource,
        to: Pool,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        let cell = work.cell;
        let share = self.share(cell, work.facet)?;
        let covered = self.cover_depth(cell, work.facet)?;
        let exposed_soil = (MapScale::native(work.soil)
            - if source == GroundSource::Rock {
                covered
            } else {
                0.0
            })
        .max(0.0);
        let identities = &self.identities;
        let mut accept = |material: MaterialLayer| {
            let mut material = identities.released_material(material);
            material.depth *= share;
            receive(material)
        };
        let loose = if source == GroundSource::Rock {
            0.0
        } else {
            self.columns
                .withdraw(cell, cover_column(work.facet), work.amount, &mut accept)?
        };
        let rock = if source == GroundSource::Loose {
            0.0
        } else {
            self.columns.withdraw(
                cell,
                rock_column(work.facet),
                (work.amount - loose).max(0.0),
                &mut accept,
            )?
        };
        if rock > 0.0 {
            self.lower_rock(cell, rock * share)?;
            self.add(
                F::GroundCutDepth,
                cell,
                if work.facet == Facet::Cut {
                    rock
                } else {
                    -rock
                },
            )?;
        }
        let soil = MapScale::metres((loose + rock).min(exposed_soil) * share, LengthUnit::Native);
        self.set(
            F::SoilDepth,
            cell,
            (self.get(F::SoilDepth, cell)? - soil).max(0.0),
        )?;
        self.record_flow(
            work.cause,
            Pool::Loose,
            to,
            self.volume(cell, loose * share),
        );
        self.record_flow(work.cause, Pool::Rock, to, self.volume(cell, rock * share));
        Ok((loose + rock) * share)
    }
    pub fn excavate_rock(
        &mut self,
        cell: usize,
        requested: f64,
        cause: &str,
        to: Pool,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        let soil = self.get(F::SoilDepth, cell)?;
        let mut removed = 0.0;
        for facet in Facet::ALL {
            if self.share(cell, facet)? > 0.0 {
                removed += self.remove_facet_to(
                    Withdrawal {
                        cell,
                        facet,
                        pool: MaterialPool::Rock,
                        amount: requested.max(0.0),
                        cause,
                        soil,
                    },
                    GroundSource::Rock,
                    to,
                    receive,
                )?;
            }
        }
        self.project(cell)?;
        Ok(removed)
    }
    pub fn erode_facets(
        &mut self,
        cell: usize,
        depths: [f64; 2],
        cause: &str,
        to: Pool,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        let soil = self.get(F::SoilDepth, cell)?;
        let mut removed = 0.0;
        for (index, facet) in Facet::ALL.into_iter().enumerate() {
            if self.share(cell, facet)? > 0.0 && depths[index] > 0.0 {
                removed += self.remove_facet_to(
                    Withdrawal {
                        cell,
                        facet,
                        pool: MaterialPool::Rock,
                        amount: depths[index],
                        cause,
                        soil,
                    },
                    GroundSource::Surface,
                    to,
                    receive,
                )?;
            }
        }
        self.project(cell)?;
        Ok(removed)
    }
    pub fn record_sediment_export(&mut self, produced: f64, exported: f64) {
        self.produced += produced;
        self.exported += exported;
    }
    pub fn deposit_package(
        &mut self,
        cell: usize,
        package: &[MaterialLayer],
        cause: &str,
        from: Pool,
        only: Option<Facet>,
    ) -> io::Result<f64> {
        if let Some(facet) = only {
            if self.share(cell, facet)? <= 0.0 {
                return Ok(0.0);
            }
        }
        let admitted: Vec<_> = package
            .iter()
            .filter(|layer| layer.depth > 0.0)
            .map(|layer| MaterialLayer {
                bed_slope_x: 0.0,
                bed_slope_y: 0.0,
                deposited: self.epoch,
                consolidation: 0.0,
                ..layer.clone()
            })
            .collect();
        let deposited: f64 = admitted.iter().map(|layer| layer.depth).sum();
        if deposited <= 0.0 {
            return Ok(0.0);
        }
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share <= 0.0 || only.is_some_and(|only| only != facet) {
                continue;
            }
            let local: Vec<_> = admitted
                .iter()
                .map(|layer| MaterialLayer {
                    depth: layer.depth / if only.is_some() { share } else { 1.0 },
                    ..layer.clone()
                })
                .collect();
            self.insert_material(cell, cover_column(facet), &local)?;
        }
        self.record_flow(cause, from, Pool::Loose, self.volume(cell, deposited));
        self.add(F::CumulativeDeposition, cell, deposited)?;
        self.deposited += self.volume(cell, deposited);
        self.project(cell)?;
        Ok(deposited)
    }
    pub(super) fn insert_material(
        &mut self,
        cell: usize,
        column: Column,
        layers: &[MaterialLayer],
    ) -> io::Result<()> {
        let events = &mut self.events;
        self.columns
            .insert(cell, column, layers, self.epoch, &mut |fold| {
                events.folded(cell, column, &fold)
            })
    }
    pub fn weather_facets(
        &mut self,
        cell: usize,
        depths: [f64; 2],
        cause: &str,
    ) -> io::Result<f64> {
        let mut converted = 0.0;
        for (index, facet) in Facet::ALL.into_iter().enumerate() {
            let share = self.share(cell, facet)?;
            if share <= 0.0 || depths[index] <= 0.0 {
                continue;
            }
            let cover = cover_column(facet);
            let mut layers = Vec::new();
            let identities = &self.identities;
            self.columns
                .withdraw(cell, cover, self.cover_depth(cell, facet)?, &mut |layer| {
                    layers.push(identities.released_material(layer));
                    Ok(())
                })?;
            let actual =
                self.columns
                    .withdraw(cell, rock_column(facet), depths[index], &mut |layer| {
                        layers.push(identities.released_material(layer));
                        Ok(())
                    })?;
            self.insert_material(cell, cover, &layers)?;
            converted += actual * share;
            self.add(
                F::GroundCutDepth,
                cell,
                if facet == Facet::Cut { actual } else { -actual },
            )?;
        }
        self.add(F::BedrockElevation, cell, -converted)?;
        self.add(
            F::SurfaceRockLoad,
            cell,
            -converted.min(self.get(F::SurfaceRockLoad, cell)?.max(0.0)),
        )?;
        self.record_flow(cause, Pool::Rock, Pool::Loose, self.volume(cell, converted));
        self.project(cell)?;
        Ok(converted)
    }
    pub fn displace(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()> {
        self.add(F::BedrockElevation, cell, amount)?;
        self.record_flow(
            cause,
            Pool::Crust,
            Pool::Crust,
            self.volume(cell, amount.abs()),
        );
        self.project(cell)
    }
}
impl RemovalGround for Ground {
    fn count(&self) -> usize {
        self.mesh.len()
    }
    fn scale(&self) -> &MapScale {
        &self.scale
    }
    fn sea_level(&self) -> f64 {
        self.sea_level
    }
    fn marine(&self, cell: usize) -> io::Result<bool> {
        Ok(self.inputs.marine.get(cell)? != 0)
    }
    fn facet(&self, cell: usize, facet: Facet) -> io::Result<FacetState> {
        Ok(FacetState {
            share: self.share(cell, facet)?,
            cover: self.cover_depth(cell, facet)?,
            surface: self.surface(cell, facet)?,
        })
    }
    fn sediment(&self, cell: usize) -> io::Result<f64> {
        self.get(F::SedimentThickness, cell)
    }
    fn soil(&self, cell: usize) -> io::Result<f64> {
        self.get(F::SoilDepth, cell)
    }
    fn withdraw(
        &mut self,
        action: Withdrawal<'_>,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        let source = if action.pool == MaterialPool::Loose {
            GroundSource::Loose
        } else {
            GroundSource::Rock
        };
        let cell = action.cell;
        let actual = self.remove_facet(action, source, receive)?;
        self.project(cell)?;
        Ok(actual)
    }
    fn cut(
        &mut self,
        action: Cut<'_>,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<CutReceipt> {
        self.cut_ground(action, receive)
    }
}
impl StageGround for Ground {
    fn surface_action(&self, action: SurfaceAction<'_>) -> io::Result<[f64; 2]> {
        self.surface_depths(action)
    }
    fn deposit(&mut self, action: Deposit<'_>) -> io::Result<f64> {
        self.deposit_package(
            action.cell,
            &[MaterialLayer {
                depth: action.amount,
                ..action.material.clone()
            }],
            action.cause,
            Pool::Load,
            None,
        )
    }
    fn weather(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()> {
        self.weather_facets(cell, [amount; 2], cause).map(|_| ())
    }
    fn weather_by(
        &mut self,
        cell: usize,
        forcing: &Forcing,
        power: f64,
        cause: &str,
    ) -> io::Result<()> {
        let mut depths = [0.0; 2];
        for (index, facet) in Facet::ALL.into_iter().enumerate() {
            let mantle = MapScale::metres(self.cover_depth(cell, facet)?, LengthUnit::Native);
            let action = SurfaceAction {
                cell,
                mix: &forcing.mix,
                power: power * (-mantle / forcing.shield_depth).exp(),
                limit: f64::INFINITY,
                direction: [0.0; 2],
            };
            depths[index] = self.rock_action(action, facet)?;
        }
        self.weather_facets(cell, depths, cause).map(|_| ())
    }
    fn raise_from_crust(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()> {
        self.raise(cell, amount, cause).map(|_| ())
    }
    fn remember(&mut self, name: &str, cell: usize, amount: f64) -> io::Result<()> {
        let (_, band) = self
            .history
            .iter_mut()
            .find(|(held, _)| held == name)
            .ok_or_else(|| io::Error::other(format!("Unbound ground history {name}")))?;
        band.set(cell, band.get(cell)? + amount)
    }
    fn produced(&mut self, volume: f64) {
        self.produced += volume;
    }
}
