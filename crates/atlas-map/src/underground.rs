//! A ground map's underground space (ADR 0016): the surface's planar frame one floor down,
//! so a cave and its entrances share coordinates, with its own hex grid. Generation publishes
//! it when it finds caves; authoring opens it when a creator draws the first cave wall.
use crate::{
    GeometryType, LayerCatalog, LayerSource, MapDescriptor, MapFeature, MapFeatureType, MapFrame,
    MapLayer, MapProperty, MapSpace, MapVectorStyle, PropertyType, VectorSource,
};
use std::collections::BTreeMap;

/// The floor name of a ground map's underground space.
pub const UNDERGROUND_FLOOR: &str = "underground";
/// The underground hex grid and the walls a creator draws there.
pub const CAVE_HEXES: &str = "vector:caveHexes";
pub const CAVE_WALLS: &str = "vector:caveWalls";

/// The located space beneath a ground map that holds its caves.
pub fn underground_space(map: &MapDescriptor) -> Option<MapSpace> {
    let surface = map
        .spaces
        .iter()
        .find(|space| space.id == map.primary_space_id)?;
    Some(MapSpace {
        id: crate::Id::v5(surface.id, b"underground"),
        parent_space_id: Some(surface.id),
        bounds: map.bounds,
        metres_per_unit: surface.metres_per_unit,
        precision: surface.precision,
        periodic_width: None,
        frame: MapFrame {
            origin: surface.frame.origin,
            rotation: surface.frame.rotation,
            floor: Some(UNDERGROUND_FLOOR.into()),
        },
    })
}
/// A surface hex's underground twin: the same cell of the grid under its own identity.
/// The cave hex beneath a surface hex.
pub fn cave_hex_id(surface_hex: crate::Id) -> crate::Id {
    crate::Id::v5(surface_hex, b"cave")
}

/// One feature type as publication names it: `[layer, kind, subtype]` and its catalogue path.
pub fn feature_type(layer: &str, kind: &str, label: &str, path: [&str; 2]) -> MapFeatureType {
    MapFeatureType {
        id: serde_json::json!([layer, kind, ""]).to_string(),
        kind: kind.into(),
        label: label.into(),
        path: vec![path[0].into(), path[1].into(), label.into()],
        magic_depiction: None,
        count: 0,
        geometries: Vec::new(),
        footprints: false,
        true_size: None,
    }
}
/// The cave wall kind; publication's catalogue names it the same way (checked there).
pub fn cave_wall_type() -> MapFeatureType {
    feature_type(
        "caveWalls",
        "caveWall",
        "Cave walls",
        ["Caves and underground", "Walls"],
    )
}
pub fn cave_hex_type() -> MapFeatureType {
    feature_type("caveHexes", "hex", "Cave hexes", ["Cave hex grid", "Hexes"])
}
fn layer(
    id: &str,
    name: &str,
    space: &MapSpace,
    kind: MapFeatureType,
    geometry: GeometryType,
    color: &str,
) -> MapLayer {
    MapLayer {
        id: id.into(),
        space_id: space.id.clone(),
        name: name.into(),
        bounds: space.bounds,
        attribution: Vec::new(),
        source: LayerSource::Vector(VectorSource {
            asset_id: format!("authored-{}", id.trim_start_matches("vector:")),
            media_type: "application/geo+json".into(),
        }),
        catalog: LayerCatalog {
            path: vec![name.into()],
            common: true,
            feature_types: vec![kind],
            default_style: Some(MapVectorStyle {
                visible: false,
                opacity: 0.85,
                color: color.into(),
                labels: false,
                min_scale: 0.0,
                types: BTreeMap::new(),
                groups: BTreeMap::new(),
                symbols: None,
                filter: None,
            }),
            presets: vec!["physical".into()],
            properties: ["name", "kind"]
                .map(|key| {
                    (
                        key.to_string(),
                        MapProperty {
                            kind: PropertyType::String,
                        },
                    )
                })
                .into(),
            examples: Vec::new(),
            geometries: vec![geometry],
        },
    }
}

/// The map with its underground space and the layers a drawn cave wall needs, and the cave
/// hexes copied from the surface grid. A map that already has them is returned unchanged.
pub fn opened(
    map: &MapDescriptor,
    surface_hexes: &[MapFeature],
) -> Result<(MapDescriptor, Vec<MapFeature>), String> {
    let mut next = map.clone();
    let space = match map.spaces.iter().find(|space| {
        space.parent_space_id == Some(map.primary_space_id)
            && space.frame.floor.as_deref() == Some(UNDERGROUND_FLOOR)
    }) {
        Some(space) => space.clone(),
        None => {
            let space = underground_space(map).ok_or("This map has no surface space")?;
            next.spaces.push(space.clone());
            space
        }
    };
    // The wall layer as publication described it, when the map names it among its latent
    // layers; a map published without that list gets the same layer built here.
    let latent = map.real_scale.as_ref().and_then(|real| {
        real.authoring
            .latent_layers
            .iter()
            .find(|l| l.id == CAVE_WALLS)
    });
    if let Some(wall) = latent.filter(|_| !next.layers.iter().any(|l| l.id == CAVE_WALLS)) {
        let mut wall = wall.clone();
        wall.space_id.clone_from(&space.id);
        next.layers.push(wall);
    }
    if !next.layers.iter().any(|layer| layer.id == CAVE_WALLS) {
        next.layers.push(layer(
            CAVE_WALLS,
            "Cave walls",
            &space,
            cave_wall_type(),
            GeometryType::LineString,
            "#4a3c30",
        ));
    }
    if next.layers.iter().any(|layer| layer.id == CAVE_HEXES) {
        return Ok((next, Vec::new()));
    }
    next.layers.push(layer(
        CAVE_HEXES,
        "Cave hex grid",
        &space,
        cave_hex_type(),
        GeometryType::Polygon,
        "#5b5b5b",
    ));
    let hexes = surface_hexes
        .iter()
        .map(|hex| {
            let mut cave = hex.clone();
            cave.id = cave_hex_id(hex.id);
            cave.space_id.clone_from(&space.id);
            cave.layer_id = CAVE_HEXES.into();
            cave.type_id = cave_hex_type().id;
            cave.relations.clear();
            for key in ["ground", "cover"] {
                cave.attributes.remove(key);
            }
            cave.attributes
                .insert("marks".into(), serde_json::json!({}));
            cave.attributes
                .insert("fill".into(), serde_json::Value::Null);
            cave
        })
        .collect();
    Ok((next, hexes))
}
