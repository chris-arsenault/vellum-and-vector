//! Initialize the same material owners for a world and an independent captured child.
use crate::{
    execution::{Command, CommandKind},
    features::Feature,
    field::{forcing, poi::door::seed_captured_doors, projection::Surface, shared::Scalar, Field},
    magic::{
        configuration::Source,
        inheritance::{Captured, Inheritance, Quantity},
        workspace::{Configuration, Workspace},
    },
};
use std::{cell::RefCell, io};

pub struct Capture<'a> {
    pub channels: &'a [Captured<'a>],
    pub regional: bool,
}
pub struct Initialize<'a> {
    pub configuration: RefCell<Option<Configuration>>,
    pub capture: Option<Capture<'a>>,
    pub features: &'a [Feature],
    pub surface: &'a Surface,
    pub output: RefCell<Option<Workspace>>,
}
pub fn initialize<'a>() -> Command<Field, Initialize<'a>> {
    Command::with_inputs(
        "magic.initialize",
        CommandKind::Initialize,
        vec![],
        |scope, input: &Initialize<'_>| {
            let field = scope.state_mut();
            let configuration = input.configuration.borrow_mut().take().ok_or_else(|| {
                io::Error::other("Magic initialization configuration was already consumed")
            })?;
            let enabled = configuration.enabled;
            let mut workspace = Workspace::new(
                configuration,
                &field.scale,
                &mut field.coverage.borrow_mut(),
                &mut field.ground.borrow_mut(),
            )?;
            if let Some(capture) = &input.capture {
                inherit(field, &mut workspace, capture, input.features)?;
                if capture.regional && enabled {
                    remember_forcing(field, &mut workspace, input.surface)?;
                }
            }
            *input.output.borrow_mut() = Some(workspace);
            Ok(())
        },
    )
}
fn inherit(
    field: &mut Field,
    workspace: &mut Workspace,
    capture: &Capture<'_>,
    features: &[Feature],
) -> io::Result<()> {
    let impacts: Vec<_> = field
        .events
        .iter()
        .filter(|event| event.kind == crate::field::events::EventKind::Impact)
        .map(|event| event.id.clone())
        .collect();
    let parent = Inheritance {
        mesh: &field.mesh,
        regional: capture.regional,
        channels: capture.channels,
        impacts: &impacts,
    };
    let mut coverage = field.coverage.borrow_mut();
    let mut records = [None, None, None, None];
    for (index, (name, quantity)) in [
        ("Tenure", Quantity::SiteAmount),
        ("WalkedRoute", Quantity::Extensive),
        ("KeptLine", Quantity::Extensive),
        ("MassDeath", Quantity::Extensive),
    ]
    .into_iter()
    .enumerate()
    {
        let mut values = coverage.scratch(field.mesh.len(), 0.0);
        if parent.channel(name, &mut values, quantity, &mut coverage)? {
            records[index] = Some(values.read_only());
        }
    }
    field.people.capture_place_records(records)?;
    workspace.inherit(&parent, &mut coverage)?;
    if capture.regional {
        for system in workspace
            .fields
            .iter_mut()
            .filter(|system| system.definition().enabled)
        {
            parent.present_intensity(system, &mut coverage)?;
            if system
                .definition()
                .origins
                .iter()
                .any(|origin| origin.source == Source::Pairing)
            {
                let mesh = &field.mesh;
                let [ox, oy] = mesh.origin();
                seed_captured_doors(system, features, |x, y| mesh.cell_at(x - ox, y - oy));
            }
        }
    }
    Ok(())
}
fn remember_forcing(field: &Field, workspace: &mut Workspace, surface: &Surface) -> io::Result<()> {
    let standalone = forcing::sampled(field, surface, "Heat")?;
    let fog = field.shared.scalar(Scalar::FogForcing);
    let heat = field.shared.scalar(Scalar::ExternalHeatForcing);
    for cell in 0..field.mesh.len() {
        workspace.forcing.fog.set(cell, fog.get(cell)?)?;
        let applied = standalone
            .as_ref()
            .map(|band| band.get(cell))
            .transpose()?
            .unwrap_or(0.0);
        workspace
            .forcing
            .heat
            .set(cell, heat.get(cell)? - (applied * 10.0 + 0.5).floor())?;
    }
    Ok(())
}
