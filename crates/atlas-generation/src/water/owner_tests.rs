use super::{
    column::{CapturedColumn, WaterMedium, NO_WATER_SURFACE},
    network_tests::fixture,
    owner_network::NetworkEnvironment,
    Water,
};
use crate::{
    scale::MapScale,
    storage::{Band, Coverage, ReadBand},
};
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
fn environment<'a>(
    zero: &'a ReadBand<f64>,
    one: &'a ReadBand<f64>,
    supply: &'a ReadBand<f64>,
) -> NetworkEnvironment<'a> {
    NetworkEnvironment {
        surface_water: supply,
        bed: &|_| Ok(0.0),
        cut_share: zero,
        permeability: &|_, _| Ok(0.0),
        groundwater_filled: &|_| Ok(0.0),
        open_bed_seepage: 0.0,
        withdrawal: zero.clone(),
        transmission: one.clone(),
        lake_evaporation: 0.0,
        lake_seepage: 0.0,
        lake_infiltration_loss: 0.0,
        epoch: 1.0,
    }
}
fn column(water: &mut Water, cell: usize, kind: u8) {
    water
        .inherit_column(
            cell,
            CapturedColumn {
                snow: 0.0,
                soil: 0.0,
                ground: 0.0,
                standing: 0.0,
                surface: NO_WATER_SURFACE,
                kind,
                body: i32::from(kind != 0),
            },
            [0.0; 14],
        )
        .unwrap();
}
fn prepared() -> (Water, Coverage, Band<f64>, [usize; 3]) {
    let (mesh, mut coverage, cells) = fixture();
    let elevation = coverage.allocate(0.0);
    let scale = MapScale::new(100.0, 100.0, mesh.cell_span()).unwrap();
    let water = Water::new(
        mesh,
        scale,
        &mut coverage,
        WaterMedium {
            elevation: elevation.read_only(),
            soil_capacity: Rc::new(|_| Ok(1.0)),
            groundwater_capacity: Rc::new(|_| Ok(1.0)),
        },
    );
    (water, coverage, elevation, cells)
}
#[test]
fn assembled_owner_refreshes_the_same_network_without_establishing_rivers_on_read() {
    let (mut water, mut coverage, _elevation, [a, b, c]) = prepared();
    for cell in 0..coverage.len() {
        column(&mut water, cell, 1);
    }
    column(&mut water, a, 0);
    column(&mut water, b, 0);
    water.drainage.guidance.set(a, b as i32).unwrap();
    water.drainage.guidance.set(b, c as i32).unwrap();
    water.route(1, false, &mut coverage).unwrap();
    let zero = coverage.allocate(0.0);
    let one = coverage.allocate(1.0);
    let supply = coverage.allocate(1000.0);
    water
        .refresh_network(
            environment(&zero.read_only(), &one.read_only(), &supply.read_only()),
            &mut coverage,
        )
        .unwrap();
    assert_eq!(water.rivers().reaches().count(), 0);
    assert!(water.read_only().flow.mean.get(b).unwrap() > 0.0);
    let id = water.rivers.add(vec![a, b]);
    water.rivers.get_mut(id).unwrap().river = Some("captured".into());
    water
        .refresh_network(
            environment(&zero.read_only(), &one.read_only(), &supply.read_only()),
            &mut coverage,
        )
        .unwrap();
    assert_eq!(water.rivers().reaches().count(), 1);
    assert_eq!(water.rivers().get(id).unwrap().cells(), [a, b]);
    assert!(water.river_reader().water_at(b, false, 0.0) > 0.0);
    assert_ne!(water.projection.spines().get(a).unwrap(), 0);
    assert_eq!(
        water.capture_network().reaches[0].river.as_deref(),
        Some("captured")
    );
}
