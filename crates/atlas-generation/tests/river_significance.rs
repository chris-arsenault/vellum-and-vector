use atlas_generation::{
    scale::MapScale,
    water::{captured::DrainageReach, significance::course_judgments},
};
use atlas_map::Position;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
fn reach(flow: f64, downstream: Option<usize>) -> DrainageReach {
    DrainageReach {
        downstream,
        water_body: None,
        order: 1,
        basin: 0,
        feature_ids: Vec::new(),
        coordinates: vec![Position::xy(0.0, 0.0), Position::xy(100.0, 0.0)],
        discharges: vec![flow, 900.0],
        catchment_areas: vec![5000.0, 90000.0],
    }
}
#[test]
fn course_continuation_uses_tributary_water_before_the_shared_confluence() {
    let scale = MapScale::new(1000.0, 1000.0, 20.0).unwrap();
    let records = [reach(2.0, Some(2)), reach(3.0, Some(2)), reach(5.0, None)];
    let judged = course_judgments(&records, &scale).unwrap();
    assert_eq!(
        judged
            .iter()
            .map(|j| j.course.as_slice())
            .collect::<Vec<_>>(),
        vec![&[0][..], &[1, 2][..]]
    );
    assert_eq!(judged[0].evidence.discharge, 2.0);
    assert_eq!(judged[0].evidence.catchment, 5000.0);
    assert!(judged.iter().all(|j| j.publish));
}
#[test]
fn a_small_catchment_remains_unpublished_despite_large_receiving_water() {
    let scale = MapScale::new(1000.0, 1000.0, 20.0).unwrap();
    let mut tributary = reach(2.0, None);
    tributary.catchment_areas[0] = 1.0;
    let judged = course_judgments(&[tributary], &scale).unwrap();
    assert!(!judged[0].publish);
}
