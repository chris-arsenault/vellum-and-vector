use super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, QueryDependency},
    lattice::Membership,
    noise::mesh_noise,
    processes::runner::PhysicalContext,
    scale::RelativeMeasure,
    scale_settings::{ResolvedSettings, ScaleDefinition},
};
use serde::Deserialize;
use std::io;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "SeaIceFormationTemperature":270,"SeaIceCurrentResistance":220,"SeaIceWaveResistance":180,
        "SeaIceSuitabilityVariation":150,
        "SeaIceVariationScale":{"kind":"relative-measure","fraction":0.065,"dimension":1,"exponent":1},
        "PermanentSeaIceTemperature":205,"IceMarginTemperature":300
    }})).expect("Declared sea ice settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    sea_ice_formation_temperature: f64,
    sea_ice_current_resistance: f64,
    sea_ice_wave_resistance: f64,
    sea_ice_suitability_variation: f64,
    sea_ice_variation_scale: f64,
    permanent_sea_ice_temperature: f64,
    ice_margin_temperature: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
pub fn work(epoch: i32, evolved: i32, local: Option<bool>, span: f64) -> f64 {
    match local {
        Some(true) => span.max(0.0),
        Some(false) => 0.0,
        None => {
            if epoch >= 0 && epoch != evolved {
                1.0
            } else {
                0.0
            }
        }
    }
}
pub fn local_response(previous: f64, response: f64, exposure: f64) -> f64 {
    previous + (response - previous) * -(-exposure.max(0.0)).exp_m1()
}
pub fn retained(thickness: f64, persistence: f64, warmth: f64, ablation_depth: f64) -> f64 {
    let held = persistence.clamp(0.0, 1.0);
    (thickness.max(0.0) * held - warmth.max(0.0) * ablation_depth.max(0.0) / (1.0 + held)).max(0.0)
}
fn length(field: &Field, share: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(share).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
impl Field {
    pub fn sea_ice(
        settings: Settings,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "sea-ice",
            CommandKind::Work,
            dependencies,
            move |scope, context| {
                scope
                    .state_mut()
                    .evolve_sea_ice(&settings, context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn evolve_sea_ice(&mut self, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
        let exposure = work(
            c.epoch_index,
            self.sea_ice_evolved_epoch,
            c.local_development,
            c.span,
        );
        let water = self.water().column.kind;
        for cell in 0..self.mesh.len() {
            self.shared
                .scalar_mut(S::SeaIceSuitability)
                .set(cell, 0.0)?;
            let flag = self.shared.code(C::FeatureFlags).get(cell)? & !6;
            self.shared.code_mut(C::FeatureFlags).set(cell, flag)?;
            if water.get(cell)? != 1 || self.mesh.membership(cell) != Membership::Content {
                continue;
            }
            let [x, y] = self.mesh.position(cell);
            let coherence = (mesh_noise(&self.mesh, x, y, c.seed, p.sea_ice_variation_scale, 3)
                * p.sea_ice_suitability_variation)
                .round();
            let value = (1000.0
                - self.shared.scalar(S::Temperature).get(cell)?
                - (self.shared.scalar(S::OceanCurrentStrength).get(cell)?
                    * p.sea_ice_current_resistance
                    / 1000.0)
                    .trunc()
                - (self.shared.scalar(S::WaveExposure).get(cell)? * p.sea_ice_wave_resistance
                    / 1000.0)
                    .trunc()
                - (self.shared.scalar(S::OceanCurrentHeat).get(cell)? / 5.0).trunc()
                + coherence)
                .clamp(0.0, 1000.0);
            self.shared
                .scalar_mut(S::SeaIceSuitability)
                .set(cell, value)?;
        }
        for cell in 0..self.mesh.len() {
            if water.get(cell)? == 1 && self.mesh.membership(cell) == Membership::Content {
                self.freeze_cell(p, c, cell, exposure)?;
            }
        }
        if c.local_development.is_none() && exposure > 0.0 {
            self.sea_ice_evolved_epoch = c.epoch_index;
        }
        Ok(())
    }
    fn freeze_cell(
        &mut self,
        p: &Settings,
        c: &PhysicalContext,
        cell: usize,
        exposure: f64,
    ) -> io::Result<()> {
        let cold = self.shared.scalar(S::SeaIceSuitability).get(cell)?;
        let temperature = self.shared.scalar(S::Temperature).get(cell)?;
        let cutoff = 1000.0 - p.sea_ice_formation_temperature;
        let formed = if cold >= cutoff && temperature <= p.ice_margin_temperature {
            length(self, 0.0000125 + (cold - cutoff) * 0.0000005)?
        } else {
            0.0
        };
        let before = self.shared.scalar(S::IceThickness).get(cell)?;
        if exposure > 0.0 {
            let held = retained(
                before,
                self.shared.scalar(S::IcePersistence).get(cell)?,
                temperature - p.ice_margin_temperature,
                length(self, 5e-7)?,
            );
            let response = formed.max(held);
            let next = if c.local_development == Some(true) {
                local_response(before, response, exposure)
            } else {
                response
            };
            self.set_ice_response(cell, next, "glaciers")?;
        }
        if self.shared.scalar(S::IceThickness).get(cell)? < length(self, 0.0000125)? {
            return Ok(());
        }
        let flag = self.shared.code(C::FeatureFlags).get(cell)?
            | if temperature <= p.permanent_sea_ice_temperature {
                2
            } else {
                4
            };
        self.shared.code_mut(C::FeatureFlags).set(cell, flag)
    }
}
