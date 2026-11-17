//! Custody metadata names material inventories; quantities remain in their owning columns.
use super::{cargo::MaterialCargo, material::MaterialLayer};
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct CargoIdentities {
    names: Vec<String>,
    released: Vec<i32>,
}
impl CargoIdentities {
    fn identity(&mut self, name: &str) -> i32 {
        let index = self
            .names
            .iter()
            .position(|held| held == name)
            .unwrap_or_else(|| {
                self.names.push(name.into());
                self.released.push(
                    i32::try_from(self.names.len()).expect("Cargo identity exceeds representation"),
                );
                self.names.len() - 1
            });
        (index + 1) as i32
    }
    pub fn declare(&mut self, name: &str, released_to: Option<&str>) -> Result<i32, &'static str> {
        let key = self.identity(name);
        if let Some(name) = released_to {
            let target = self.identity(name);
            let previous = self.released[key as usize - 1];
            if (previous != key && previous != target)
                || self.released[target as usize - 1] != target
            {
                return Err("Custody returns to one ordinary material identity");
            }
            self.released[key as usize - 1] = target;
        }
        Ok(key)
    }
    pub fn names(&self) -> &[String] {
        &self.names
    }
    pub fn release_names(&self) -> impl Iterator<Item = &str> {
        self.released
            .iter()
            .map(|&key| self.names[key as usize - 1].as_str())
    }
    pub fn release(&self, cargo: &MaterialCargo) -> Option<MaterialCargo> {
        cargo.map_keys(|key| self.released_key(key))
    }
    fn released_key(&self, key: i32) -> i32 {
        key.checked_sub(1)
            .and_then(|i| usize::try_from(i).ok())
            .and_then(|i| self.released.get(i))
            .copied()
            .unwrap_or(key)
    }
    pub fn released_material(&self, mut material: MaterialLayer) -> MaterialLayer {
        material.cargo = material
            .cargo
            .take()
            .and_then(|cargo| cargo.into_mapped_keys(|key| self.released_key(key)));
        material
    }
}
