//! Read-only wizard projection of the resolved recipe and its actual owner contracts.
use super::{cartography, Resolved};
use crate::{
    atlas::{dispatch::specifications::Specifications, resolution::Profile},
    publication::channels::Binding,
    recipe::{Configuration, Invocation},
    sequence::StageKind,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

#[derive(Serialize)]
pub struct Review {
    pub configuration: Configuration,
    pub setup: Setup,
    pub diagnostics: Vec<crate::atlas::dispatch::preflight::Diagnostic>,
}
pub fn review(
    input: &super::Input,
    resolved: &Resolved,
    frame: &super::Frame,
    context: Context<'_>,
    publications: &[Binding],
) -> io::Result<Review> {
    use crate::{
        atlas::{
            dispatch::{preflight, specifications::Catalogue},
            initial,
        },
        products::ProductLedger,
    };
    let configuration = resolved.recipe(input, frame)?;
    let published = publications
        .iter()
        .filter(|binding| binding.publish)
        .map(|binding| binding.channel.clone())
        .collect();
    let registry = Catalogue::atlas(
        &resolved.selection,
        &resolved.settings.magic_systems,
        context.channels,
        &published,
        frame.regional,
    )?;
    let products = ProductLedger::new(
        initial::facts(context.channels.iter().cloned()),
        registry.products.clone(),
    )
    .map_err(|e| io::Error::other(format!("{e:?}")))?;
    let diagnostics = preflight::inspect(&configuration, &registry, products);
    let setup = project(resolved, &configuration, &registry, publications, context)?;
    Ok(Review {
        configuration,
        setup,
        diagnostics,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Feature {
    id: String,
    label: String,
    settings: BTreeMap<String, Value>,
    #[serde(default)]
    applicability: Applicability,
    configuration_presentation: Option<Value>,
    configurable: bool,
    processes: Vec<String>,
}
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Applicability {
    setting_consumers: BTreeMap<String, Vec<String>>,
    initial_only_settings: Vec<String>,
    requires_located_sources: bool,
    epoch_controls: Vec<Value>,
    publication_profiles: BTreeMap<String, Vec<Profile>>,
}
pub struct Context<'a> {
    pub inherited: bool,
    pub completed: bool,
    pub profile: Profile,
    pub channels: &'a BTreeSet<String>,
    pub located_sources: usize,
    pub landmarks: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub context: Value,
    pub features: Vec<SetupFeature>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupFeature {
    pub id: String,
    pub label: String,
    pub epoch_controls: Vec<Value>,
    pub enabled: bool,
    pub status: &'static str,
    pub reason: Option<&'static str>,
    pub settings: Vec<Setting>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<crate::parameters::Values>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration_presentation: Option<Value>,
    pub configuration_editable: bool,
    pub invocation_ids: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub owner: String,
    pub control_feature: String,
    pub key: String,
    pub definition: Value,
    pub value: Value,
    pub active: bool,
}
struct Scheduled<'a> {
    id: String,
    owner: Option<String>,
    call: &'a Invocation,
    enabled: bool,
}
pub fn project(
    resolved: &Resolved,
    recipe: &Configuration,
    registry: &impl Specifications,
    publications: &[Binding],
    context: Context<'_>,
) -> io::Result<Setup> {
    let definitions: Vec<Feature> = serde_json::from_str(cartography::PRESENTATION)?;
    let mut calls = Vec::new();
    for stage in recipe
        .stages()
        .map_err(|e| io::Error::other(format!("{e:?}")))?
    {
        if let StageKind::Process(call) = stage.kind {
            let owner = call.feature.clone().or_else(|| {
                definitions
                    .iter()
                    .find(|feature| feature.processes.contains(&call.process))
                    .map(|feature| feature.id.clone())
            });
            calls.push(Scheduled {
                id: stage.context.path.last().cloned().unwrap_or_default(),
                owner,
                call,
                enabled: call.enabled(&stage.context),
            });
        }
    }
    let projection = Projection {
        definitions: &definitions,
        resolved,
        registry,
        publications,
        context,
        calls,
    };
    Ok(Setup {
        context: json!({"inherited":projection.context.inherited,"locatedSources":projection.context.located_sources,"landmarks":projection.context.landmarks}),
        features: definitions
            .iter()
            .map(|feature| projection.feature(feature))
            .collect::<io::Result<_>>()?,
    })
}
struct Projection<'a, S> {
    definitions: &'a [Feature],
    resolved: &'a Resolved,
    registry: &'a S,
    publications: &'a [Binding],
    context: Context<'a>,
    calls: Vec<Scheduled<'a>>,
}
impl<S: Specifications> Projection<'_, S> {
    fn feature(&self, feature: &Feature) -> io::Result<SetupFeature> {
        let bound = self.resolved.selection.get(&feature.id).ok_or_else(|| {
            io::Error::other(format!("Unknown presentation feature {}", feature.id))
        })?;
        let (status, reason) = self.status(feature, bound.enabled);
        Ok(SetupFeature {
            id: feature.id.clone(),
            label: feature.label.clone(),
            epoch_controls: feature.applicability.epoch_controls.clone(),
            enabled: bound.enabled,
            status,
            reason,
            settings: feature
                .settings
                .iter()
                .map(|(key, definition)| {
                    self.setting(feature, key, definition, &bound.settings[key])
                })
                .collect::<io::Result<_>>()?,
            configuration: bound.configuration.clone(),
            configuration_presentation: feature.configuration_presentation.clone(),
            configuration_editable: bound.enabled
                && feature.configurable
                && (feature
                    .configuration_presentation
                    .as_ref()
                    .is_some_and(|p| p["applicability"] == "any")
                    || !(self.context.inherited || self.context.completed)),
            invocation_ids: self
                .calls
                .iter()
                .filter(|call| call.owner.as_ref() == Some(&feature.id))
                .map(|call| call.id.clone())
                .collect(),
        })
    }
    fn status(&self, feature: &Feature, enabled: bool) -> (&'static str, Option<&'static str>) {
        if !enabled {
            return (
                "off",
                Some("Off in this request; configured values are retained."),
            );
        }
        if feature.applicability.requires_located_sources && self.context.located_sources == 0 {
            return ("unavailable", Some("No located magical sources affect this extent. Enabling this capability does not create sources."));
        }
        if self
            .calls
            .iter()
            .any(|call| call.owner.as_ref() == Some(&feature.id) && call.enabled)
        {
            return ("active", None);
        }
        let inherited = self.context.inherited
            && self.publications.iter().any(|binding| {
                binding.owners.contains(&feature.id.as_str())
                    && self.context.channels.contains(&binding.channel)
                    && feature
                        .applicability
                        .publication_profiles
                        .get(binding.layer)
                        .is_none_or(|profiles| profiles.contains(&self.context.profile))
            });
        if inherited {
            ("inherited", Some("Existing fields supply this geography; this request runs no new operations for it."))
        } else {
            ("unavailable", Some("This profile and generation context schedule no operations for this capability."))
        }
    }
    fn setting(
        &self,
        feature: &Feature,
        key: &str,
        definition: &Value,
        value: &Value,
    ) -> io::Result<Setting> {
        let declared = feature.applicability.setting_consumers.get(key);
        let mut active = false;
        for call in self.calls.iter().filter(|call| call.enabled) {
            active |= match declared {
                Some(consumers) => consumers.contains(&call.call.process),
                None => {
                    call.owner.as_ref() == Some(&feature.id)
                        && self
                            .registry
                            .specification(call.call)
                            .map_err(|e| io::Error::other(format!("{e:?}")))?
                            .parameters
                            .contains_key(key)
                }
            };
        }
        active &= !(self.context.inherited
            && feature
                .applicability
                .initial_only_settings
                .iter()
                .any(|name| name == key));
        let candidates = declared
            .filter(|names| !names.is_empty())
            .map(|names| {
                self.definitions
                    .iter()
                    .filter(|feature| names.iter().all(|name| feature.processes.contains(name)))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let controller = if candidates.len() == 1 {
            &candidates[0].id
        } else {
            &feature.id
        };
        Ok(Setting {
            owner: feature.id.clone(),
            control_feature: controller.clone(),
            key: key.into(),
            definition: definition.clone(),
            value: value.clone(),
            active,
        })
    }
}
