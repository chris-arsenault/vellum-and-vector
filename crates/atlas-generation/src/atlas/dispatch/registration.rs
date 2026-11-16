//! Registration composes owner operations; recipes remain the only runtime schedule.
pub mod ecology;
pub mod landmarks;
pub mod magic;
pub mod people;
pub mod regional;
pub mod town;
pub mod world;
use super::{Process, Registry};
use crate::atlas::physical::Physical;
use std::io;
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
