//! Registration composes owner operations; recipes remain the only runtime schedule.
pub mod ecology;
pub mod ground;
pub mod landmarks;
pub mod magic;
pub mod people;
pub mod regional;
pub mod town;
pub mod world;
use super::{Process, Registry};
use crate::atlas::physical::Physical;
use std::io;

pub(super) fn street_strategy(input: &super::Input, owner: &str, name: &str) -> io::Result<bool> {
    use crate::processes::strategies::{at, definitions, MapType, Timing};
    if input.site.map_type != MapType::Street {
        return Ok(false);
    }
    let selected = at(definitions(owner)?, input.site, Timing::Present)?
        .into_iter()
        .any(|row| row.id == name);
    if selected && std::env::var_os("ATLAS_TRACE_PROCESS_REGISTRY").is_some() {
        eprintln!(
            "{}",
            serde_json::json!({"event":"generation.street.strategy", "process":owner, "strategy":name })
        );
    }
    Ok(selected)
}
pub fn initialization(inherited_products: Vec<String>) -> super::Specification {
    let mut spec = super::Specification::new(
        "atlas.initialize",
        "",
        "atlas:workspace field:SedimentSupply field:FractureConductance",
        true,
    );
    spec.contract.produces.extend(inherited_products);
    spec
}

pub fn native(registry: &mut Registry, physical: &Physical) -> io::Result<()> {
    for step in physical.native.definitions() {
        registry.register(Process::native(step.clone())?)?;
    }
    Ok(())
}
