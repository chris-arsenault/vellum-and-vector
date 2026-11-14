use super::{
    drainage::Drainage,
    lake_stage::{depth_discharge, solve_stage, Depression, StageInputs},
    network_tests::fixture,
    reaches::ReachStore,
    routing::{FlowRouting, RoutingInputs},
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
#[test]
fn stage_budget_floods_equal_floor_cells_together_and_keeps_partial_basins_closed() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut elevation = coverage.allocate(100.0);
    for cell in [a, b] {
        elevation.set(cell, 0.0).unwrap();
    }
    elevation.set(c, 10.0).unwrap();
    let mut parents = coverage.allocate(-1i32);
    parents.set(a, b as i32).unwrap();
    parents.set(c, b as i32).unwrap();
    let mut water = coverage.allocate(0.0);
    let per_cell = depth_discharge(100.0, mesh.area(a));
    water.set(b, 1.5 * per_cell).unwrap();
    let elevation = elevation.read_only();
    let parents = parents.read_only();
    let input = StageInputs {
        mesh: &mesh,
        elevation: &elevation,
        parents: &parents,
        open_water_loss: &|_| Ok(100.0),
        infiltration_loss: 0.0,
    };
    let depression = || Depression {
        id: 1,
        members: vec![a, b, c],
        spill: 20.0,
    };
    assert!(
        solve_stage(&input, depression(), &water.read_only(), &mut coverage)
            .unwrap()
            .is_none()
    );
    water.set(b, 2.5 * per_cell).unwrap();
    let lake = solve_stage(&input, depression(), &water.read_only(), &mut coverage)
        .unwrap()
        .unwrap();
    assert_eq!(lake.members.len(), 2);
    assert_eq!(lake.surface, 10.0);
    assert_eq!(lake.overflow, 0.0);
    water.set(b, 4.0 * per_cell).unwrap();
    let lake = solve_stage(&input, depression(), &water.read_only(), &mut coverage)
        .unwrap()
        .unwrap();
    assert_eq!(lake.surface, 20.0);
    assert!(lake.overflow > 0.0);
}
#[test]
fn lake_members_route_toward_the_outlet_and_share_its_land_basin() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut kind = coverage.allocate(1u8);
    kind.set(a, 2).unwrap();
    kind.set(b, 2).unwrap();
    let mut bodies = coverage.allocate(1i32);
    bodies.set(a, 2).unwrap();
    bodies.set(b, 2).unwrap();
    let mut outlets = coverage.allocate(-1i32);
    outlets.set(b, c as i32).unwrap();
    let drainage = Drainage::new(&mut coverage);
    let mut routing = FlowRouting::new(&mut coverage);
    routing
        .route(
            RoutingInputs {
                mesh: &mesh,
                water_kind: &kind.read_only(),
                water_body: &bodies.read_only(),
                lake_outlets: &outlets.read_only(),
                drainage: &drainage.read_only(),
                open_outlet: &|_| false,
                seed: 1,
            },
            &ReachStore::default(),
            &mut coverage,
        )
        .unwrap();
    let read = routing.read_only();
    assert_eq!(read.targets.get(a).unwrap(), b as i32);
    assert_eq!(read.targets.get(b).unwrap(), c as i32);
    assert_eq!(read.basins.get(a).unwrap(), read.basins.get(b).unwrap());
    assert!(read.basins.get(a).unwrap() > 0);
    assert!(read.edges.get(a).unwrap() >= 0);
    assert_eq!(read.basins.get(c).unwrap(), 0);
}
