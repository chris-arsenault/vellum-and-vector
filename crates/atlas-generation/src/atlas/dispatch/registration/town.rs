use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::town::{self, story::Layout, Settings},
    execution::ExecutionResult,
    town::{major_works::WorkFamily, templates::Template},
};
use std::io;

/// The creator's one choice is the layout; the process's layout controls are declared once in
/// `atlas/town/settings.rs`.
pub fn specification() -> io::Result<Specification> {
    let mut spec = Specification::new("real-scale.settlement", "atlas:workspace", "", false);
    spec.parameters = serde_json::from_value(serde_json::json!({
        "layout": {"type":"enum","unit":null,"required":false,"default":"story","choices":town::LAYOUTS}
    }))?;
    Ok(spec)
}
fn settings(input: &Input) -> ExecutionResult<Settings> {
    Ok(Settings {
        seed: (input.random.borrow_mut().sample(true) * f64::from(i32::MAX)) as i32,
        layout: input
            .parameters
            .get("layout")
            .and_then(serde_json::Value::as_str)
            .and_then(Layout::parse),
        template: input
            .parameters
            .get(town::TEMPLATE)
            .and_then(serde_json::Value::as_str)
            .and_then(Template::from_name),
        major_work: input
            .parameters
            .get(town::MAJOR_WORK)
            .and_then(serde_json::Value::as_str)
            .and_then(WorkFamily::from_key),
    })
}
fn initialization() -> io::Result<Specification> {
    let mut spec = specification()?;
    spec.contract.id = "town.initialize".into();
    spec.parameters.extend(serde_json::from_value::<crate::parameters::Definitions>(serde_json::json!({
        (town::TEMPLATE): {"type":"enum","required":false,"choices":Template::ALL.map(Template::name)},
        (town::MAJOR_WORK): {"type":"enum","required":false,"choices":WorkFamily::ALL.iter().map(|family| family.key()).collect::<Vec<_>>()}
    }))?);
    Ok(spec)
}
pub fn specifications() -> io::Result<Vec<Specification>> {
    let mut result = vec![specification()?];
    result.push(initialization()?);
    result.extend(
        crate::processes::town::STEPS
            .iter()
            .map(|s| Specification::new(s.id, "atlas:workspace", "", true)),
    );
    result.push(Specification::new(
        "town.signals",
        "atlas:workspace",
        "",
        true,
    ));
    result.push(Specification::new(
        "town.cultivation",
        "atlas:workspace",
        "",
        true,
    ));
    Ok(result)
}
pub fn register(
    registry: &mut Registry,
    operations: &town::development::Operations,
) -> io::Result<()> {
    registry.register(Process::unit(
        Specification::new("town.cultivation", "atlas:workspace", "", true),
        town::cultivation(),
    ))?;
    registry.register(Process::command(
        initialization()?,
        operations.initialize.clone(),
        settings,
    ))?;
    for (id, operation) in &operations.steps {
        registry.register(Process::unit(
            Specification::new(id, "atlas:workspace", "", true),
            operation.clone(),
        ))?;
    }
    registry.register(Process::command(
        specification()?,
        town::operation(),
        settings,
    ))
}
