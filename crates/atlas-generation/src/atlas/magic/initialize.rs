//! Initialize configured systems from the map's pinned resource inputs.
use super::super::state::State;
use crate::{
    execution::{Command, CommandKind},
    field::{inheritance::Inputs, magic::initialization::Capture, schema::NumericBand},
    magic::{inheritance::Captured, workspace::Configuration},
    reconstruction::surface::Surface,
    storage::{Coverage, SharedCache},
};
use std::{collections::BTreeSet, io, rc::Rc};

// Arconis: docs/architecture/subsystems.arconis#item=m_init — sets up magic from the map's inputs.
pub fn operation(
    configuration: Configuration,
    inputs: Rc<Inputs>,
    cache: SharedCache,
    regional: bool,
) -> Command<State> {
    Command::new(
        "atlas.magic-initialize",
        CommandKind::Initialize,
        vec![],
        move |state: &mut State, _| {
            let enabled = if regional {
                state
                    .regional
                    .as_ref()
                    .ok_or_else(|| {
                        io::Error::other("Regional magic requires captured regional context")
                    })?
                    .domains
                    .iter()
                    .any(|domain| domain == "magic")
            } else {
                configuration.enabled
            };
            let inherited = inputs.surface.channels.contains_key("Elevation");
            let mut coverage = Coverage::samples(0, cache.clone());
            let names = inputs
                .surface
                .channels
                .keys()
                .chain(inputs.parent.keys())
                .cloned()
                .collect::<BTreeSet<_>>();
            let mut records = Vec::new();
            if inherited {
                for name in names {
                    let resource = inputs.source(&name);
                    let Some(channel) = resource.channels.get(&name) else {
                        continue;
                    };
                    let values = match &channel.values {
                        NumericBand::F64(values) => values.clone(),
                        values => {
                            let mut copy = coverage.scratch(values.len(), 0.0);
                            for cell in 0..values.len() {
                                copy.set(cell, values.get(cell)?)?;
                            }
                            copy.read_only()
                        }
                    };
                    records.push((name, resource, values));
                }
            }
            let captured = records
                .iter()
                .map(|(name, resource, values)| Captured {
                    key: name.clone(),
                    surface: Surface {
                        grid: &resource.grid,
                        values: values.clone(),
                        overlays: Vec::new(),
                    },
                })
                .collect::<Vec<_>>();
            state.initialize_magic(
                Configuration {
                    enabled,
                    systems: configuration.systems.clone(),
                    confluences: configuration.confluences.clone(),
                },
                inherited.then_some(Capture {
                    channels: &captured,
                    regional,
                }),
            )?;
            Ok(())
        },
    )
}
