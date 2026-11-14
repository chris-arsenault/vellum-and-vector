use super::{
    balance::MONTHS,
    column::{Store, WaterColumn, WaterMedium},
    ledger::WaterLedger,
    network_tests::fixture,
    runoff::{ClimateBands, ClimateSettings, LandWaterInputs, Runoff},
};
use crate::climate::{LatitudeFrame, LatitudeProjection, RainBelts};
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
#[test]
fn runoff_is_a_read_of_the_established_months_without_spending_the_column() {
    let (_, mut coverage, [a, _, _]) = fixture();
    let elevation = coverage.allocate(0.0);
    let mut water = WaterColumn::new(
        &mut coverage,
        WaterMedium {
            elevation: elevation.read_only(),
            soil_capacity: Rc::new(|_| Ok(1.0)),
            groundwater_capacity: Rc::new(|_| Ok(1.0)),
        },
    );
    water.put_soil_water(a, 0.3).unwrap();
    water.put_snow(a, 0.4).unwrap();
    let mut values = [0.0; MONTHS + 2];
    values[0] = 1.0;
    values[1] = 2.0;
    values[MONTHS] = 100.0;
    water.set_year(a, values).unwrap();
    let mut runoff = Runoff::new(&mut coverage);
    runoff.project(&water).unwrap();
    assert_eq!(runoff.read_only().mean.get(a).unwrap(), 3.0);
    assert_eq!(runoff.read_only().flood.get(a).unwrap(), 24.0);
    assert_eq!(runoff.read_only().dry.get(a).unwrap(), 0.0);
    assert_eq!(water.read_only().store(Store::Soil).held(a).unwrap(), 0.3);
    assert_eq!(water.read_only().store(Store::Snow).held(a).unwrap(), 0.4);
}
#[test]
fn water_occurrence_keeps_inherited_frozen_snow_and_clears_marine_stocks() {
    let (mesh, mut coverage, [a, b, _]) = fixture();
    let elevation = coverage.allocate(-1024.0);
    let mut water = WaterColumn::new(
        &mut coverage,
        WaterMedium {
            elevation: elevation.read_only(),
            soil_capacity: Rc::new(|_| Ok(1.0)),
            groundwater_capacity: Rc::new(|_| Ok(1.0)),
        },
    );
    water.put_snow(a, 0.4).unwrap();
    water.put_snow(b, 0.4).unwrap();
    water
        .stand(b, super::column::StandingKind::Sea, 0.0, Some(1))
        .unwrap();
    let temperature = coverage.allocate(100.0);
    let zero = coverage.allocate(0.0);
    let climate = ClimateBands {
        temperature: temperature.read_only(),
        seasonality: zero.read_only(),
        rainfall: zero.read_only(),
        snowfall: zero.read_only(),
        river_warmth: zero.read_only(),
    };
    let frame = LatitudeFrame {
        south: -90.0,
        north: 90.0,
        projection: LatitudeProjection::Equirectangular,
        world_extent_y: Some([0.0, 100.0]),
    };
    let belts = RainBelts {
        axial_tilt: 23.0,
        circulation_cells_per_hemisphere: 3.0,
        equatorial_convergence: 1.0,
        equatorial_convergence_width: 10.0,
        storm_track_strength: 1.0,
        subtropical_subsidence: 0.2,
        subtropical_subsidence_width: 10.0,
        polar_subsidence: 0.2,
        minimum_rainout: 0.1,
    };
    water
        .advance_year(
            LandWaterInputs {
                mesh: &mesh,
                climate: &climate,
                settings: ClimateSettings {
                    frame: &frame,
                    belts: &belts,
                    seasonality_equator: 2.0,
                    seasonality_polar: 20.0,
                    snow_melt_per_degree: 1.0,
                    storm_runoff_share: 0.5,
                },
                sinking: &|_| Ok(0.0),
                bare: &|_| Ok(1.0),
                wetting: &zero.read_only(),
                held: &zero.read_only(),
            },
            &mut WaterLedger::default(),
        )
        .unwrap();
    assert_eq!(water.read_only().store(Store::Snow).held(a).unwrap(), 0.4);
    assert_eq!(water.read_only().year[MONTHS + 1].get(a).unwrap(), 0.0);
    assert_eq!(water.read_only().store(Store::Snow).held(b).unwrap(), 0.0);
}
