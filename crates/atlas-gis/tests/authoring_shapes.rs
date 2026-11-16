#![cfg(not(target_arch = "wasm32"))]
//! The pure shape rules of authoring on explicit inputs, through the GEOS kernel.
use atlas_gis::geometry::NativeGeos;
use atlas_map::{
    authoring::{carry_widths, follow, widths_at},
    Geometry, MapFeature, Position,
};
use serde_json::json;

fn line(points: &[[f64; 2]]) -> Geometry {
    Geometry::LineString {
        coordinates: points.iter().map(|&[x, y]| Position::xy(x, y)).collect(),
    }
}
fn close(a: &[f64], b: &[f64]) {
    assert_eq!(a.len(), b.len());
    for (x, y) in a.iter().zip(b) {
        assert!((x - y).abs() < 1e-9, "{a:?} != {b:?}");
    }
}

#[test]
fn widths_carry_by_index_through_a_drag_and_interpolate_at_inserted_points() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let before = line(&[[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]);
    let dragged = line(&[[0.0, 0.0], [10.0, 6.0], [20.0, 0.0]]);
    let widths = [1.0, 2.0, 4.0];
    close(
        &carry_widths(&before, &widths, &dragged, &spatial).unwrap(),
        &widths,
    );
    let inserted = line(&[
        [0.0, 0.0],
        [5.0, 0.0],
        [10.0, 0.0],
        [15.0, 0.0],
        [20.0, 0.0],
    ]);
    close(
        &carry_widths(&before, &widths, &inserted, &spatial).unwrap(),
        &[1.0, 1.5, 2.0, 3.0, 4.0],
    );
    let removed = line(&[[0.0, 0.0], [20.0, 0.0]]);
    close(
        &carry_widths(&before, &widths, &removed, &spatial).unwrap(),
        &[1.0, 4.0],
    );
    assert!(carry_widths(&before, &[1.0], &dragged, &spatial).is_err());
}

#[test]
fn a_width_profile_reads_onto_another_line_by_fraction() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let source = line(&[[0.0, 0.0], [10.0, 0.0]]);
    let target = line(&[[0.0, 5.0], [2.0, 5.0], [4.0, 5.0]]);
    close(
        &widths_at(&source, &[1.0, 3.0], &target, &spatial).unwrap(),
        &[1.0, 2.0, 3.0],
    );
}

fn bridge(geometry: Geometry) -> MapFeature {
    serde_json::from_value(json!({"id":"bridge","name":"Bridge","spaceId":"surface",
        "layerId":"vector:structures","typeId":"bridge","kind":"bridge","entityId":null,
        "geometry":geometry,"footprint":null,"attributes":{"rotation":0},
        "relations":[{"targetId":"way","targetName":"Way","kind":"carries"},
            {"targetId":"water","targetName":"Water","kind":"spans"}],
        "causes":[],"catalog":{"values":{},"columns":[],"origin":"Authored","mapOnly":false}}))
    .unwrap()
}
fn centre(feature: &MapFeature) -> [f64; 2] {
    let Geometry::Polygon { coordinates } = &feature.geometry else {
        panic!("a bridge is an outline")
    };
    let ring = &coordinates[0][..coordinates[0].len() - 1];
    let sum = ring.iter().fold([0.0, 0.0], |[x, y], p| {
        let [px, py, _] = p.coordinates();
        [x + px, y + py]
    });
    [sum[0] / ring.len() as f64, sum[1] / ring.len() as f64]
}
fn deck() -> Geometry {
    serde_json::from_value(
        json!({"type":"Polygon","coordinates":[[[-1,-0.5],[1,-0.5],[1,0.5],[-1,0.5],[-1,-0.5]]]}),
    )
    .unwrap()
}

#[test]
fn a_bridge_turns_with_the_way_it_carries_and_records_its_rotation() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let water = line(&[[0.0, -5.0], [0.0, 5.0]]);
    let old_way = line(&[[-5.0, 0.0], [5.0, 0.0]]);
    let new_way = line(&[[-5.0, -5.0], [5.0, 5.0]]);
    let moved = follow(
        &bridge(deck()),
        "way",
        &old_way,
        &new_way,
        Some(&water),
        &spatial,
    )
    .unwrap()
    .unwrap();
    let [x, y] = centre(&moved);
    assert!(
        x.abs() < 1e-9 && y.abs() < 1e-9,
        "it stays where way and water meet"
    );
    assert_eq!(moved.attributes["rotation"], json!(45.0));
}

#[test]
fn a_bridge_follows_its_water_to_the_way_without_turning() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let way = line(&[[-5.0, 0.0], [5.0, 0.0]]);
    let old_water = line(&[[0.0, -5.0], [0.0, 5.0]]);
    let new_water = line(&[[2.0, -5.0], [2.0, 5.0]]);
    let moved = follow(
        &bridge(deck()),
        "water",
        &old_water,
        &new_water,
        Some(&way),
        &spatial,
    )
    .unwrap()
    .unwrap();
    let [x, y] = centre(&moved);
    assert!((x - 2.0).abs() < 1e-9 && y.abs() < 1e-9);
    assert_eq!(moved.attributes["rotation"], json!(0));
}
