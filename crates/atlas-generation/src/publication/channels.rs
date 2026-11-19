//! Numerical publication declarations stay with their Rust generation owners.
mod magic;
use crate::{
    atlas::features::Selection,
    features::records::Entity,
    field::{
        landmarks::magic::Source,
        projection::channels::{self, Quantity},
    },
    magic::{configuration::System, confluences::configuration::Confluence},
};
// hpc-exempt: publication metadata keyed by channel and entity identities.
use std::collections::{BTreeMap, BTreeSet};

pub struct Binding {
    pub channel: String,
    pub layer: &'static str,
    pub unit: &'static str,
    pub quantity: Quantity,
    pub publish: bool,
    pub owners: &'static [&'static str],
}
pub struct Inputs<'a> {
    pub selection: &'a Selection,
    pub systems: &'a [System],
    pub confluences: &'a [Confluence],
    pub sources: &'a [Source],
    // hpc-exempt: completed field channel names, never cell values.
    pub inherited: &'a BTreeSet<String>,
}
impl Inputs<'_> {
    pub fn enabled(&self, id: &str) -> bool {
        self.selection.get(id).is_some_and(|choice| choice.enabled)
    }
    // hpc-exempt: named entity metadata selects published channels, never terrain-cell state.
    pub fn bindings(&self, entities: &BTreeMap<atlas_map::Id, Entity>) -> Vec<Binding> {
        let mut bindings = channels::physical()
            .into_iter()
            .map(|channel| {
                let publish = channel.selected(&|id| self.enabled(id));
                Binding {
                    channel: channel.name,
                    layer: channel.layer,
                    unit: channel.unit,
                    quantity: channel.quantity,
                    publish,
                    owners: channel.owners,
                }
            })
            .collect::<Vec<_>>();
        derived(self, &mut bindings);
        magic::bindings(self, &mut bindings);
        for entity in entities.values() {
            let layer = match entity.kind.as_str() {
                "culture" => "cultures",
                "language" => "languages",
                "religion" => "religions",
                _ => continue,
            };
            bindings.push(binding(
                format!("{}:{}", entity.kind, entity.id),
                "ratio",
                layer,
                self.enabled("human.cultures"),
                &["human.cultures"],
            ));
            if entity.kind == "language" {
                bindings.push(binding(
                    format!("languageUse:{}", entity.id),
                    "ratio",
                    layer,
                    self.enabled("human.cultures"),
                    &["human.cultures"],
                ));
            }
        }
        let humans = ["human.cultures", "human.politics", "built.layout"]
            .iter()
            .any(|id| self.enabled(id));
        if humans {
            // Society can change environmental products inherited from completed geography.
            for binding in &mut bindings {
                binding.publish |= self.inherited.contains(&binding.channel);
            }
        }
        for channel in ["populationDensity", "populationCapacity"] {
            bindings.push(binding(
                channel,
                "people/square-kilometre",
                "population",
                humans,
                &["human.cultures", "human.politics", "built.layout"],
            ));
        }
        bindings
    }
}
fn binding(
    channel: impl Into<String>,
    unit: &'static str,
    layer: &'static str,
    publish: bool,
    owners: &'static [&'static str],
) -> Binding {
    Binding {
        channel: channel.into(),
        unit,
        layer,
        publish,
        owners,
        quantity: if unit == "category" {
            Quantity::Category
        } else {
            Quantity::Intensive
        },
    }
}
fn derived(input: &Inputs<'_>, into: &mut Vec<Binding>) {
    let owners = |ids: &[&str]| ids.iter().any(|id| input.enabled(id));
    for (name, unit, layer, declared) in [
        (
            "EffectiveSeaLevel",
            "native-length",
            "rivers",
            &["physical.foundation"][..],
        ),
        (
            "BaseSeaLevel",
            "native-length",
            "climate",
            &["physical.foundation"][..],
        ),
        (
            "Precipitation",
            "millimetre/year",
            "climate",
            &["physical.climate"][..],
        ),
        (
            "TotalErosion",
            "native-length",
            "geology",
            &[
                "physical.river-incision",
                "physical.glacial-sculpting",
                "physical.coastal-evolution",
            ][..],
        ),
        (
            "CarbonateFraction",
            "ratio",
            "geology",
            &["physical.foundation"][..],
        ),
        (
            "PhysicalMaterial",
            "category",
            "geology",
            &["physical.landforms"][..],
        ),
        (
            "SurfaceMaterial",
            "category",
            "geology",
            &["physical.foundation"][..],
        ),
        (
            "NaturalTemperature",
            "native-temperature",
            "climate",
            &["physical.climate"][..],
        ),
        (
            "NaturalRockResistance",
            "rock-strength",
            "geology",
            &["physical.foundation"][..],
        ),
    ] {
        into.push(binding(name, unit, layer, owners(declared), declared));
    }
    for name in ["naturalSurface", "finalSurface", "secondSurface"] {
        into.push(binding(
            name,
            "category",
            "geology",
            owners(&["physical.landforms", "magic.configured"]),
            &["physical.landforms", "magic.configured"],
        ));
    }
    for (name, unit) in [
        ("Heat", "celsius"),
        ("StoredHeat", "celsius"),
        ("CoastalPressure", "ratio"),
    ] {
        into.push(binding(
            name,
            unit,
            "magic",
            input.enabled("magic.local"),
            &["magic.local"],
        ));
    }
}
