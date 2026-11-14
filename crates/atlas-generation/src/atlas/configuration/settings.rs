//! Creator history settings; completed maps keep their captured copy.
use super::error;
use crate::{
    atlas::context::{EcologyEpoch, Epoch, HumanEra, RelativeUnits},
    magic::{
        configuration::{validate_systems, System},
        confluences::configuration::Confluence,
    },
    tectonics::controls::DEFAULT_MYR,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub epochs: Vec<Epoch>,
    pub human_eras: Vec<HumanEra>,
    pub magic_systems: Vec<System>,
    pub confluences: Vec<Confluence>,
}
impl Settings {
    pub fn normalize(&mut self) -> io::Result<()> {
        if self.epochs.is_empty() {
            return Err(error(
                "generation_settings",
                "Supply at least one physical epoch",
            ));
        }
        for epoch in &mut self.epochs {
            epoch.id = epoch.id.trim().into();
            epoch.duration.get_or_insert(1000.0);
            epoch.tectonic_duration_myr.get_or_insert(DEFAULT_MYR);
            epoch.plate_travel.get_or_insert(1.0);
            epoch.impacts.get_or_insert(1.0);
            epoch.volcanism.get_or_insert(1.0);
            epoch.ecology.get_or_insert_with(EcologyEpoch::default);
            epoch.magic_activity.get_or_insert_with(Default::default);
            epoch.length_units.get_or_insert(RelativeUnits::Relative);
            validate_epoch(epoch)?;
        }
        for era in &mut self.human_eras {
            era.id = era.id.trim().into();
            era.validate().map_err(io::Error::other)?;
        }
        unique(self.epochs.iter().map(|epoch| epoch.id.as_str()))?;
        unique(self.human_eras.iter().map(|era| era.id.as_str()))?;
        validate_systems(&self.magic_systems).map_err(io::Error::other)?;
        super::magic::validate_confluences(&self.confluences, &self.magic_systems)
    }
}
fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> io::Result<()> {
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(error("generation_settings", "Use unique history names"));
        }
    }
    Ok(())
}
fn validate_epoch(epoch: &Epoch) -> io::Result<()> {
    let strengths = [epoch.tectonics, epoch.hydrology, epoch.ice, epoch.coasts];
    if epoch.id.is_empty()
        || strengths
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        || !epoch.temperature.is_finite()
        || !epoch.sea_level.is_finite()
        || epoch.duration.is_none_or(|v| !v.is_finite() || v <= 0.0)
        || [
            epoch.tectonic_duration_myr,
            epoch.plate_travel,
            epoch.impacts,
            epoch.volcanism,
        ]
        .into_iter()
        .flatten()
        .any(|v| !v.is_finite() || v < 0.0)
        || epoch
            .magic_activity
            .iter()
            .flat_map(|v| v.values())
            .any(|v| !v.is_finite() || *v < 0.0)
    {
        return Err(error(
            "generation_settings",
            format!("Invalid physical epoch {}", epoch.id),
        ));
    }
    if let Some(ecology) = &epoch.ecology {
        ecology.validate().map_err(io::Error::other)?;
    }
    Ok(())
}
