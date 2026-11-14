//! Private generation channels published after current magic classification.
use super::{
    channels::{Channel, Quantity},
    state::MagicField,
    workspace::Workspace,
};
use crate::{
    field::{shared::Scalar, Field},
    human::HumanField,
    rock::ground::Ground,
};
use std::io;

pub trait Projector {
    fn channel(
        &mut self,
        name: &str,
        unit: &'static str,
        quantity: Quantity,
        values: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<()>;
}
pub fn project(
    workspace: &Workspace,
    field: &Field,
    output: &mut impl Projector,
) -> io::Result<()> {
    for (name, values) in [
        ("naturalSurface", &workspace.surfaces.natural),
        ("finalSurface", &workspace.surfaces.final_surface),
        ("secondSurface", &workspace.surfaces.second),
    ] {
        output.channel(name, "category", Quantity::Category, &|cell| {
            values.get(cell).map(f64::from)
        })?;
    }
    for scalar in [
        Scalar::Quickening,
        Scalar::Stillness,
        Scalar::FogForcing,
        Scalar::IcePersistence,
        Scalar::IceCharge,
        Scalar::Verdure,
        Scalar::Salting,
        Scalar::Warding,
        Scalar::Tearing,
    ] {
        let values = field.shared().scalar(scalar);
        output.channel(scalar.name(), "ratio", Quantity::Intensive, &|cell| {
            values.get(cell)
        })?;
    }
    for (name, unit, id) in [
        ("Tenure", "person-year", HumanField::Tenure),
        ("WalkedRoute", "traveller-year", HumanField::WalkedRoute),
        ("KeptLine", "year", HumanField::KeptLine),
        ("MassDeath", "people", HumanField::MassDeath),
    ] {
        let values = field.people().view(id);
        output.channel(name, unit, Quantity::Extensive, &|cell| values.get(cell))?;
    }
    output.channel("magic:strain", "ratio", Quantity::Intensive, &|cell| {
        workspace.meetings.strain.get(cell)
    })?;
    for system in &workspace.fields {
        project_system(system, &field.ground(), output)?;
    }
    for state in &workspace.meetings.states {
        let id = &workspace.meetings.definitions[state.definition].rule.id;
        output.channel(
            &format!("magic:confluence:{id}:members"),
            "category",
            Quantity::Category,
            &|cell| state.members.get(cell),
        )?;
        output.channel(
            &format!("magic:confluence:{id}:coverage"),
            "ratio",
            Quantity::Intensive,
            &|cell| state.coverage.get(cell),
        )?;
    }
    Ok(())
}
fn project_system(
    system: &MagicField,
    ground: &Ground,
    output: &mut impl Projector,
) -> io::Result<()> {
    let key = |suffix: &str| format!("magic:{}:{suffix}", system.definition.id);
    for &channel in Channel::ALL {
        let declaration = channel.definition();
        if declaration.publish {
            let values = system.channel(channel);
            output.channel(
                &key(declaration.name),
                declaration.unit,
                declaration.quantity,
                &|cell| values.get(cell),
            )?;
        }
    }
    for (definition, state) in system.definition.origins.iter().zip(&system.origins) {
        output.channel(
            &key(&format!("origin:{}:source", definition.id)),
            "relative-intensity",
            Quantity::Intensive,
            &|cell| state.source.get(cell),
        )?;
        for (stock, values) in definition.stocks.iter().zip(&state.stocks) {
            output.channel(
                &key(&format!("stock:{}/{}", definition.id, stock.id)),
                "intensity-square-metre",
                Quantity::Extensive,
                &|cell| values.get(ground, cell),
            )?;
        }
    }
    output.channel(&key("coverage"), "ratio", Quantity::Intensive, &|cell| {
        system.system_coverage.get(cell)
    })?;
    for (definition, state) in system.definition.features.iter().zip(&system.features) {
        output.channel(
            &key(&format!("feature:{}", definition.id)),
            "category",
            Quantity::Category,
            &|cell| state.members.get(cell),
        )?;
        output.channel(
            &key(&format!("coverage:{}", definition.id)),
            "ratio",
            Quantity::Intensive,
            &|cell| state.coverage.get(cell),
        )?;
    }
    Ok(())
}
