#![cfg(not(target_arch = "wasm32"))]
//! A settlement plan keeps out of the map's drawn water at its real width: a channel's full
//! width at every vertex and a pool's outline are water on the plan's grid.
use atlas_generation::{
    atlas::town::{
        ground::{Ground, WATER},
        site::{town_centre, water_shapes},
    },
    features::Feature,
};
use atlas_gis::geometry::NativeGeos;
use serde_json::json;

fn feature(
    layer: &str,
    kind: &str,
    geometry: serde_json::Value,
    attributes: serde_json::Value,
) -> Feature {
    serde_json::from_value(
        json!({"id":format!("{layer}-{kind}"),"placeId":kind,"areaId":"map",
        "layerId":layer,"kind":kind,"name":kind,"attributes":attributes,"relations":[],"detail":{},
        "state":"generated","protected":false,"actor":"generator","generationId":"test","causes":[],
        "geometry":geometry}),
    )
    .unwrap()
}

#[test]
fn a_drawn_river_is_water_across_its_full_width_and_a_pool_by_its_outline() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let river = feature(
        "rivers",
        "river",
        json!({"type":"LineString","coordinates":[[0,50],[100,50]]}),
        json!({"widths":[20.0, 20.0]}),
    );
    let pool = feature(
        "lakes",
        "pool",
        json!({"type":"Polygon","coordinates":[[[40,80],[60,80],[60,90],[40,90],[40,80]]]}),
        json!({}),
    );
    let shapes = water_shapes(&[river, pool], &spatial).unwrap();
    let mut ground = Ground::new([0.0, 0.0, 100.0, 100.0], 1.0);
    ground.mark_shapes(&shapes, WATER, &spatial).unwrap();
    assert!(ground.is_water([30.0, 58.5]), "within the river's 20 m");
    assert!(ground.is_water([30.0, 41.5]));
    assert!(!ground.is_water([30.0, 61.5]), "beyond its bank");
    assert!(ground.is_water([50.5, 85.5]), "in the pool");
    assert!(!ground.is_water([50.5, 75.5]));
}

#[test]
fn a_captured_seat_in_water_uses_the_nearest_habitable_bank() {
    use atlas_generation::atlas::town::ground::STEEP;
    let spatial = NativeGeos::new(1e-9).unwrap();
    let mut ground = Ground::new([0.0, 0.0, 200.0, 200.0], 1.0);
    for cell in 0..ground.count() {
        let [x, y] = ground.centre(cell);
        if (90.0..110.0).contains(&x) {
            ground.withhold(cell, WATER);
        } else if x < 90.0 && y < 120.0 {
            ground.withhold(cell, STEEP);
        }
    }
    let candidates = [
        [80.0, 100.0],
        [100.0, 140.0],
        [115.0, 100.0],
        [140.0, 100.0],
    ];
    assert_eq!(
        town_centre([100.0, 100.0], &candidates, &ground, &spatial).unwrap(),
        [115.0, 100.0]
    );
    assert_eq!(
        town_centre([140.0, 150.0], &candidates, &ground, &spatial).unwrap(),
        [140.0, 150.0]
    );
}
