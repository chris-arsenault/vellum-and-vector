//! Bind physical settings to explicit ancestry, never to a requesting loop's ordinal.
use crate::{
    bindings::physical_seeds,
    processes::runner::PhysicalContext,
    scale::{MapScale, RelativeMeasure},
    scale_settings::ResolvedSettings,
    sequence::{InvocationContext, SequenceError},
    tectonics::controls::DEFAULT_MYR,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(default, rename_all = "camelCase")]
pub struct EcologyEpoch {
    pub rainfall: f64,
    pub seasonality: f64,
    pub productivity: f64,
    pub fire: f64,
    pub migration: f64,
    pub recovery: f64,
}
impl Default for EcologyEpoch {
    fn default() -> Self {
        Self {
            rainfall: 1.0,
            seasonality: 0.3,
            productivity: 1.0,
            fire: 1.0,
            migration: 1.0,
            recovery: 1.0,
        }
    }
}
impl EcologyEpoch {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.seasonality.is_finite()
            || !(0.0..=1.0).contains(&self.seasonality)
            || [
                self.rainfall,
                self.productivity,
                self.fire,
                self.migration,
                self.recovery,
            ]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=5.0).contains(v))
        {
            return Err("Invalid ecological epoch forcing");
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields = nullable)]
pub struct Epoch {
    pub id: String,
    pub tectonics: f64,
    pub hydrology: f64,
    pub ice: f64,
    pub coasts: f64,
    pub temperature: f64,
    pub sea_level: f64,
    pub tectonic_duration_myr: Option<f64>,
    pub plate_travel: Option<f64>,
    pub ecology: Option<EcologyEpoch>,
    pub duration: Option<f64>,
    pub impacts: Option<f64>,
    pub volcanism: Option<f64>,
    // hpc-exempt: named system configuration, not cell-indexed generation storage.
    pub magic_activity: Option<BTreeMap<String, f64>>,
    pub length_units: Option<RelativeUnits>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum RelativeUnits {
    Relative,
}

pub struct BoundPhysicalContext {
    pub context: PhysicalContext,
    pub profile: ResolvedSettings,
    pub epoch: Option<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HumanEra {
    pub id: String,
    pub years: f64,
    pub physical_epoch: Option<String>,
    pub mobility: f64,
    pub political_capacity: f64,
}
impl HumanEra {
    pub fn bound_epoch<'a>(&self, epochs: &'a [Epoch]) -> Option<&'a Epoch> {
        let bound = self.physical_epoch.as_deref()?;
        if bound == "before-present" {
            return epochs.len().checked_sub(2).map(|index| &epochs[index]);
        }
        epochs.iter().find(|epoch| epoch.id == bound)
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty()
            || !self.years.is_finite()
            || self.years <= 0.0
            || !self.mobility.is_finite()
            || self.mobility < 0.0
            || !self.political_capacity.is_finite()
            || self.political_capacity < 0.0
        {
            return Err("Invalid human era settings");
        }
        Ok(())
    }
}
pub struct ContextSource<'a> {
    pub epochs: &'a [Epoch],
    pub scale: MapScale,
    pub initialized: bool,
}
#[derive(Debug)]
pub enum ContextError {
    Sequence(SequenceError),
    Settings(&'static str),
}
impl<'a> ContextSource<'a> {
    pub fn bind<V>(
        &self,
        seed: i32,
        salt: i32,
        base: &ResolvedSettings,
        invocation: &InvocationContext<'_, V>,
    ) -> Result<BoundPhysicalContext, ContextError> {
        let ids: Vec<_> = self.epochs.iter().map(|epoch| epoch.id.clone()).collect();
        let index = invocation
            .physical_epoch_index(&ids)
            .map_err(ContextError::Sequence)?;
        let native_index = match index {
            Some(index) => i32::try_from(index).map_err(|_| {
                ContextError::Settings("Epoch index exceeds numeric representation")
            })?,
            None => {
                if self.initialized {
                    -1
                } else {
                    0
                }
            }
        };
        let definition = index.map(|index| &self.epochs[index]);
        let profile = base
            .epoch_profile(
                definition.and_then(|epoch| epoch.impacts).unwrap_or(1.0),
                definition.and_then(|epoch| epoch.volcanism).unwrap_or(1.0),
            )
            .map_err(ContextError::Settings)?;
        let seeds = physical_seeds(seed, salt, native_index);
        let setting = |name: &str| {
            profile
                .values()
                .get(name)
                .and_then(serde_json::Value::as_f64)
                .ok_or(ContextError::Settings(
                    "Epoch profile lacks a native process setting",
                ))
        };
        let mut context = PhysicalContext {
            impact_count: Some(setting("ImpactCraterCount")?),
            volcanic_height: Some(setting("VolcanicConeHeight")?),
            seed: seeds.seed,
            epoch_stable_seed: seeds.epoch_stable_seed,
            epoch_index: native_index,
            epoch_count: self.epochs.len(),
            ..PhysicalContext::default()
        };
        if let Some(epoch) = definition {
            apply_epoch(&mut context, epoch, self.scale).map_err(ContextError::Settings)?;
        }
        if let Some(ecology) = definition
            .or_else(|| self.epochs.last())
            .and_then(|epoch| epoch.ecology.as_ref())
        {
            ecology.validate().map_err(ContextError::Settings)?;
            context.rainfall_multiplier = ecology.rainfall;
        }
        Ok(BoundPhysicalContext {
            context,
            profile,
            epoch: index,
        })
    }
}
fn apply_epoch(
    context: &mut PhysicalContext,
    epoch: &Epoch,
    scale: MapScale,
) -> Result<(), &'static str> {
    let strength = |value: f64| (value.clamp(0.0, 1.0) * 1000.0).round();
    context.tectonic_strength = strength(epoch.tectonics);
    context.hydrology_strength = strength(epoch.hydrology);
    context.glaciation_strength = strength(epoch.ice);
    context.coastal_strength = strength(epoch.coasts);
    context.temperature_offset = ((epoch.temperature - 15.0) * 10.0).round();
    context.sea_level_offset = scale
        .resolve(RelativeMeasure::length(epoch.sea_level)?)?
        .value();
    context.tectonic_duration_myr = epoch.tectonic_duration_myr.unwrap_or(DEFAULT_MYR);
    context.span = context.tectonic_duration_myr / DEFAULT_MYR;
    context.plate_travel_share = epoch.plate_travel.unwrap_or(1.0);
    Ok(())
}
