//! Charge is attached to retained material. Inventory handles never create a carrier by scalar write.
use super::{
    placement::{cover_column, rock_column},
    Ground,
};
use crate::{
    hpc::IntPairIndex,
    rock::{cargo::MaterialCargo, columns::Column, material::MaterialLayer},
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
};
use std::io;
#[derive(Clone, Copy)]
pub struct InventoryKey(pub(super) i32);
impl InventoryKey {
    pub fn cargo(self, host: usize, density: f64) -> MaterialCargo {
        MaterialCargo::from_entries([(self.0, host as i32, density)])
    }
    pub fn rekey_cargo(self, cargo: &MaterialCargo, target: Self) -> Option<MaterialCargo> {
        cargo.rekey(self.0, target.0, 1.0)
    }
    pub fn remove_cargo(self, cargo: &MaterialCargo) -> MaterialCargo {
        cargo.without(self.0)
    }
}
#[derive(Default)]
pub(super) struct InventoryCache {
    cells: IntPairIndex,
    values: Vec<f64>,
    revisions: Vec<f64>,
    shares: Vec<f64>,
}
pub(super) struct InventoryLayer {
    pub material: MaterialLayer,
    pub slot: usize,
    pub column: Column,
    pub share: f64,
    pub top: f64,
}
pub fn cargo_density(material: &MaterialLayer, key: InventoryKey, host: Option<usize>) -> f64 {
    material.cargo.as_ref().map_or(0.0, |cargo| {
        cargo
            .entries()
            .filter(|&(held, kind, _)| held == key.0 && host.is_none_or(|host| host as i32 == kind))
            .map(|(_, _, density)| density)
            .sum()
    })
}
impl Ground {
    pub fn inventory(&mut self, name: &str, released_to: Option<&str>) -> io::Result<InventoryKey> {
        self.identities
            .declare(name, released_to)
            .map(InventoryKey)
            .map_err(io::Error::other)
    }
    pub fn inventory_get(&self, key: InventoryKey, cell: usize) -> io::Result<f64> {
        if !self.columns.has_cargo(cell)? {
            return Ok(0.0);
        }
        let mut cache = self.inventory_cache.borrow_mut();
        let at = cache.cells.include(cell as i32, key.0);
        if at == cache.values.len() {
            cache.values.push(0.0);
            cache.revisions.push(-1.0);
            cache.shares.push(-1.0);
        }
        let revision = self.columns.revision(cell)?;
        let share = self.share(cell, Facet::Cut)?;
        if cache.revisions[at] != revision || cache.shares[at] != share {
            cache.values[at] = self.inventory_reached(key, cell, f64::INFINITY)?;
            cache.revisions[at] = revision;
            cache.shares[at] = share;
        }
        Ok(cache.values[at])
    }
    pub fn inventory_reached(&self, key: InventoryKey, cell: usize, reach: f64) -> io::Result<f64> {
        if !self.columns.has_cargo(cell)? {
            return Ok(0.0);
        }
        let mut amount = 0.0;
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share <= 0.0 {
                continue;
            }
            let cover = cover_column(facet);
            let under = reach - self.columns.thickness(cell, cover)?;
            amount += share
                * (self.reached_column(key, cell, cover, reach)?
                    + self.reached_column(key, cell, rock_column(facet), under)?);
        }
        Ok(amount * self.mesh.area(cell))
    }
    fn reached_column(
        &self,
        key: InventoryKey,
        cell: usize,
        column: Column,
        mut reach: f64,
    ) -> io::Result<f64> {
        let mut amount = 0.0;
        for slot in 0..column.size() {
            let thickness = self.columns.depth(cell, column, slot)?;
            if thickness <= 0.0 || reach <= 0.0 {
                break;
            }
            let basement = !column.finite()
                && (slot + 1 == column.size()
                    || self.columns.depth(cell, column, slot + 1)? <= 0.0);
            let depth = reach.min((thickness - f64::from(basement)).max(0.0));
            amount += MapScale::metres(depth, LengthUnit::Native)
                * self.columns.cargo_density(cell, column, slot, key.0)?;
            reach -= thickness;
        }
        Ok(amount)
    }
    pub(super) fn visit_inventory(
        &self,
        cell: usize,
        action: &mut dyn FnMut(InventoryLayer) -> io::Result<()>,
    ) -> io::Result<()> {
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share <= 0.0 {
                continue;
            }
            let mut top = 0.0;
            for column in [cover_column(facet), rock_column(facet)] {
                for slot in 0..column.size() {
                    let mut material = self.columns.read_layer(cell, column, slot)?;
                    let depth = material.depth;
                    if depth <= 0.0 {
                        break;
                    }
                    if !column.finite()
                        && (slot + 1 == column.size()
                            || self.columns.depth(cell, column, slot + 1)? <= 0.0)
                    {
                        material.depth = (material.depth - 1.0).max(0.0);
                    }
                    action(InventoryLayer {
                        material,
                        slot,
                        column,
                        share,
                        top,
                    })?;
                    top += depth;
                }
            }
        }
        Ok(())
    }
    fn update_inventory(
        &mut self,
        cell: usize,
        update: &dyn Fn(&MaterialLayer) -> Option<MaterialCargo>,
    ) -> io::Result<()> {
        let mut changes = Vec::new();
        self.visit_inventory(cell, &mut |layer| {
            if layer.material.cargo.is_some() {
                changes.push((layer.slot, layer.column, update(&layer.material)));
            }
            Ok(())
        })?;
        for (slot, column, cargo) in changes {
            self.columns.set_cargo(cell, column, slot, cargo.as_ref())?;
        }
        Ok(())
    }
    pub fn inventory_set(&mut self, key: InventoryKey, cell: usize, wanted: f64) -> io::Result<()> {
        let held = self.inventory_get(key, cell)?;
        if held <= 0.0 {
            return Ok(());
        }
        let ratio = wanted.max(0.0) / held;
        self.update_inventory(cell, &|layer| {
            layer.cargo.as_ref().map(|cargo| {
                MaterialCargo::from_entries(cargo.entries().map(|(held, host, density)| {
                    (
                        held,
                        host,
                        density * if held == key.0 { ratio } else { 1.0 },
                    )
                }))
            })
        })
    }
    pub fn inventory_add(&mut self, key: InventoryKey, cell: usize, amount: f64) -> io::Result<()> {
        self.inventory_set(key, cell, self.inventory_get(key, cell)? + amount)
    }
    pub fn inventory_transfer(
        &mut self,
        key: InventoryKey,
        cell: usize,
        amount: f64,
        target: InventoryKey,
    ) -> io::Result<f64> {
        let available = self.inventory_get(key, cell)?;
        let moved = available.min(amount.max(0.0));
        if moved <= 0.0 {
            return Ok(0.0);
        }
        self.update_inventory(cell, &|layer| {
            layer
                .cargo
                .as_ref()
                .and_then(|cargo| cargo.rekey(key.0, target.0, moved / available))
        })?;
        Ok(moved)
    }
}
