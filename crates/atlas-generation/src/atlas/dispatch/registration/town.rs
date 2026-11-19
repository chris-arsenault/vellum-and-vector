use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::town::{self, story::Layout, Settings},
    execution::ExecutionResult,
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
    })
}
pub fn specifications() -> io::Result<Vec<Specification>> {
    let mut result = vec![specification()?];
    let mut initialize = specification()?;
    initialize.contract.id = "town.initialize".into();
    result.push(initialize);
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
    let mut initialize = specification()?;
    initialize.contract.id = "town.initialize".into();
    registry.register(Process::command(
        initialize,
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
