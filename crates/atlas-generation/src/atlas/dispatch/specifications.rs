//! Read the same owner contracts before allocating a numerical workspace.
use super::{Registry, Specification};
use crate::{
    execution::{ExecutionError, ExecutionResult},
    recipe::Invocation,
};
use std::{collections::BTreeMap, io};

pub trait Specifications {
    fn specification(&self, call: &Invocation) -> ExecutionResult<&Specification>;
}
impl Specifications for Registry {
    fn specification(&self, call: &Invocation) -> ExecutionResult<&Specification> {
        Ok(&self.get(call)?.specification)
    }
}
#[derive(Default)]
pub struct Catalogue {
    entries: BTreeMap<(String, String), Specification>,
    pub products: Vec<crate::products::ProductDefinition>,
}
impl Catalogue {
    pub fn atlas(
        selection: &crate::atlas::features::Selection,
        systems: &[crate::magic::configuration::System],
        inherited: &std::collections::BTreeSet<String>,
        published: &std::collections::BTreeSet<String>,
        regional: bool,
    ) -> io::Result<Self> {
        use super::registration;
        use crate::atlas::{local_magic, native, relief};
        let mut result = Self::default();
        let carried = if inherited.contains("Elevation") {
            crate::field::inheritance::products(|name| inherited.contains(name))
        } else {
            Vec::new()
        };
        result.insert(registration::initialization(carried))?;
        let native = native::contracts();
        for contract in &native {
            result.insert(Specification::native(contract.clone())?)?;
        }
        let physical = crate::field::projection::channels::physical()
            .into_iter()
            .filter(|channel| {
                channel.selected(&|id| selection.get(id).is_some_and(|selected| selected.enabled))
            })
            .collect::<Vec<_>>();
        result.extend(registration::world::specifications(&physical, published)?)?;
        result.extend(registration::ecology::specifications())?;
        result
            .products
            .push(registration::ecology::response_product());
        result.extend(registration::people::specifications())?;
        result.extend(registration::magic::specifications(systems))?;
        result.extend(registration::landmarks::specifications())?;
        result.insert(relief::specification())?;
        result.extend(local_magic::specifications()?)?;
        if regional {
            result.extend(registration::regional::specifications(&native)?)?;
            result.extend(registration::town::specifications()?)?;
            for specification in registration::ground::specifications() {
                result.insert(specification)?;
            }
        }
        Ok(result)
    }
    pub fn insert(&mut self, specification: Specification) -> io::Result<()> {
        let key = (
            specification.contract.id.clone(),
            specification.contract.version.clone(),
        );
        if self.entries.contains_key(&key) {
            return Err(io::Error::other(format!(
                "Process {}@{} is already registered",
                key.0, key.1
            )));
        }
        self.entries.insert(key, specification);
        Ok(())
    }
    pub fn extend(
        &mut self,
        specifications: impl IntoIterator<Item = Specification>,
    ) -> io::Result<()> {
        for specification in specifications {
            self.insert(specification)?;
        }
        Ok(())
    }
}
impl Specifications for Catalogue {
    fn specification(&self, call: &Invocation) -> ExecutionResult<&Specification> {
        self.entries
            .get(&(call.process.clone(), call.version.clone()))
            .ok_or_else(|| {
                ExecutionError::Failed(format!("Unknown process {}@{}", call.process, call.version))
            })
    }
}
