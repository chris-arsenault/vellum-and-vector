//! Supplied material and receiving geometry, without river or world simulation.
use super::{shared::Scalar, tests::seed, Field};
use crate::{
    execution::{CommandKind, Executor},
    processes::{fluvial, marine_sediment},
    rock::{
        cargo::MaterialCargo,
        catalogue,
        columns::Column,
        ground::{deposition::pond_level, observers::GroundObservers, GroundField},
        load::MaterialLoad,
        material::MaterialLayer,
    },
    scale::MapScale,
    settlement::removal::Facet,
    water::column::CapturedColumn,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn supplied_mouth(depth: f64, forcing: Option<Scalar>) -> (Field, MaterialCargo) {
    let mut seed = seed();
    seed.ground.completed_epochs = 9.0;
    seed.ground
        .storage
        .initialize(GroundField::BedrockElevation, 0, MapScale::native(-depth))
        .unwrap();
    if let Some(forcing) = forcing {
        seed.shared.scalar_mut(forcing).set(0, 1000.0).unwrap();
    }
    let id = seed
        .ground
        .identities
        .declare("supplied-charge", None)
        .unwrap();
    let cargo = MaterialCargo::from_entries([(id, catalogue::SANDSTONE as i32, 4.0)]);
    let field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    field
        .water
        .borrow_mut()
        .inherit_column(
            0,
            CapturedColumn {
                snow: 0.0,
                soil: 0.0,
                ground: 0.0,
                standing: MapScale::native(depth),
                surface: 0.0,
                kind: 1,
                body: 1,
            },
            [0.0; 14],
        )
        .unwrap();
    (field, cargo)
}
fn deliver(field: Field, cargo: &MaterialCargo) -> Executor<Field> {
    let material = MaterialLayer {
        secondary_kind: catalogue::SHALE,
        secondary_share: 0.25,
        formed_min: 2.0,
        formed_max: 5.0,
        altered: 7.0,
        grain_x: 600.0,
        grain_y: 800.0,
        cargo: Some(cargo.clone()),
        ..catalogue::material(catalogue::SANDSTONE, 6.0 * field.mesh().area(0), 0.0)
    };
    let delivery = Field::material_command(
        "test.supplied-mouth",
        CommandKind::Work,
        vec![],
        |work, material: &MaterialLayer, _| {
            let mut moving = MaterialLoad::new(work.coverage);
            moving.add(0, material)?;
            fluvial::settle_at_sea(work, 0, &mut moving)?;
            assert_eq!(moving.amount(0)?, 0.0);
            Ok(())
        },
    );
    let mut executor = Executor::new(field);
    executor.run_with(&delivery, &material).unwrap();
    executor
}
#[test]
fn delivered_mouth_material_keeps_constituents_history_and_hosted_cargo() {
    let (field, cargo) = supplied_mouth(20.0, None);
    let executor = deliver(field, &cargo);
    let field = executor.state();
    let ground = field.ground();
    assert!(ground.surface(0, Facet::Land).unwrap() > MapScale::native(-20.0));
    let layer = ground.columns().read_layer(0, Column::Loose, 0).unwrap();
    assert_eq!(layer.kind, catalogue::SANDSTONE);
    assert_eq!(
        (layer.secondary_kind, layer.secondary_share),
        (catalogue::SHALE, 0.25)
    );
    assert_eq!(
        (
            layer.formed_min,
            layer.formed_max,
            layer.altered,
            layer.deposited
        ),
        (2.0, 5.0, 7.0, 9.0)
    );
    assert_eq!(
        (layer.consolidation, layer.grain_x, layer.grain_y),
        (0.0, 600.0, 800.0)
    );
    assert_eq!(layer.cargo.as_ref(), Some(&cargo));
    assert_eq!(field.sea_load.amount(0).unwrap(), 0.0);
}
#[test]
fn excess_mouth_material_stays_at_the_receiving_sea_cell_with_its_cargo() {
    let (field, cargo) = supplied_mouth(2.0, None);
    let executor = deliver(field, &cargo);
    let field = executor.state();
    assert_eq!(field.ground().surface(0, Facet::Land).unwrap(), 0.0);
    assert!(field.sea_load.amount(0).unwrap() > 0.0);
    let rest = field.sea_load.get(0).unwrap();
    assert_eq!(rest.kind, catalogue::SANDSTONE);
    assert_eq!(rest.formed_min, 2.0);
    assert_eq!(rest.cargo.as_ref(), Some(&cargo));
}
#[test]
fn waves_or_currents_carry_delivered_material_offshore() {
    for forcing in [Scalar::WaveExposure, Scalar::OceanCurrentStrength] {
        let (field, cargo) = supplied_mouth(20.0, Some(forcing));
        let executor = deliver(field, &cargo);
        let field = executor.state();
        assert_eq!(
            field.ground().surface(0, Facet::Land).unwrap(),
            MapScale::native(-20.0)
        );
        let rest = field.sea_load.get(0).unwrap();
        assert!(rest.depth > 0.0);
        assert_eq!(rest.kind, catalogue::SANDSTONE);
        assert_eq!(rest.cargo.as_ref(), Some(&cargo));
    }
}
#[test]
fn sediment_operators_respect_local_room_and_transport_distance() {
    assert_eq!(pond_level(100.0, 0.75, 0.0, 0.25, 10.0), 40.0);
    assert_eq!(pond_level(100.0, 0.75, 0.0, 0.25, 50.0), 125.0);
    assert_eq!(fluvial::mouth_keeps(500.0, 200.0), 0.4);
    assert!((fluvial::capture_fraction(760.0, 20.0, 20.0) - 0.76).abs() < 1e-12);
    assert_eq!(marine_sediment::settled_share(0.0, 0.0, 10.0, 0.1), 0.0);
    assert!(
        marine_sediment::settled_share(10.0, 0.0, 10.0, 0.1)
            > marine_sediment::settled_share(10.0, 1.0, 10.0, 0.1)
    );
}
