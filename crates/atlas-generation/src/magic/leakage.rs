//! Retained charge dissipates through the material actually reached by the surface.
use super::{
    channels::Channel,
    inventory::{host_fraction, hosts, Inventory},
    state::MagicField,
};
use crate::{
    rock::{
        catalogue::hardness_of,
        ground::{
            queries::{section_inventory, section_response},
            query::{material_fact, Fact},
            Ground,
        },
        material::MaterialLayer,
    },
    scale::MapScale,
    settlement::removal::Facet,
};
use std::io;
fn leaks(reservoir: &str) -> bool {
    matches!(
        reservoir,
        "held" | "spent" | "ground" | "aquifer" | "stratum" | "moraine" | "shelf"
    )
}
pub fn material_leak(system: &str, reservoir: &str, layer: &MaterialLayer) -> f64 {
    let susceptibility = match (reservoir, system) {
        ("held", "hallowed") => 1.0 - hardness_of(material_fact(layer, Fact::Resistance)),
        ("held", "veil") => 1.0 - material_fact(layer, Fact::Jointing),
        ("held" | "spent", _) => material_fact(layer, Fact::Jointing),
        ("ground" | "moraine" | "shelf", _) => material_fact(layer, Fact::Porosity),
        ("aquifer", _) => 1.0 - material_fact(layer, Fact::Porosity),
        ("stratum", _) => material_fact(layer, Fact::Solubility),
        _ => 0.0,
    };
    0.12 * susceptibility
}
fn leakage(
    ground: &Ground,
    system: &str,
    reservoir: &str,
    cell: usize,
    burial_depth: f64,
) -> io::Result<f64> {
    let reach = MapScale::native(burial_depth);
    let kinds = hosts(system, reservoir);
    let mut value = 0.0;
    let mut available = 0.0;
    let mut fallback = 0.0;
    for facet in Facet::ALL {
        let section = ground.section(cell, facet)?;
        let share = ground.share(cell, facet)?;
        fallback += share
            * section_response(&section, reach, |layer| {
                material_leak(system, reservoir, &layer.material)
            });
        let Some(kinds) = kinds else {
            continue;
        };
        let inventory = section_inventory(&section, reach, |layer| {
            host_fraction(&layer.material, kinds)
        });
        let loss = section_inventory(&section, reach, |layer| {
            host_fraction(&layer.material, kinds)
                * material_leak(system, reservoir, &layer.material)
        });
        available += share * inventory.available;
        value += share * loss.reached;
    }
    Ok(if available > 0.0 {
        value / available
    } else {
        fallback
    })
}
pub fn from_column(ground: &mut Ground, field: &mut MagicField, cell: usize) -> io::Result<()> {
    let mut before = 0.0;
    let mut after = 0.0;
    for (origin, state) in field.definition.origins.iter().zip(&mut field.origins) {
        let burial = origin
            .parameters
            .bury_depth
            .unwrap_or(field.definition.parameters.bury_depth);
        for (stock, values) in origin.stocks.iter().zip(&mut state.stocks) {
            let held = values.get(ground, cell)?;
            if held <= 0.0 || !leaks(&stock.reservoir) {
                continue;
            }
            let lost = match values {
                Inventory::Ground(key) => {
                    ground.inventory_release(*key, cell, MapScale::native(burial), &|layer| {
                        material_leak(&field.definition.id, &stock.reservoir, layer)
                    })?
                }
                Inventory::Mobile(values) => {
                    let lost = held
                        * leakage(ground, &field.definition.id, &stock.reservoir, cell, burial)?;
                    values.set(cell, held - lost)?;
                    lost
                }
            };
            field.lost += lost;
            if stock.reservoir == "ground" {
                before += held;
                after += held - lost;
            }
        }
    }
    if before > 0.0 {
        let stored = field.channels.band(Channel::Stored).get(cell)?;
        field
            .channels
            .band_mut(Channel::Stored)
            .set(cell, stored * after / before)?;
    }
    Ok(())
}
