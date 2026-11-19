pub use crate::town::{
    addresses, geometry, ground, growth, lanes, network, plots, seat, settings, story, wards,
};
pub mod development;
mod founding_site;
mod providers;
pub mod site;
use super::state::State;
use crate::execution::{Command, CommandKind};
use story::Layout;

/// The process's settings: a layout the creator forces, or none to let each settlement's
/// story choose.
pub struct Settings {
    pub layout: Option<Layout>,
    pub seed: i32,
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
pub fn operation() -> Command<State, Settings> {
    Command::with_inputs(
        "real-scale.settlement",
        CommandKind::Publish,
        vec![],
        |scope, settings: &Settings| {
            let _ = settings;
            let state = scope.state_mut();
            let fabric = std::mem::take(&mut state.town);
            let result = crate::publication::town::publish(state, &fabric);
            state.town = fabric;
            result?;
            Ok(())
        },
    )
}
pub fn cultivation() -> Command<State> {
    Command::with_inputs(
        "town.cultivation",
        CommandKind::Work,
        vec![],
        |scope, _: &()| {
            let state: &mut State = scope.state_mut();
            let site = site::read(state)?;
            if state.town.fields.is_empty() && state.town.fallow.is_empty() {
                let ways: Vec<_> = site
                    .ways
                    .iter()
                    .map(|(p, _)| crate::town::edits::line(p))
                    .collect();
                state.town.fields = crate::town::land::establish(
                    site.bounds,
                    &ways,
                    &state.scope.area,
                    |p| site::shares(state.field(), p),
                    state.spatial.as_ref(),
                )?;
            }
            crate::town::land::develop(
                &mut state.town,
                &site.ways,
                &site.ground,
                state.spatial.as_ref(),
            )?;
            Ok(())
        },
    )
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
