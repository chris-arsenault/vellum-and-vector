use super::error;
use crate::{
    atlas::{
        dispatch::preflight::{ConfigurationField, Diagnostic},
        features::Selection,
        history::Severity,
    },
    magic::{
        configuration::System, confluences::configuration::Confluence,
        regions::independent_interaction,
    },
};
use std::{collections::BTreeSet, io};

pub fn validate_confluences(definitions: &[Confluence], _systems: &[System]) -> io::Result<()> {
    let mut ids = BTreeSet::new();
    for definition in definitions {
        if !ids.insert(&definition.id) {
            return Err(error(
                "magic_confluence",
                "Confluences need distinct identities",
            ));
        }
        definition.validate_definition().map_err(io::Error::other)?;
    }
    Ok(())
}
pub fn require(
    selection: &Selection,
    dependency: &str,
    feature: &str,
    field: Option<ConfigurationField>,
) -> Option<Diagnostic> {
    if selection
        .get(dependency)
        .is_some_and(|choice| choice.enabled)
    {
        return None;
    }
    Some(Diagnostic {
        code: "feature_dependency".into(),
        severity: Severity::Error,
        invocation: feature.into(),
        resource: Some(dependency.into()),
        field,
        message: format!(
            "{feature} requires {dependency}. Enable it or remove the dependent choice."
        ),
    })
}
pub fn requirements(selection: &Selection, systems: &[System]) -> Vec<Diagnostic> {
    if !selection
        .get("magic.configured")
        .is_some_and(|choice| choice.enabled)
    {
        return Vec::new();
    }
    systems
        .iter()
        .enumerate()
        .flat_map(|(index, system)| {
            effect_requirements(selection, system, index)
                .into_iter()
                .chain(rule_requirements(selection, system, index))
        })
        .collect()
}
fn effect_requirements(selection: &Selection, system: &System, index: usize) -> Vec<Diagnostic> {
    if !system.enabled {
        return Vec::new();
    }
    let effects = &system.effects;
    [
        (
            "vegetationGrowth",
            effects.vegetation_growth,
            "ecology.living",
        ),
        ("fire", effects.fire, "ecology.living"),
        (
            "organicPreservation",
            effects.organic_preservation,
            "ecology.living",
        ),
        ("animalToxicity", effects.animal_toxicity, "ecology.living"),
        ("seedDispersal", effects.seed_dispersal, "ecology.living"),
        (
            "coastalForcing",
            effects.coastal_forcing,
            "physical.coastal-evolution",
        ),
    ]
    .into_iter()
    .filter(|(_, value, _)| *value != 0.0)
    .filter_map(|(name, _, dependency)| {
        require(
            selection,
            dependency,
            &system.name,
            Some(ConfigurationField {
                feature: "magic.configured".into(),
                path: vec![
                    "magicSystems".into(),
                    index.into(),
                    "effects".into(),
                    name.into(),
                ],
            }),
        )
    })
    .collect()
}
fn rule_requirements(selection: &Selection, system: &System, index: usize) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for (rule_index, rule) in system
        .features
        .iter()
        .enumerate()
        .filter(|(_, rule)| system.enabled || independent_interaction(rule, &system.id))
    {
        let conditions = [
            ("seeds", rule.seeds.as_slice()),
            ("retains", rule.retains.as_deref().unwrap_or_default()),
        ]
        .into_iter()
        .flat_map(|(kind, groups)| {
            groups
                .iter()
                .enumerate()
                .flat_map(move |(group_index, group)| {
                    group
                        .iter()
                        .enumerate()
                        .map(move |(condition_index, condition)| {
                            (kind, group_index, condition_index, condition)
                        })
                })
        });
        for (kind, group, condition, _) in conditions.filter(|(_, _, _, condition)| {
            [
                "biome",
                "treeCover",
                "wetlandCover",
                "peatCarbon",
                "oilCarbon",
                "ecologicalToxicity",
                "soilWater",
                "soilDepth",
                "grazers",
                "browsers",
            ]
            .contains(&condition.field.as_str())
        }) {
            diagnostics.extend(require(
                selection,
                "ecology.living",
                &rule.name,
                Some(ConfigurationField {
                    feature: "magic.configured".into(),
                    path: vec![
                        "magicSystems".into(),
                        index.into(),
                        "features".into(),
                        rule_index.into(),
                        kind.into(),
                        group.into(),
                        condition.into(),
                        "field".into(),
                    ],
                }),
            ));
        }
    }
    diagnostics
}
