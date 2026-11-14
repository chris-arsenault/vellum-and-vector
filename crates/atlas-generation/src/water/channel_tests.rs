use super::{
    channel_geometry::{channel_dimensions, ChannelGeometry, ChannelInputs, ChannelSettings},
    network::{RiverProjection, RiverTerrain},
    network_tests::fixture,
    reaches::ReachStore,
    warmth::{RiverWarmth, WarmthInputs},
};
use crate::scale::MapScale;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
#[test]
fn channel_profiles_follow_the_reachs_own_flow_and_shoaling_changes_the_kept_depth() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let kind = coverage.allocate(0u8);
    let mut targets = coverage.allocate(-1i32);
    targets.set(a, b as i32).unwrap();
    targets.set(b, c as i32).unwrap();
    let flow = coverage.allocate(100.0);
    let basins = coverage.allocate(1i32);
    let elevation = coverage.allocate(0.0);
    let slope = coverage.allocate(0.001);
    let mut rivers = ReachStore::default();
    let id = rivers.add(vec![a, b]);
    let reach = rivers.get_mut(id).unwrap();
    reach.monthly.fill(2.0);
    reach.drawn = true;
    let mut projection = RiverProjection::new(&mut coverage);
    let terrain = RiverTerrain {
        mesh: &mesh,
        water_kind: &kind.read_only(),
        targets: &targets.read_only(),
    };
    projection
        .project(&rivers, &terrain, &flow.read_only())
        .unwrap();
    projection.project_spines(&terrain).unwrap();
    let settings = ChannelSettings {
        maximum_bank_relief: 10.0,
        maximum_longitudinal_alignment: 500.0,
        plain_slope_threshold: 0.001,
        width_decay: 100.0,
        widening_order: 2.0,
        widening_discharge_multiplier: 100.0,
        accumulation_threshold: 1.0,
        base_strength: 100.0,
        order_strength: 10.0,
        discharge_strength: 1.0,
    };
    let scale = MapScale::new(100.0, 100.0, mesh.cell_span()).unwrap();
    let mut channels = ChannelGeometry::new(&mut coverage);
    channels
        .project(
            ChannelInputs {
                mesh: &mesh,
                scale: &scale,
                settings: &settings,
                targets: &targets.read_only(),
                orders: &projection.orders(),
                kind: &kind.read_only(),
                basins: &basins.read_only(),
                elevation: &elevation.read_only(),
                slope: &slope.read_only(),
                flow: &flow.read_only(),
                standing: &|_| Ok(1.0),
            },
            &mut rivers,
            &mut projection,
            &mut coverage,
        )
        .unwrap();
    let expected = channel_dimensions(2.0, 0.001, 1.0, &scale).unwrap();
    assert!((channels.read_only().width.get(a).unwrap() - expected.width).abs() < 1e-9);
    assert_eq!(
        rivers.get(id).unwrap().width()[0],
        channels.read_only().width.get(a).unwrap()
    );
    channels
        .shoal_bed(&mut rivers, a, expected.depth / 2.0)
        .unwrap();
    assert_eq!(rivers.get(id).unwrap().depth()[0], expected.depth / 2.0);
    assert_eq!(
        channels.read_only().depth.get(a).unwrap(),
        expected.depth / 2.0
    );
    assert_ne!(projection.spines().get(a).unwrap(), 0);
}
#[test]
fn river_warmth_follows_flow_and_stops_before_the_sea() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut targets = coverage.allocate(-1i32);
    targets.set(a, b as i32).unwrap();
    targets.set(b, c as i32).unwrap();
    let mut forcing = coverage.allocate(0.0);
    forcing.set(a, 100.0).unwrap();
    let orders = coverage.allocate(1u32);
    let mut kind = coverage.allocate(0u8);
    kind.set(c, 1).unwrap();
    let scale = MapScale::new(10000.0, 10000.0, mesh.cell_span()).unwrap();
    let mut warmth = RiverWarmth::new(&mut coverage);
    warmth
        .project(
            WarmthInputs {
                mesh: &mesh,
                scale: &scale,
                targets: &targets.read_only(),
                orders: &orders.read_only(),
                kind: &kind.read_only(),
                forcing: &forcing.read_only(),
            },
            &mut coverage,
        )
        .unwrap();
    assert_eq!(warmth.read_only().get(a).unwrap(), 100.0);
    assert!(warmth.read_only().get(b).unwrap() > 1.0);
    assert!(warmth.read_only().get(b).unwrap() < 100.0);
    assert_eq!(warmth.read_only().get(c).unwrap(), 0.0);
}
