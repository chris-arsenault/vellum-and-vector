use atlas_generation::{
    field::poi::{
        true_sizes::{
            crossing_size, length_text, long_tail, roll, settled_size, sited_size, size_text,
            spread, Ladder, MILL, PASS,
        },
        values::Size,
    },
    publication::key::{key_numbers, sized_footprint, true_outline},
};
use atlas_map::{hexes::HexGrid, Geometry, Position};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

const LADDER: Ladder = Ladder {
    least: 2.0,
    typical: 20.0,
    largest: 2_000.0,
};

#[test]
fn half_of_all_places_lie_below_typical_and_the_last_hundredth_reaches_the_largest() {
    assert!((long_tail(0.0, &LADDER) - 2.0).abs() < 1e-9);
    assert!((long_tail(0.5, &LADDER) - 20.0).abs() < 1e-9);
    assert!((long_tail(1.0, &LADDER) - 2_000.0).abs() < 1e-6);
    let ninth = long_tail(0.9, &LADDER);
    assert!(ninth > 20.0 && ninth < 200.0, "{ninth}");
    let mut last = 0.0;
    for step in 0..=100 {
        let size = long_tail(f64::from(step) / 100.0, &LADDER);
        assert!(size >= last);
        last = size;
    }
}

#[test]
fn a_median_place_runs_its_elongation_and_built_places_have_height() {
    let pass = sited_size(&PASS, [0.5, 0.5, 0.5]);
    assert!((pass.width.unwrap() - 150.0).abs() < 1e-9);
    assert!((pass.length.unwrap() - 450.0).abs() < 1e-6);
    assert!(pass.height.is_none());
    let round = sited_size(&PASS, [0.5, 0.0, 0.5]);
    assert!((round.length.unwrap() - 150.0).abs() < 1e-9);
    let mill = sited_size(&MILL, [0.5, 0.5, 0.5]);
    assert!((mill.height.unwrap() - 8.0).abs() < 1e-9);
}

#[test]
fn cells_in_a_line_measure_their_length_and_spread_their_area_as_width() {
    let line: Vec<[f64; 2]> = (0..10).map(|i| [f64::from(i) * 3.0, 0.0]).collect();
    let size = spread(&line, 90.0, 3.0);
    assert!((size.length.unwrap() - 30.0).abs() < 1e-9);
    assert!((size.width.unwrap() - 3.0).abs() < 1e-9);
    let turned: Vec<[f64; 2]> = line.iter().map(|[x, _]| [x * 0.6, x * 0.8]).collect();
    let size = spread(&turned, 90.0, 3.0);
    assert!((size.length.unwrap() - 30.0).abs() < 1e-9);
    let one = spread(&[[0.0, 0.0]], 9.0, 3.0);
    assert_eq!((one.length, one.width), (Some(3.0), Some(3.0)));
}

#[test]
fn settlements_cover_more_ground_as_they_grow_but_house_people_more_densely() {
    let village = settled_size(200.0);
    let area = |s: &Size| s.length.unwrap() * s.width.unwrap();
    assert!((area(&village) - 200.0 / 30.0 * 10_000.0).abs() < 1.0);
    let town = settled_size(20_000.0);
    assert!(area(&town) > area(&village));
    assert!(20_000.0 / area(&town) > 200.0 / area(&village));
    assert!(area(&settled_size(0.0)) >= 10_000.0 - 1e-6);
}

#[test]
fn a_bridge_spans_its_river_and_abutments_and_a_ford_wades_the_river() {
    let bridge = crossing_size(40.0, 4.5, true);
    assert_eq!(bridge.length, Some(40.0 + 2.0 * 4.0));
    assert_eq!(bridge.width, Some(4.5));
    let small = crossing_size(5.0, 4.5, true);
    assert_eq!(small.length, Some(5.0 + 2.0 * 2.0));
    assert_eq!(crossing_size(12.0, 8.0, false).length, Some(12.0));
    assert_eq!(crossing_size(0.0, 8.0, false).length, Some(2.0));
}

#[test]
fn sizes_read_in_a_game_masters_words() {
    assert_eq!(length_text(2.46), "2.5 m");
    assert_eq!(length_text(47.4), "47 m");
    assert_eq!(length_text(463.0), "460 m");
    assert_eq!(length_text(3_240.0), "3.2 km");
    let long = Size {
        height: Some(14.0),
        width: Some(6.0),
        length: Some(30.0),
    };
    assert_eq!(
        size_text(&long).unwrap(),
        "30 m long and 6.0 m wide, 14 m high"
    );
    let round = Size {
        height: None,
        width: Some(20.0),
        length: Some(24.0),
    };
    assert_eq!(size_text(&round).unwrap(), "about 24 m across");
}

#[test]
fn a_place_keeps_its_roll_wherever_it_is_published() {
    let a = roll("spring:plain:120", 1);
    assert_eq!(a, roll("spring:plain:120", 1));
    assert_ne!(a, roll("spring:plain:120", 2));
    assert_ne!(a, roll("spring:plain:121", 1));
    assert!((0.0..1.0).contains(&a));
}

#[test]
fn only_places_about_a_hex_across_stand_at_their_size() {
    assert!(true_outline([0.0, 0.0], 5.0, 4.0, 10.0).is_none());
    let Some(Geometry::Polygon { coordinates }) = true_outline([100.0, 50.0], 40.0, 10.0, 10.0)
    else {
        panic!("a 40 m place on a 10 m hex map has an outline");
    };
    let ring = &coordinates[0];
    assert_eq!(ring.first(), ring.last());
    let xs: Vec<f64> = ring.iter().map(|p| p.coordinates()[0]).collect();
    let ys: Vec<f64> = ring.iter().map(|p| p.coordinates()[1]).collect();
    let span = |v: &[f64]| {
        v.iter().cloned().fold(f64::MIN, f64::max) - v.iter().cloned().fold(f64::MAX, f64::min)
    };
    assert!((span(&xs) - 40.0).abs() < 1e-9);
    assert!(span(&ys) <= 10.0 + 1e-9 && span(&ys) > 9.0);
    let point = Geometry::Point {
        coordinates: Position::xy(0.0, 0.0),
    };
    let size = serde_json::json!({ "width": 12.0, "length": 30.0 });
    assert!(sized_footprint(&point, Some(&size), 10.0).is_some());
    assert!(sized_footprint(&point, None, 10.0).is_none());
}

#[test]
fn the_key_numbers_places_from_the_northern_row_west_to_east() {
    let grid = HexGrid::from_across_flats(10.0, [0.0, 0.0]).unwrap();
    let places = vec![
        ("south".to_owned(), [0.0, -30.0]),
        ("north-east".to_owned(), [40.0, 30.0]),
        ("north-west".to_owned(), [-40.0, 30.0]),
        ("middle".to_owned(), [5.0, 0.0]),
    ];
    let numbers = key_numbers(&places, &grid);
    assert_eq!(numbers["north-west"], 1);
    assert_eq!(numbers["north-east"], 2);
    assert_eq!(numbers["middle"], 3);
    assert_eq!(numbers["south"], 4);
}
