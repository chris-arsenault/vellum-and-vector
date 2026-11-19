//! Structure maps: a building's levels on its own real-scale map (ADR 0016).
//!
//! A structure map opens from a building on a real-scale ground map. Each level (ground
//! floor, upper floors, cellars) is one located space with its own structures, objects and
//! hex layers, so a cellar's walls and the floor above never mix. The ground floor is the
//! map's primary space and keeps the plain layer ids; other levels carry `@<number>` on
//! their layer ids. Interiors are drawn by hand; the map also reads its outside context
//! (magic prevalence, nearby features and the place record) from the parent's published GIS.
mod connections;
mod context;
mod shell;
mod vocabulary;

pub use connections::{
    candidates, is_connection, lands, reaches, ConnectionCandidate, ConnectionTarget, CONNECTS_TO,
    LEADS_TO,
};
pub use vocabulary::{vocabulary, VOCABULARY};

/// What a creator calls a level (`structure.json`).
pub fn level_name(number: i32) -> String {
    vocabulary().levels.name(number)
}
pub use context::{site_context, MagicShare, NearbyFeature, PlaceRecord, SiteContext};
pub use shell::{frontage, shell, shell_levels, HexChoice, Shell, ShellRequest};

use crate::{
    hexes::{fill, Hex},
    Geometry, MapDescriptor, MapFeature, MapFeatureCatalog, MapFrame, MapLayer, MapSpace,
    RealScaleKind,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use ts_rs::TS;

/// The building on the parent map whose floors a structure map holds, as it stood when its
/// floors were opened. The parent's live record is read again for the place panel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructureSite {
    pub building_id: crate::Id,
    pub name: Option<String>,
    #[serde(rename = "use")]
    pub use_: Option<String>,
    pub address: Option<String>,
}

/// Floor name prefix of a level's located space: `level:-1` is the first cellar.
pub const LEVEL_FLOOR: &str = "level:";
/// The layers every level holds, copied from the ground floor's.
pub const LEVEL_LAYERS: [&str; 3] = ["vector:structures", "vector:objects", "vector:hexes"];

pub fn is_structure(map: &MapDescriptor) -> bool {
    map.real_scale
        .as_ref()
        .is_some_and(|real| real.kind == RealScaleKind::Structure)
}
/// A level's number: 0 for the ground floor (the primary space), negative below ground.
pub fn level_of(map: &MapDescriptor, space: &MapSpace) -> Option<i32> {
    if space.id == map.primary_space_id {
        return Some(0);
    }
    space
        .frame
        .floor
        .as_deref()?
        .strip_prefix(LEVEL_FLOOR)?
        .parse()
        .ok()
}
/// The map's levels as (number, space id), lowest first.
pub fn levels(map: &MapDescriptor) -> Vec<(i32, crate::Id)> {
    if !is_structure(map) {
        return Vec::new();
    }
    let mut levels: Vec<_> = map
        .spaces
        .iter()
        .filter_map(|space| Some((level_of(map, space)?, space.id)))
        .collect();
    levels.sort();
    levels
}
/// A level's space: the ground floor is the primary space, each other level its own.
pub fn level_space_id(primary: crate::Id, number: i32) -> crate::Id {
    if number == 0 {
        primary
    } else {
        crate::Id::v5(primary, &number.to_be_bytes())
    }
}
/// The id a ground-floor layer takes on another level.
pub fn level_layer_id(base: &str, number: i32) -> String {
    if number == 0 {
        base.into()
    } else {
        format!("{base}@{number}")
    }
}
/// A level's space and layers, laid over the map's frame like the ground floor. `layers`
/// are the ground floor's definitions to copy; counts start at nothing.
pub fn level_layout(
    map: &MapDescriptor,
    layers: &[MapLayer],
    number: i32,
) -> Result<(MapSpace, Vec<MapLayer>), String> {
    let primary = map
        .spaces
        .iter()
        .find(|space| space.id == map.primary_space_id)
        .ok_or("The map has no primary space")?;
    let space = MapSpace {
        id: level_space_id(primary.id, number),
        parent_space_id: (number != 0)
            .then_some(primary.id)
            .or(primary.parent_space_id),
        bounds: if number == 0 {
            primary.bounds
        } else {
            map.bounds
        },
        metres_per_unit: primary.metres_per_unit,
        precision: primary.precision,
        periodic_width: if number == 0 {
            primary.periodic_width
        } else {
            None
        },
        frame: MapFrame {
            origin: primary.frame.origin,
            rotation: primary.frame.rotation,
            floor: if number == 0 {
                primary.frame.floor.clone()
            } else {
                Some(format!("{LEVEL_FLOOR}{number}"))
            },
        },
    };
    let copies = LEVEL_LAYERS
        .iter()
        .map(|base| {
            let source = layers
                .iter()
                .find(|layer| layer.id == *base)
                .ok_or_else(|| format!("The map publishes no {base} layer to copy"))?;
            let mut layer = source.clone();
            layer.id = level_layer_id(base, number);
            // Each level's layers read as that level's in layer lists ("Structures · Cellar").
            let plain = source.name.split(" · ").next().unwrap_or(&source.name);
            layer.name = format!("{plain} · {}", crate::authoring::level_name(number));
            layer.space_id.clone_from(&space.id);
            layer.bounds = map.bounds;
            for kind in &mut layer.catalog.feature_types {
                kind.count = 0;
            }
            Ok(layer)
        })
        .collect::<Result<_, String>>()?;
    Ok((space, copies))
}
/// The hexes of one level over the map's frame, unmarked; marks follow from its shapes.
pub fn level_hexes(map: &MapDescriptor, layer: &MapLayer) -> Result<Vec<MapFeature>, String> {
    let real = map
        .real_scale
        .as_ref()
        .ok_or("Hexes belong to real-scale maps")?;
    let grid = real.grid()?;
    let kind = layer
        .catalog
        .feature_types
        .iter()
        .find(|kind| kind.kind == "hex")
        .ok_or("The hex layer has no hex kind")?;
    Ok(grid
        .covering(map.bounds)
        .into_iter()
        .map(|hex| hex_feature(&grid.polygon(hex), hex, layer, &kind.id))
        .collect())
}
fn hex_feature(geometry: &Geometry, hex: Hex, layer: &MapLayer, type_id: &str) -> MapFeature {
    let attributes = BTreeMap::from([
        ("q".into(), hex.q.into()),
        ("r".into(), hex.r.into()),
        ("fill".into(), Value::Null),
        ("marks".into(), json!({})),
        ("ground".into(), Value::Null),
        ("nameStatus".into(), "label".into()),
    ]);
    MapFeature {
        id: hex.id(crate::Id::from_name(&layer.id)),
        space_id: layer.space_id.clone(),
        entity_id: None,
        layer_id: layer.id.clone(),
        name: Some(format!("Hex {}, {}", hex.q, hex.r)),
        kind: "hex".into(),
        type_id: type_id.into(),
        catalog: MapFeatureCatalog {
            values: BTreeMap::new(),
            origin: "Generated".into(),
            map_only: false,
        },
        geometry: geometry.clone(),
        footprint: None,
        attributes,
        relations: Vec::new(),
        causes: Vec::new(),
    }
}
/// Write computed marks onto hexes, as the hex layer publishes them.
pub fn set_marks(hex: &mut MapFeature, marks: &BTreeMap<String, f64>) {
    let main = fill(marks).map_or(Value::Null, Into::into);
    hex.attributes.insert("fill".into(), main);
    hex.attributes.insert("marks".into(), json!(marks));
}

pub fn declarations(cfg: &ts_rs::Config) -> Vec<String> {
    vec![
        StructureSite::decl(cfg),
        ConnectionTarget::decl(cfg),
        ConnectionCandidate::decl(cfg),
        SiteContext::decl(cfg),
        MagicShare::decl(cfg),
        NearbyFeature::decl(cfg),
        PlaceRecord::decl(cfg),
    ]
}

#[cfg(test)]
mod tests;
