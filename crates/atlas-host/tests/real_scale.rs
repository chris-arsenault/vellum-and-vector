#![cfg(not(target_arch = "wasm32"))]
use atlas_gis::geometry::NativeGeos;
use atlas_map::hexes::{marks, width_outline, Hex, HexGrid, MarkSource};
use atlas_map::spatial::SpatialKernel;
use atlas_map::{Bounds, Geometry, Position};

fn square(w: f64, s: f64, e: f64, n: f64) -> Geometry {
    Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(w, s),
            Position::xy(e, s),
            Position::xy(e, n),
            Position::xy(w, n),
            Position::xy(w, s),
        ]],
    }
}

#[test]
fn hexes_cover_a_frame_and_tile_it_without_gaps() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let grid = HexGrid::from_across_flats(1.5, [10.0, 20.0]).unwrap();
    assert!((grid.across_flats() - 1.5).abs() < 1e-12);
    let hexes = grid.covering(Bounds(0.0, 10.0, 20.0, 30.0));
    assert!(hexes.contains(&Hex { q: 0, r: 0 }));
    for &hex in &hexes {
        assert_eq!(grid.hex_at(grid.centre(hex)), hex);
        let [x, y] = grid.centre(hex);
        assert!((0.0..=20.0).contains(&x) && (10.0..=30.0).contains(&y));
        let area = spatial.area(&grid.polygon(hex)).unwrap();
        assert!((area - grid.area()).abs() < 1e-9);
    }
    let corners = grid.corners(Hex { q: 0, r: 0 });
    assert!(
        (corners[0][0] - corners[1][0]).abs() < 1e-12,
        "right side is vertical"
    );
    assert!(
        (corners[2][1] - 20.0 - grid.radius()).abs() < 1e-12,
        "a corner points up"
    );
    let union = spatial
        .union_all(&hexes.iter().map(|&h| grid.polygon(h)).collect::<Vec<_>>())
        .unwrap()
        .unwrap();
    let total = spatial.area(&union).unwrap();
    assert!((total - grid.area() * hexes.len() as f64).abs() < 1e-6);
}

#[test]
fn shapes_mark_the_hexes_they_cover_or_cross() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let grid = HexGrid::from_across_flats(10.0, [0.0, 0.0]).unwrap();
    let hexes = grid.covering(Bounds(-30.0, -30.0, 30.0, 30.0));
    let home = hexes.iter().position(|&h| h == Hex { q: 0, r: 0 }).unwrap();
    let whole = grid.polygon(Hex { q: 0, r: 0 });
    let house = square(-1.0, -1.0, 1.0, 1.0);
    let stream = Geometry::LineString {
        coordinates: vec![Position::xy(-30.0, 0.5), Position::xy(30.0, 0.5)],
    };
    let sources = [
        MarkSource {
            geometry: &whole,
            mark: "cover",
        },
        MarkSource {
            geometry: &house,
            mark: "building",
        },
        MarkSource {
            geometry: &stream,
            mark: "water",
        },
    ];
    let result = marks(&grid, &hexes, &sources, &spatial).unwrap();
    let here = &result[home];
    assert!((here["cover"] - 1.0).abs() < 1e-9);
    assert!((here["building"] - 4.0 / grid.area()).abs() < 1e-9);
    assert_eq!(here["water"], 1.0);
    let north = hexes.iter().position(|&h| h == Hex { q: 0, r: 2 }).unwrap();
    assert!(result[north].is_empty());
}

#[test]
fn a_line_with_changing_width_covers_more_ground_where_it_widens() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let line = [
        Position::xy(0.0, 0.0),
        Position::xy(10.0, 0.0),
        Position::xy(20.0, 0.0),
    ];
    let outline = width_outline(&line, &[1.0, 1.0, 6.0], &spatial)
        .unwrap()
        .unwrap();
    let narrow = spatial
        .clip_by_rect(&outline, Bounds(2.0, -10.0, 8.0, 10.0))
        .unwrap()
        .unwrap();
    let wide = spatial
        .clip_by_rect(&outline, Bounds(14.0, -10.0, 18.0, 10.0))
        .unwrap()
        .unwrap();
    let narrow_width = spatial.area(&narrow).unwrap() / 6.0;
    let wide_width = spatial.area(&wide).unwrap() / 4.0;
    assert!((narrow_width - 1.0).abs() < 1e-6);
    assert!(wide_width > 3.0 && wide_width < 6.0);
    assert!(width_outline(&line, &[1.0, 2.0], &spatial).is_err());
}
