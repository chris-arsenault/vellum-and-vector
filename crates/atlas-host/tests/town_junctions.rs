#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::atlas::town::{
    ground::Ground,
    growth::{connect, constrain, line},
    lanes::Network,
    network::{Class, Street},
    story::Size,
};
use atlas_gis::geometry::NativeGeos;
use atlas_map::{spatial::SpatialKernel, Geometry};

fn network(lines: &[&[[f64; 2]]]) -> Network {
    let mut ground = Ground::new([-200.0, -200.0, 200.0, 200.0], 2.0);
    let mut network = Network::default();
    for points in lines {
        network.add(
            Street::new(points.to_vec(), Class::Street, Size::Town),
            &mut ground,
        );
    }
    network
}

#[test]
fn crossing_stops_on_the_destination_centreline() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let roads = network(&[
        &[[-100.0, 0.0], [100.0, 0.0]],
        &[[-100.0, 80.0], [100.0, 80.0]],
    ]);
    let connection = constrain(&[[0.0, 0.0], [0.0, 120.0]], &roads, 80.0, &spatial).unwrap();
    assert_eq!(connection, Some(([0.0, 80.0], true)));
}

#[test]
fn oblique_junctions_share_a_vertex_and_keep_widths_aligned() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut roads = network(&[&[[0.0, 0.0], [100.0, 13.0]]]);
    let point = [37.123, 4.826];
    connect(point, &mut roads, &spatial).unwrap();
    assert_eq!(roads.streets[0].points, [[0.0, 0.0], point, [100.0, 13.0]]);
    assert_eq!(roads.streets[0].widths, [6.0, 6.0, 6.0]);
    connect(point, &mut roads, &spatial).unwrap();
    assert_eq!(roads.streets[0].points.len(), 3);
}

#[test]
fn nearby_endpoint_is_extended_into_a_real_junction() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut roads = network(&[
        &[[0.0, 0.0], [100.0, 0.0]],
        &[[100.0, 0.0], [100.0, 100.0]],
        &[[100.0, 100.0], [0.0, 100.0]],
    ]);
    let (end, joined) = constrain(&[[0.0, 0.0], [0.0, 80.0]], &roads, 80.0, &spatial)
        .unwrap()
        .unwrap();
    assert_eq!(end, [0.0, 100.0]);
    assert!(joined);
    roads.streets.push(Street::new(
        vec![[0.0, 0.0], end],
        Class::Street,
        Size::Town,
    ));
    let lines = Geometry::GeometryCollection {
        geometries: roads.streets.iter().map(|s| line(&s.points)).collect(),
    };
    let noded = spatial.node_lines(&lines).unwrap().unwrap();
    let blocks = spatial.polygonize(&noded).unwrap();
    assert_eq!(blocks.len(), 1, "the joined streets enclose a block");
    assert_eq!(spatial.area(&blocks[0]).unwrap(), 10_000.0);
}

#[test]
fn close_parallel_departure_is_rejected() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let roads = network(&[&[[0.0, 0.0], [150.0, 0.0]]]);
    assert!(
        constrain(&[[0.0, 0.0], [80.0, 0.0]], &roads, 80.0, &spatial)
            .unwrap()
            .is_none()
    );
    assert!(
        constrain(&[[0.0, 0.0], [80.0, 5.0]], &roads, 80.0, &spatial)
            .unwrap()
            .is_none()
    );
}
