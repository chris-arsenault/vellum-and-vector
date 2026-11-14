use super::{
    column::{Store, WaterColumn, WaterMedium},
    groundwater::{balance, return_rate, returned_charge, Groundwater, GroundwaterInputs},
    ledger::WaterLedger,
    meltwater::{MeltInputs, Meltwater},
    network_tests::fixture,
};
use crate::scale::MapScale;
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-8, "{a} != {b}");
}
#[test]
fn saturated_storage_returns_excess_after_exposure_dependent_drainage() {
    let result = balance(4.0, 1.0, 2.0, 0.5, false, 2.0);
    near(result.outflow, 4.5);
    near(result.storage, 1.5);
    near(result.returned, 0.0);
    let full = balance(4.0, 1.0, 2.0, 0.0, false, 2.0);
    near(full.returned, 4.0);
    near(return_rate(full.returned, 2.0), 2.0);
    near(returned_charge(12.0, 6.0, full.returned), 8.0);
    near(balance(4.0, 10.0, 2.0, 1.0, true, 0.0).storage, 4.0);
}
#[test]
fn groundwater_arrives_after_routing_and_soil_loss_preserves_its_share() {
    let (mesh, mut coverage, [a, b, _]) = fixture();
    let mut elevation = coverage.allocate(0.0);
    elevation.set(a, 1024.0).unwrap();
    let kind = coverage.allocate(0u8);
    let zero = coverage.allocate(0.0);
    let mut water = WaterColumn::new(
        &mut coverage,
        WaterMedium {
            elevation: elevation.read_only(),
            soil_capacity: Rc::new(|_| Ok(1.0)),
            groundwater_capacity: Rc::new(|_| Ok(10.0)),
        },
    );
    water.put_groundwater(a, 1.0).unwrap();
    let mut groundwater = Groundwater::new(&mut coverage);
    let scale = MapScale::new(100.0, 100.0, mesh.cell_span()).unwrap();
    groundwater
        .advance(
            GroundwaterInputs {
                mesh: &mesh,
                scale: &scale,
                water_kind: &kind.read_only(),
                elevation: &elevation.read_only(),
                recharge: &zero.read_only(),
                seepage: &zero.read_only(),
                permeability: &|cell| Ok(if cell == a || cell == b { 1.0 } else { 0.0 }),
                sea_level: 0.0,
                exposure: 1.0,
            },
            &mut water,
            &mut WaterLedger::default(),
            &mut coverage,
        )
        .unwrap();
    let view = groundwater.read_only();
    assert_eq!(view.targets.get(a).unwrap(), b as i32);
    assert!(view.outflow.get(a).unwrap() > 0.0);
    near(view.outflow.get(b).unwrap(), 0.0);
    assert!(water.read_only().store(Store::Ground).held(b).unwrap() > 0.0);
    water.hold_soil(a, 100.0, 0.1, 0.0).unwrap();
    water.lose_soil(a, 0.25).unwrap();
    near(water.read_only().store(Store::Soil).held(a).unwrap(), 0.15);
    groundwater.begin_exchange(0.0).unwrap();
    near(view.outflow.get(a).unwrap(), 0.0);
}
#[test]
fn ice_carries_annual_snow_and_external_heat_changes_the_release_location() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut kind = coverage.allocate(0u8);
    kind.set(c, 1).unwrap();
    let mut ice = coverage.allocate(0.0);
    ice.set(a, 1.0).unwrap();
    ice.set(b, 1.0).unwrap();
    let mut snow = coverage.allocate(0.0);
    snow.set(a, 1000.0).unwrap();
    let temperature = coverage.allocate(-10.0);
    let mut targets = coverage.allocate(-1i32);
    targets.set(a, b as i32).unwrap();
    targets.set(b, c as i32).unwrap();
    let (kind, ice, snow, temperature, targets) = (
        kind.read_only(),
        ice.read_only(),
        snow.read_only(),
        temperature.read_only(),
        targets.read_only(),
    );
    let input = || MeltInputs {
        mesh: &mesh,
        water_kind: &kind,
        ice_thickness: &ice,
        snow_kept: &snow,
        temperature: &temperature,
        targets: &targets,
        temperature_floor: -10.0,
        ice_threshold: 0.0,
    };
    let mut melt = Meltwater::new(&mut coverage);
    let mut ledger = WaterLedger::default();
    melt.release_year(input(), &mut ledger, &mut coverage)
        .unwrap();
    near(melt.read_only().glacial.get(b).unwrap(), 0.0);
    melt.receive(b, 1.0).unwrap();
    melt.release_year(input(), &mut ledger, &mut coverage)
        .unwrap();
    near(melt.read_only().glacial.get(a).unwrap(), 0.0);
    near(
        melt.read_only().glacial.get(b).unwrap(),
        1000.0 * mesh.area(a) / mesh.area(b),
    );
    near(melt.read_only().glacial.get(c).unwrap(), 0.0);
    melt.begin_epoch().unwrap();
    near(melt.read_only().external.get(b).unwrap(), 0.0);
}
