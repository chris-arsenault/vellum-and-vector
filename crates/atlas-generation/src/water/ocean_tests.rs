use super::{
    column::{StandingKind, Store, WaterColumn, WaterMedium},
    network_tests::fixture,
    ocean::{enclosed_water_depth, OceanDatum, OceanInputs},
    ocean_components::visit_connected,
};
use crate::scale::MapScale;
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn ocean_connectivity_does_not_drown_an_isolated_depression() {
    let (mesh, mut coverage, [_, basin, _]) = fixture();
    let mut elevation = coverage.allocate(10.0);
    elevation.set(basin, -10.0).unwrap();
    let boundary = (0..mesh.len()).find(|&cell| mesh.boundary(cell)).unwrap();
    elevation.set(boundary, -10.0).unwrap();
    let mut reached = vec![false; mesh.len()];
    visit_connected(&mesh, &elevation.read_only(), 0.0, &mut coverage, |cell| {
        reached[cell] = true;
        Ok(())
    })
    .unwrap();
    assert!(reached[boundary]);
    assert!(!reached[basin]);
}
#[test]
fn inherited_datum_preserves_trapped_water_until_lake_stage_but_exposes_retreating_shores() {
    let (mesh, mut coverage, [_, basin, _]) = fixture();
    let mut elevation = coverage.allocate(10.0 * 1024.0);
    elevation.set(basin, -10.0 * 1024.0).unwrap();
    let mut water = WaterColumn::new(
        &mut coverage,
        WaterMedium {
            elevation: elevation.read_only(),
            soil_capacity: Rc::new(|_| Ok(0.0)),
            groundwater_capacity: Rc::new(|_| Ok(0.0)),
        },
    );
    water.stand(basin, StandingKind::Sea, 0.0, Some(1)).unwrap();
    let ice = coverage.allocate(0.0);
    let grounded = coverage.allocate(0u8);
    let scale = MapScale::new(100.0, 100.0, mesh.cell_span()).unwrap();
    let mut datum = OceanDatum {
        base_level: 0.0,
        initialized: true,
        ..Default::default()
    };
    datum
        .surface(
            &OceanInputs {
                mesh: &mesh,
                elevation: &elevation.read_only(),
                scale: &scale,
                grounded_ice: &grounded.read_only(),
                ice_thickness: &ice.read_only(),
            },
            0.0,
            &mut water,
            &|_, level| Ok(level),
            &mut coverage,
        )
        .unwrap();
    assert_eq!(datum.base_level, 0.0);
    assert_eq!(water.read_only().kind.get(basin).unwrap(), 2);
    assert_eq!(
        water
            .read_only()
            .store(Store::Standing)
            .held(basin)
            .unwrap(),
        10.0
    );
    assert_eq!(
        enclosed_water_depth(10.0, 20.0, 15.0, 12.0, false, true),
        0.0
    );
    assert_eq!(
        enclosed_water_depth(10.0, 20.0, 15.0, 12.0, false, false),
        5.0
    );
}
