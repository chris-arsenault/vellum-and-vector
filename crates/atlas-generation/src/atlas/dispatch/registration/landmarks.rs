use super::super::{Process, Registry, Specification};
use crate::atlas::landmarks::Operations;
use std::io;

type Select = fn(&Operations) -> &crate::execution::Command<crate::atlas::state::State, usize>;
const DEFINITIONS: &[(&str, Select, &str, &str)] = &[
    (
        "landmark.emplace",
        |o| &o.emplace,
        "atlas:workspace field:Elevation field:RockKindCodes",
        "atlas:landmarks",
    ),
    (
        "landmark.maintain",
        |o| &o.maintain,
        "atlas:workspace field:Elevation atlas:landmarks",
        "atlas:landmark-maintenance",
    ),
];
pub fn specifications() -> Vec<Specification> {
    DEFINITIONS
        .iter()
        .map(|(id, _, requires, produces)| Specification::new(id, requires, produces, true))
        .collect()
}
pub fn register(registry: &mut Registry, operations: &Operations) -> io::Result<()> {
    for (id, command, requires, produces) in DEFINITIONS {
        registry.register(Process::command(
            Specification::new(id, requires, produces, true),
            command(operations).clone(),
            |input| Ok(input.epoch_indices.first().copied().unwrap_or(0)),
        ))?;
    }
    Ok(())
}
