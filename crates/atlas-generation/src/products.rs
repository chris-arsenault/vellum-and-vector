//! Run-local input validity and provider ownership, separate from numerical material accounting.
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lifetime {
    Run,
    Epoch,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Composition {
    Exclusive,
    SharedState,
    Additive,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Representation {
    Field,
    History,
    Forcing,
    Geography,
    Workspace,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    LocatedSpace,
}
#[derive(Clone, Debug)]
pub struct ProductDefinition {
    pub id: String,
    pub lifetime: Lifetime,
    pub unit: Option<String>,
    pub representation: Option<Representation>,
    pub scope: Option<Scope>,
    pub composition: Option<Composition>,
}
impl ProductDefinition {
    pub fn new(id: impl Into<String>, lifetime: Lifetime) -> Self {
        Self {
            id: id.into(),
            lifetime,
            unit: None,
            representation: None,
            scope: None,
            composition: None,
        }
    }
    fn merge(&mut self, other: Self) -> Result<(), ProductError> {
        if self.lifetime != other.lifetime {
            return Err(ProductError::ConflictingDefinition(self.id.clone()));
        }
        let conflict = || ProductError::ConflictingDefinition(self.id.clone());
        merge_optional(&mut self.unit, other.unit).map_err(|_| conflict())?;
        merge_optional(&mut self.representation, other.representation).map_err(|_| conflict())?;
        merge_optional(&mut self.scope, other.scope).map_err(|_| conflict())?;
        merge_optional(&mut self.composition, other.composition).map_err(|_| conflict())
    }
}
fn merge_optional<T: PartialEq>(held: &mut Option<T>, other: Option<T>) -> Result<(), ()> {
    if let Some(value) = other {
        if held.as_ref().is_some_and(|held| *held != value) {
            return Err(());
        }
        *held = Some(value);
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProductError {
    ConflictingDefinition(String),
    ExclusiveProviders {
        product: String,
        previous: String,
        provider: String,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProductStatus {
    Missing,
    Stale,
    Available,
}
#[derive(Clone)]
pub struct ProductContract {
    pub id: String,
    pub version: String,
    pub requires: Vec<String>,
    pub produces: Vec<String>,
    pub invalidates: Vec<String>,
}
impl ProductContract {
    fn provider(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }
}

/// Allocation alone establishes no input. Material history is not execution recovery.
#[derive(Clone)]
pub struct ProductLedger {
    facts: BTreeSet<String>,
    definitions: BTreeMap<String, ProductDefinition>,
    invalidators: BTreeMap<String, String>,
    providers: BTreeMap<String, String>,
}
impl ProductLedger {
    pub(crate) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> std::io::Result<()> {
        archive.value("facts", &mut self.facts)?;
        archive.value("invalidators", &mut self.invalidators)?;
        archive.value("providers", &mut self.providers)
    }
    pub fn new(
        facts: impl IntoIterator<Item = String>,
        definitions: impl IntoIterator<Item = ProductDefinition>,
    ) -> Result<Self, ProductError> {
        let mut registered: BTreeMap<String, ProductDefinition> = BTreeMap::new();
        for definition in definitions {
            if let Some(held) = registered.get_mut(&definition.id) {
                held.merge(definition)?;
            } else {
                registered.insert(definition.id.clone(), definition);
            }
        }
        Ok(Self {
            facts: facts.into_iter().collect(),
            definitions: registered,
            invalidators: BTreeMap::new(),
            providers: BTreeMap::new(),
        })
    }
    pub fn status(&self, product: &str) -> ProductStatus {
        if self.facts.contains(product) {
            ProductStatus::Available
        } else if self.invalidators.contains_key(product) {
            ProductStatus::Stale
        } else {
            ProductStatus::Missing
        }
    }
    pub fn accepts(&self, product: &str) -> bool {
        self.facts.contains(product)
    }
    pub fn invalidated_by(&self, product: &str) -> Option<&str> {
        self.invalidators.get(product).map(String::as_str)
    }
    pub fn missing<'a>(&self, contract: &'a ProductContract) -> Vec<&'a str> {
        contract
            .requires
            .iter()
            .filter(|product| !self.accepts(product))
            .map(String::as_str)
            .collect()
    }
    pub fn produce(&mut self, product: impl Into<String>) {
        let product = product.into();
        self.invalidators.remove(&product);
        self.facts.insert(product);
    }
    pub fn invalidate(&mut self, product: impl Into<String>, by: impl Into<String>) {
        let product = product.into();
        self.facts.remove(&product);
        self.invalidators.insert(product, by.into());
    }
    pub fn enter_epoch(&mut self, path: &str) {
        let products: Vec<_> = self
            .definitions
            .values()
            .filter(|definition| definition.lifetime == Lifetime::Epoch)
            .map(|definition| definition.id.clone())
            .collect();
        for product in products {
            self.invalidate(product, format!("{path} epoch boundary"));
        }
    }
    /// Conditional repair retains only validity established on both outcomes.
    pub fn join(&mut self, branch: &Self, by: &str) {
        self.providers.extend(branch.providers.clone());
        let products: BTreeSet<_> = self
            .facts
            .iter()
            .chain(&branch.facts)
            .chain(self.invalidators.keys())
            .chain(branch.invalidators.keys())
            .cloned()
            .collect();
        for product in products {
            if !self.facts.contains(&product) || !branch.facts.contains(&product) {
                self.invalidate(product, by);
            }
        }
    }
    pub fn check_providers(&self, contract: &ProductContract) -> Result<(), ProductError> {
        let provider = contract.provider();
        for product in &contract.produces {
            if !self.exclusive(product) {
                continue;
            }
            if let Some(previous) = self
                .providers
                .get(product)
                .filter(|previous| **previous != provider)
            {
                return Err(ProductError::ExclusiveProviders {
                    product: product.clone(),
                    previous: previous.clone(),
                    provider,
                });
            }
        }
        Ok(())
    }
    fn exclusive(&self, product: &str) -> bool {
        self.definitions
            .get(product)
            .is_some_and(|definition| definition.composition == Some(Composition::Exclusive))
    }
    pub fn commit(&mut self, contract: &ProductContract, by: &str) -> Result<(), ProductError> {
        self.check_providers(contract)?;
        for product in &contract.produces {
            if self.exclusive(product) {
                self.providers.insert(product.clone(), contract.provider());
            }
        }
        for product in &contract.invalidates {
            self.invalidate(product, by);
        }
        for product in &contract.produces {
            self.produce(product);
        }
        Ok(())
    }
}
