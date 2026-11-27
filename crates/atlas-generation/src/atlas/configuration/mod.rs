//! Application configuration is shared by native and WASM, not assembled by the view.
mod bindings;
pub mod cartography;
pub mod defaults;
mod magic;
pub mod presentation;
mod profile;
pub mod settings;
use super::{
    features::{Catalogue, Context, Policy, Selected, Selection},
    parameters::AtlasParameters,
    resolution::{Profile, Quality},
};
use crate::{parameters::Values, recipe::Configuration};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use settings::Settings;
use std::{collections::BTreeMap, io};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    pub enabled: Option<bool>,
    #[serde(default)]
    pub settings: Values,
    pub configuration: Option<Values>,
}
// hpc-exempt: creator choices keyed by feature identity, never numerical field storage.
pub type Choices = BTreeMap<String, Choice>;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub area_id: atlas_map::Id,
    pub domains: Vec<String>,
    pub quality: Quality,
    pub seed: i32,
    #[serde(default)]
    pub parameters: AtlasParameters,
    #[serde(default)]
    pub features: Choices,
    pub settings: Option<Settings>,
    pub configuration: Option<Configuration>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Resolved {
    pub selection: Selection,
    pub parameters: AtlasParameters,
    pub settings: Settings,
    pub overrides: Values,
}
pub fn error(code: &str, message: impl std::fmt::Display) -> io::Error {
    io::Error::other(format!("{code}: {message}"))
}
/// The settings a map chose among those the feature's processes declare, each within the
/// bounds its process gave it. A setting the map did not choose is left out, so the
/// process's own default applies.
fn declared_settings(
    feature: &crate::atlas::features::Feature,
    chosen: &Values,
) -> io::Result<Values> {
    let mut owned = Values::new();
    for control in feature.controls {
        let Some(value) = chosen.get(control.name) else {
            continue;
        };
        let within = value.as_f64().is_some_and(|number| {
            number.is_finite()
                && control.minimum.is_none_or(|least| number >= least)
                && control.maximum.is_none_or(|most| number <= most)
        });
        if !within {
            return Err(error(
                "feature_setting",
                format!("{} is outside the bounds of {}", value, control.name),
            ));
        }
        owned.insert(control.name.into(), value.clone());
    }
    Ok(owned)
}
pub fn resolve(input: &Input, defaults: &Settings) -> io::Result<Resolved> {
    let catalogue = Catalogue::default();
    for id in input.features.keys() {
        if !catalogue.features.iter().any(|feature| feature.id == id) {
            return Err(error(
                "unknown_feature",
                format!("Unknown generation feature {id}"),
            ));
        }
    }
    let mut settings = input.settings.clone().unwrap_or_else(|| defaults.clone());
    settings.normalize()?;
    bindings::prepare(&input.features, &mut settings)?;
    let mut effective = serde_json::to_value(&input.parameters)?
        .as_object()
        .unwrap()
        .clone();
    input.parameters.validate().map_err(io::Error::other)?;
    let mut selection = Selection::new();
    for feature in &catalogue.features {
        let choice = input.features.get(feature.id).cloned().unwrap_or_default();
        let mut owned = declared_settings(feature, &choice.settings)?;
        for key in choice.settings.keys() {
            if !feature.parameters.contains(&key.as_str()) && !owned.contains_key(key) {
                return Err(error(
                    "feature_setting",
                    format!("{} does not own {key}", feature.id),
                ));
            }
        }
        for key in feature.parameters {
            let value = choice
                .settings
                .get(*key)
                .or_else(|| effective.get(*key))
                .ok_or_else(|| error("feature_setting", format!("Unknown parameter {key}")))?
                .clone();
            effective.insert((*key).into(), value.clone());
            owned.insert((*key).into(), value);
        }
        selection.insert(
            feature.id.into(),
            Selected {
                enabled: feature
                    .domains
                    .iter()
                    .any(|domain| input.domains.iter().any(|d| d == domain))
                    && choice.enabled.unwrap_or(true),
                settings: owned,
                configuration: bindings::configuration(
                    feature.id,
                    choice.configuration,
                    &settings,
                )?,
            },
        );
    }
    let parameters: AtlasParameters = serde_json::from_value(Value::Object(effective))?;
    parameters.validate().map_err(io::Error::other)?;
    bindings::bind(&selection, &mut settings)?;
    settings.normalize()?;
    let overrides = profile::overrides(&selection);
    Ok(Resolved {
        selection,
        parameters,
        settings,
        overrides,
    })
}

pub struct Frame {
    pub profile: Profile,
    pub regional: bool,
    /// A city map: a regional refinement whose rounds interleave city growth.
    pub city: bool,
    pub inherited: bool,
    pub landmarks_apply: bool,
    pub standalone_magic: bool,
}
impl Frame {
    pub fn context<'a>(&self, selection: &'a Selection) -> Context<'a> {
        Context {
            selection,
            policy: if self.regional {
                Policy::Regional
            } else {
                Policy::World
            },
            refinement: self.profile != Profile::World,
            landmarks_apply: self.landmarks_apply,
            standalone_magic: self.standalone_magic,
            initial: false,
            material: false,
            process: None,
        }
    }
}
impl Resolved {
    /// The process sequence a map's frame selects: real-scale, city, regional or world.
    fn sequence(
        &self,
        frame: &Frame,
        catalogue: &Catalogue,
        context: &Context<'_>,
    ) -> io::Result<crate::recipe::Sequence> {
        let regional = super::regional::sequence::sequence;
        Ok(
            match (frame.regional, frame.profile.real_scale(), frame.city) {
                (true, true, _) => super::regional::sequence::real_scale(
                    catalogue,
                    context,
                    super::town::sequence(catalogue, context)?,
                )?,
                (true, false, true) => super::regional::sequence::city(catalogue, context)?,
                (true, false, false) => regional(catalogue, context)?,
                (false, ..) => super::sequence::configured(
                    catalogue,
                    context,
                    &self.settings.epochs,
                    &self.settings.human_eras,
                    frame.inherited,
                )?,
            },
        )
    }
    pub fn recipe(&self, input: &Input, frame: &Frame) -> io::Result<Configuration> {
        validate_domains(input, frame.profile)?;
        if !frame.regional && self.parameters.map_boundary == 2.0 {
            return Err(error(
                "map_boundary_unavailable",
                "Ocean surrounded is not available yet. Choose Cylinder or Nothing.",
            ));
        }
        let catalogue = Catalogue::default();
        let context = frame.context(&self.selection);
        // World prerequisites are reviewable diagnostics; regional preflight reads pinned products.
        let mut diagnostics = Vec::new();
        if !frame.regional {
            for feature in &catalogue.features {
                if context.enabled(feature.id) {
                    for dependency in feature.requires {
                        diagnostics.extend(magic::require(
                            &self.selection,
                            dependency,
                            feature.id,
                            None,
                        ));
                    }
                }
            }
            diagnostics.extend(magic::requirements(
                &self.selection,
                &self.settings.magic_systems,
            ));
        }
        let profile = serde_json::to_value(frame.profile)?
            .as_str()
            .unwrap()
            .to_owned();
        let real_scale = frame.regional && frame.profile.real_scale();
        let sequence = self.sequence(frame, &catalogue, &context)?;
        Ok(Configuration {
            id: if real_scale {
                "real-scale".into()
            } else if frame.regional {
                "regional-bidirectional-refinement".into()
            } else {
                format!("atlas:{profile}")
            },
            version: if frame.regional { 3 } else { 4 },
            parameters: serde_json::to_value(&self.parameters)?
                .as_object()
                .unwrap()
                .clone(),
            sequence,
            inputs: Values::from_iter([
                ("settings".into(), serde_json::to_value(&self.settings)?),
                (
                    "features".into(),
                    serde_json::json!({"selection": self.selection, "parameters": self.parameters, "diagnostics": diagnostics}),
                ),
                ("seed".into(), input.seed.into()),
                ("quality".into(), serde_json::to_value(input.quality)?),
                ("domains".into(), serde_json::to_value(&input.domains)?),
                ("parameters".into(), serde_json::to_value(&self.parameters)?),
            ]),
        })
    }
}
fn validate_domains(input: &Input, profile: Profile) -> io::Result<()> {
    if input.domains.is_empty()
        || input.domains.iter().any(|domain| {
            !["physical", "magic", "cultural", "political", "built"].contains(&domain.as_str())
        })
    {
        return Err(error(
            "generation_domains",
            "Select at least one generation domain",
        ));
    }
    if profile != Profile::Interior && !input.domains.iter().any(|domain| domain == "physical") {
        return Err(error(
            "generation_domains",
            "Land, climate and water always generate; magic and people are the selectable domains",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_map_sets_only_the_declared_settings_it_chooses_and_only_within_their_bounds() {
        let catalogue = Catalogue::default();
        let built = catalogue
            .features
            .iter()
            .find(|feature| feature.id == "built.layout")
            .expect("the built feature");
        let chosen = |name: &str, value: f64| -> Values {
            [(name.to_owned(), serde_json::json!(value))]
                .into_iter()
                .collect()
        };
        // A town's street spacing is declared by the founding process the feature runs.
        let spaced = declared_settings(built, &chosen("streetSpacing", 140.)).expect("in bounds");
        assert_eq!(spaced, chosen("streetSpacing", 140.));
        // What the map leaves unsaid stays the process's to decide.
        assert!(declared_settings(built, &Values::new())
            .expect("nothing chosen")
            .is_empty());
        // A shortcut cannot save more than the whole walk.
        assert!(declared_settings(built, &chosen("shortcutSaving", 1.5)).is_err());
        assert!(declared_settings(built, &chosen("streetSpacing", -1.)).is_err());
        // A plot of no width would never let the survey step along a street.
        assert!(declared_settings(built, &chosen("plotFrontage", 0.)).is_err());
        // A name no process declares is not the feature's.
        assert!(declared_settings(built, &chosen("unheardOf", 1.))
            .expect("ignored here")
            .is_empty());
    }
}
