pub use crate::town::{
    addresses, geometry, ground, growth, lanes, network, plots, seat, settings, story, wards,
};
#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) mod bench;
pub mod development;
pub(crate) mod founding_site;
mod held_ground;
mod providers;
pub mod site;
use story::Layout;

/// The process's settings: a layout the creator forces, or none to let each settlement's
/// story choose.
#[derive(Clone, Copy)]
pub struct Settings {
    pub layout: Option<Layout>,
    pub seed: i32,
    pub template: Option<crate::town::templates::Template>,
    pub major_work: Option<crate::town::major_works::WorkFamily>,
    /// How each town the process founds is ordered, as the map's settings give it.
    pub order: crate::town::order::Order,
    /// A civic order the creator asks for, or none to let each settlement's site draw one.
    pub civic: Option<crate::town::templates::civic::Civic>,
    /// A craft, by code, the creator asks the settlements to practise everywhere, or none
    /// to let each site draw.
    pub craft: Option<i32>,
}

pub(super) const TEMPLATE: &str = "template";
pub(super) const MAJOR_WORK: &str = "majorWork";
pub(super) const CIVIC_ORDER: &str = "civicOrder";
pub(super) const CITY_CRAFT: &str = "cityCraft";
/// The craft a magic system's name stands for, by craft code.
pub(super) fn craft_named(system: &str) -> Option<i32> {
    crate::field::people::crafts::CRAFTS
        .iter()
        .find(|craft| craft.system == system)
        .map(|craft| craft.code)
}

pub(super) fn validate_choices(choices: &crate::parameters::Values) -> std::io::Result<()> {
    use crate::town::{
        major_works::WorkFamily,
        templates::{civic::Civic, Template},
    };
    for (key, value) in choices {
        let valid = value.as_str().is_some_and(|value| match key.as_str() {
            TEMPLATE => Template::from_name(value).is_some(),
            MAJOR_WORK => WorkFamily::from_key(value).is_some(),
            CIVIC_ORDER => Civic::from_name(value).is_some(),
            CITY_CRAFT => craft_named(value).is_some(),
            _ => false,
        });
        if !valid {
            return Err(std::io::Error::other(format!(
                "Invalid settlement choice {key}: {value}"
            )));
        }
    }
    Ok(())
}
/// The layout setting's choices; `story` lets each settlement's own story decide.
pub const LAYOUTS: [&str; 6] = ["story", "organic", "grid", "radial", "linear", "walled"];
// owner-direction(2026-11-18): town development runs independently of regional development rounds.
pub fn sequence(
    catalogue: &super::features::Catalogue,
    context: &super::features::Context<'_>,
) -> std::io::Result<crate::recipe::Sequence> {
    use crate::parameters::Values;
    let context = super::features::Context {
        policy: super::features::Policy::Regional,
        ..context.clone()
    };
    let mut sequence = catalogue.compose("town.initialize", "town", &context, &Values::new())?;
    // owner-direction(2026-11-18): grow towns from an inhabited kernel across roughly 18 recurring iterations of comparable magnitude.
    for round in 0..settings::DEVELOPMENT_ROUNDS {
        sequence.extend(catalogue.compose(
            "town.develop",
            &format!("town/round-{round}"),
            &context,
            &Values::new(),
        )?);
    }
    sequence.extend(catalogue.compose("town.publish", "town/final", &context, &Values::new())?);
    Ok(sequence)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urban_rounds_compose_between_land_and_trails() {
        use crate::atlas::features::{Catalogue, Context, Policy, Selected, Selection};
        use crate::sequence::SequenceNode;
        let catalogue = Catalogue::default();
        let selection = Selection::from([(
            "built.layout".into(),
            Selected {
                enabled: true,
                ..Default::default()
            },
        )]);
        let context = Context {
            selection: &selection,
            policy: Policy::Regional,
            refinement: true,
            landmarks_apply: false,
            standalone_magic: false,
            initial: false,
            material: false,
            process: None,
        };
        let urban = sequence(&catalogue, &context).unwrap();
        let complete =
            crate::atlas::regional::sequence::real_scale(&catalogue, &context, urban).unwrap();
        let calls: Vec<_> = complete
            .iter()
            .filter_map(|node| match node {
                SequenceNode::Process { operation, .. } => Some(operation.process.as_str()),
                _ => None,
            })
            .collect();
        let index = |name: &str| calls.iter().position(|call| *call == name).unwrap();
        assert!(index("atlas.names") < index("town.initialize"));
        assert!(index("town.initialize") < index("town.construction"));
        assert_eq!(
            calls
                .iter()
                .filter(|call| **call == "town.construction")
                .count(),
            settings::DEVELOPMENT_ROUNDS
        );
        assert!(index("real-scale.settlement") < index("real-scale.trails"));
    }
    #[test]
    fn every_layout_choice_parses() {
        for layout in &LAYOUTS[1..] {
            assert!(Layout::parse(layout).is_some());
        }
    }
}
