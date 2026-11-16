use super::{
    shared::{CellCode, Scalar},
    Field,
};
use crate::{
    execution::Executor,
    human::{catalogue::LayerId, identity::IdentityLayer, HumanField},
    rock::{
        catalogue,
        ground::{observers::GroundObservers, GroundField},
    },
    transport::{HistoryTransport, TransportShares, TRANSPORT_WEIGHT_SCALE as SCALE},
    water::column::{CapturedColumn, Store, NO_WATER_SURFACE},
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn one_dispatched_move_preserves_quantities_and_complete_owner_packages() {
    let mut seed = super::tests::seed();
    for (field, value) in [
        (Scalar::SoilCarbon, 10.0),
        (Scalar::TreeCover, 0.4),
        (Scalar::MaximumIceThickness, 70.0),
    ] {
        seed.shared.scalar_mut(field).set(0, value).unwrap();
    }
    seed.shared
        .code_mut(CellCode::CrustPlateIds)
        .set(0, 17)
        .unwrap();
    seed.shared
        .code_mut(CellCode::BiomeCodes)
        .set(0, 8)
        .unwrap();
    seed.shared
        .code_mut(CellCode::FeatureFlags)
        .set(0, (1 << 8) | 2)
        .unwrap();
    seed.people
        .initialize(HumanField::Layer(LayerId::Population), 0, 40.0)
        .unwrap();
    seed.people.initialize(HumanField::Tenure, 0, 12.0).unwrap();
    seed.people
        .initialize_column(
            0,
            &[IdentityLayer {
                people: 40.0,
                hardness: 0.7,
                age: 30.0,
                traditions: [3, 4, 5, 6, 7],
            }],
        )
        .unwrap();
    seed.ground_load
        .add(0, &catalogue::material(catalogue::BASALT, 4.0, 7.0))
        .unwrap();
    seed.ground
        .storage
        .initialize(GroundField::SoilDepth, 0, 2.0)
        .unwrap();
    let mut field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    field
        .water
        .borrow_mut()
        .inherit_column(
            0,
            CapturedColumn {
                snow: 0.5,
                soil: 0.1,
                ground: 0.2,
                standing: 0.0,
                surface: NO_WATER_SURFACE,
                kind: 0,
                body: 0,
            },
            [3.0; 14],
        )
        .unwrap();
    let count = field.mesh.len();
    let ratio = field.mesh.area(0) / field.mesh.area(1);
    let coverage = field.coverage.get_mut();
    let mut offsets = coverage.scratch(count + 1, 0u32);
    let mut targets = coverage.scratch(count, -1i32);
    let weights = coverage.scratch(count, SCALE);
    let mut arrivals = coverage.scratch(count, 0.0);
    let mut dominant = coverage.scratch(count, -1i32);
    let inflow = coverage.scratch(count, 0.0);
    for source in 0..count {
        let target = match source {
            0 => 1,
            1 => 0,
            _ => source,
        };
        offsets.set(source, source as u32).unwrap();
        targets.set(source, target as i32).unwrap();
        dominant.set(target, source as i32).unwrap();
        arrivals
            .set(
                target,
                SCALE * field.mesh.area(source) / field.mesh.area(target),
            )
            .unwrap();
    }
    offsets.set(count, count as u32).unwrap();
    let plan = HistoryTransport {
        shares: TransportShares {
            offsets: offsets.read_only(),
            targets: targets.read_only(),
            weights: weights.read_only(),
            dominant: dominant.read_only(),
            inflow: inflow.read_only(),
        },
        arrivals: arrivals.read_only(),
    };
    let command = Field::transport_history(Field::carriers().unwrap());
    let mut run = Executor::new(field);
    run.run_with(&command, &plan).unwrap();
    let field = run.state();
    assert_shared_arrival(field, ratio);
    assert_owner_arrival(field, ratio);
}
fn assert_shared_arrival(field: &Field, ratio: f64) {
    assert_eq!(
        field.shared.scalar(Scalar::SoilCarbon).get(1).unwrap(),
        10.0 * ratio
    );
    assert_eq!(field.shared.scalar(Scalar::TreeCover).get(1).unwrap(), 0.4);
    assert_eq!(
        field
            .shared
            .scalar(Scalar::MaximumIceThickness)
            .get(1)
            .unwrap(),
        70.0
    );
    assert_eq!(
        field.shared.code(CellCode::CrustPlateIds).get(1).unwrap(),
        17
    );
    assert_eq!(field.shared.code(CellCode::BiomeCodes).get(1).unwrap(), 8);
    // Volcanic flags lose their vanished substrate; unrelated flags remain.
    assert_eq!(field.shared.code(CellCode::FeatureFlags).get(1).unwrap(), 2);
    assert_eq!(field.shared.scalar(Scalar::SoilCarbon).get(0).unwrap(), 0.0);
}
fn assert_owner_arrival(field: &Field, ratio: f64) {
    assert_eq!(
        field
            .people
            .view(HumanField::Layer(LayerId::Population))
            .get(1)
            .unwrap(),
        40.0 * ratio
    );
    assert_eq!(
        field.people.view(HumanField::Tenure).get(1).unwrap(),
        12.0 * ratio
    );
    assert_eq!(field.people.identity(0).traditions[0].get(1).unwrap(), 3);
    assert_eq!(field.ground_load.get(1).unwrap().kind, catalogue::BASALT);
    assert_eq!(field.ground_load.get(1).unwrap().depth, 4.0);
    assert_eq!(
        field.ground().view(GroundField::SoilDepth).get(1).unwrap(),
        2.0 * ratio
    );
    assert_eq!(
        field.water().column.store(Store::Snow).held(1).unwrap(),
        0.5 * ratio
    );
    assert_eq!(field.water().column.year[0].get(1).unwrap(), 3.0 * ratio);
}

#[test]
fn convergence_publishes_consumed_crust_into_the_canonical_history() {
    let mut seed = super::tests::seed();
    seed.ground.crust_initialized = true;
    for cell in [0, 1] {
        seed.ground
            .storage
            .initialize(GroundField::CrustThickness, cell, 100.0)
            .unwrap();
    }
    seed.shared
        .code_mut(CellCode::TectonicBoundaryCodes)
        .set(2, 1)
        .unwrap();
    let mut field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    let count = field.mesh.len();
    let arrival = (field.mesh.area(0) + field.mesh.area(1)) / field.mesh.area(2);
    assert!(arrival > 1.0);
    let coverage = field.coverage.get_mut();
    let mut offsets = coverage.scratch(count + 1, 2u32);
    offsets.set(0, 0).unwrap();
    offsets.set(1, 1).unwrap();
    let targets = coverage.scratch(2, 2i32);
    let weights = coverage.scratch(2, SCALE);
    let mut dominant = coverage.scratch(count, -1i32);
    dominant.set(2, 0).unwrap();
    let mut arrivals = coverage.scratch(count, 0.0);
    arrivals.set(2, arrival * SCALE).unwrap();
    let inflow = coverage.scratch(count, 0.0);
    let plan = HistoryTransport {
        shares: TransportShares {
            offsets: offsets.read_only(),
            targets: targets.read_only(),
            weights: weights.read_only(),
            dominant: dominant.read_only(),
            inflow: inflow.read_only(),
        },
        arrivals: arrivals.read_only(),
    };
    let mut run = Executor::new(field);
    run.run_with(&Field::transport_history(Field::carriers().unwrap()), &plan)
        .unwrap();
    let field = run.state();
    let consumed = 100.0 * (arrival - 1.0);
    for channel in [Scalar::OceanicSubduction, Scalar::OceanicSubductionHistory] {
        assert!((field.shared.scalar(channel).get(2).unwrap() - consumed).abs() < 1e-9);
    }
    assert!(
        (field
            .shared
            .scalar(Scalar::ConvergentCrustSurplus)
            .get(2)
            .unwrap()
            - consumed * 0.5)
            .abs()
            < 1e-9
    );
    assert!(
        (field
            .ground()
            .view(GroundField::CrustRootReserve)
            .get(2)
            .unwrap()
            - consumed * 0.5)
            .abs()
            < 1e-9
    );
}
