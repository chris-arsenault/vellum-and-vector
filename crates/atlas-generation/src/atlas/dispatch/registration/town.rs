use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::town::{self, story::Layout, Settings},
    execution::ExecutionResult,
};
use std::io;

pub fn specification() -> io::Result<Specification> {
    let mut spec = Specification::new("real-scale.settlement", "atlas:workspace", "", false);
    spec.parameters = serde_json::from_value(serde_json::json!({
        "layout": {"type":"enum","unit":null,"required":false,"default":"story","choices":town::LAYOUTS}
    }))?;
    Ok(spec)
}
fn settings(input: &Input) -> ExecutionResult<Settings> {
    Ok(Settings {
        layout: input
            .parameters
            .get("layout")
            .and_then(serde_json::Value::as_str)
            .and_then(Layout::parse),
    })
}
pub fn register(registry: &mut Registry) -> io::Result<()> {
    registry.register(Process::command(
        specification()?,
        town::operation(),
        settings,
    ))
}
