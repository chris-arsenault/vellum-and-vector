//! A reservoir owns either a mobile amount or a key in actual Ground material.
use crate::{
    rock::{
        catalogue::SALT_BED,
        ground::{inventory::InventoryKey, Ground, InventoryConstruction},
    },
    scale::MapScale,
    storage::Band,
};
use std::io;
pub enum Inventory {
    Mobile(Band<f64>),
    Ground(InventoryKey),
}
impl Inventory {
    pub fn get(&self, ground: &Ground, cell: usize) -> io::Result<f64> {
        match self {
            Self::Mobile(values) => values.get(cell),
            Self::Ground(key) => ground.inventory_get(*key, cell),
        }
    }
    pub fn set(&mut self, ground: &mut Ground, cell: usize, amount: f64) -> io::Result<()> {
        match self {
            Self::Mobile(values) => values.set(cell, amount),
            Self::Ground(key) => ground.inventory_set(*key, cell, amount),
        }
    }
    pub fn add(&mut self, ground: &mut Ground, cell: usize, amount: f64) -> io::Result<()> {
        self.set(ground, cell, self.get(ground, cell)? + amount)
    }
    pub fn deposit_salt(
        &mut self,
        ground: &mut Ground,
        cell: usize,
        amount: f64,
        area: f64,
        density: f64,
    ) -> io::Result<()> {
        if amount <= 0.0 {
            return Ok(());
        }
        let Self::Ground(key) = self else {
            return Err(io::Error::other("Solid Salt must belong to Ground"));
        };
        ground.inventory_construct(
            *key,
            cell,
            InventoryConstruction {
                amount,
                depth: MapScale::native(amount / (area * density)),
                kind: SALT_BED,
            },
            "salt",
        )
    }
    pub fn deposit_fallen(
        &mut self,
        ground: &mut Ground,
        cell: usize,
        amount: f64,
        area: f64,
        density: f64,
    ) -> io::Result<()> {
        if amount <= 0.0 || density <= 0.0 {
            return Ok(());
        }
        let Self::Ground(key) = self else {
            return Err(io::Error::other("Fallen cores must belong to Ground"));
        };
        ground.inventory_construct(
            *key,
            cell,
            InventoryConstruction {
                amount,
                depth: MapScale::native(amount * 0.15 / (area * density)),
                kind: 16,
            },
            "fire",
        )
    }
}
pub fn hosts(system: &str, reservoir: &str) -> Option<&'static [usize]> {
    match (system, reservoir) {
        ("fire", "held" | "spent") => Some(&[14, 15, 16, 13]),
        ("aurora", "ground" | "moraine") => Some(&[17, 18]),
        ("greenwood", "stratum") => Some(&[20, 21]),
        ("hallowed", "held") => Some(&[23]),
        ("veil", "held") => Some(&[24]),
        ("salt", "bed" | "dust") => Some(&[4, 22]),
        _ => None,
    }
}
pub fn host_fraction(layer: &crate::rock::material::MaterialLayer, kinds: &[usize]) -> f64 {
    (if kinds.contains(&layer.kind) {
        1.0 - layer.secondary_share
    } else {
        0.0
    }) + if kinds.contains(&layer.secondary_kind) {
        layer.secondary_share
    } else {
        0.0
    }
}
pub fn exposure(
    ground: &Ground,
    cell: usize,
    burial_depth: f64,
    kinds: Option<&[usize]>,
) -> io::Result<f64> {
    use crate::{
        rock::ground::queries::{section_exposure, section_inventory},
        settlement::removal::Facet,
    };
    let mut available = 0.0;
    let mut reached = 0.0;
    for facet in Facet::ALL {
        let section = ground.section(cell, facet)?;
        let share = ground.share(cell, facet)?;
        let reach = MapScale::native(burial_depth);
        if let Some(kinds) = kinds {
            let inventory = section_inventory(&section, reach, |layer| {
                host_fraction(&layer.material, kinds)
            });
            available += share * inventory.available;
            reached += share * inventory.reached;
        } else {
            available += share;
            reached += share * section_exposure(&section, reach, |layer| !layer.loose);
        }
    }
    Ok(if available > 0.0 {
        reached / available
    } else {
        0.0
    })
}
