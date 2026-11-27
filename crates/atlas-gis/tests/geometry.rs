#![cfg(not(target_arch = "wasm32"))]
use atlas_gis::geometry::NativeGeos;
use atlas_map::spatial::{Overlay, Predicate, SpatialKernel};
use atlas_map::{Bounds, Geometry, Position};

fn polygon(x: f64, y: f64, width: f64) -> Geometry {
    Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(x, y),
            Position::xy(x + width, y),
            Position::xy(x + width, y + width),
            Position::xy(x, y + width),
            Position::xy(x, y),
        ]],
    }
}
#[test]
fn native_geometry_uses_geos_for_overlay_and_bulk_point_predicates() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let a = polygon(0.0, 0.0, 4.0);
    let b = polygon(2.0, 2.0, 4.0);
    let overlap = spatial
        .overlay(&a, &b, Overlay::Intersection)
        .unwrap()
        .unwrap();
    assert_eq!(spatial.area(&overlap).unwrap(), 4.0);
    assert_eq!(
        spatial
            .covers_points(
                &a,
                &[
                    Position::xy(0.0, 0.0),
                    Position::xy(1.0, 1.0),
                    Position::xy(5.0, 5.0)
                ]
            )
            .unwrap(),
        [true, true, false]
    );
}

#[test]
fn retained_area_clips_parcels_and_tests_routes_across_a_hole() {
    let geos = NativeGeos::new(0.001).unwrap();
    let district = geos
        .overlay(
            &polygon(0., 0., 10.),
            &polygon(4., 4., 2.),
            Overlay::Difference,
        )
        .unwrap()
        .unwrap();
    let area = geos.prepare_area(&district).unwrap();
    let inside = polygon(1., 1., 2.);
    assert!(area.covers(&inside).unwrap());
    assert_eq!(
        geos.area(&area.intersection(&inside).unwrap().unwrap())
            .unwrap(),
        4.
    );
    assert!(area
        .intersection(&polygon(4.4, 4.4, 0.5))
        .unwrap()
        .is_none());
    let over_hole = polygon(3., 3., 3.);
    assert_eq!(
        geos.area(&area.intersection(&over_hole).unwrap().unwrap())
            .unwrap(),
        5.
    );
    let across_hole = Geometry::LineString {
        coordinates: vec![Position::xy(2., 5.), Position::xy(8., 5.)],
    };
    assert!(!area.covers(&across_hole).unwrap());
    let edge = Geometry::LineString {
        coordinates: vec![Position::xy(0., 0.), Position::xy(10., 0.)],
    };
    assert!(area.covers(&edge).unwrap());
}
#[test]
fn native_geometry_keeps_multipart_buffers_and_linear_referencing() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let geometry = Geometry::GeometryCollection {
        geometries: vec![polygon(0.0, 0.0, 2.0), polygon(1.0, 0.0, 2.0)],
    };
    assert!(spatial.buffer(&geometry, 0.5).unwrap().is_some());
    // After the setback, this parcel has no interior at the declared precision.
    assert!(spatial
        .buffer(&polygon(0.0, 0.0, 8.0), -3.99999)
        .unwrap()
        .is_none());
    let combined = spatial
        .union_all(&[polygon(0.0, 0.0, 2.0), polygon(5.0, 5.0, 0.0001)])
        .unwrap()
        .unwrap();
    assert_eq!(spatial.area(&combined).unwrap(), 4.0);
    let line = Geometry::LineString {
        coordinates: vec![Position::xy(0.0, 0.0), Position::xy(10.0, 0.0)],
    };
    assert_eq!(
        spatial
            .line_fraction(&line, Position::xy(3.0, 2.0))
            .unwrap(),
        0.3
    );
    assert_eq!(spatial.line_at(&line, 0.4).unwrap(), Position::xy(4.0, 0.0));
    let elevated = Geometry::LineString {
        coordinates: vec![
            Position::XYZ([0.0, 0.0, 10.0]),
            Position::XYZ([10.0, 0.0, 30.0]),
        ],
    };
    assert_eq!(spatial.canonical(&elevated).unwrap(), elevated);
    assert_eq!(
        spatial.line_at(&elevated, 0.5).unwrap(),
        Position::XYZ([5.0, 0.0, 20.0])
    );
    let directed = Geometry::LineString {
        coordinates: vec![Position::xy(10.0, 0.0), Position::xy(0.0, 0.0)],
    };
    assert_eq!(
        spatial
            .line_at(&spatial.canonical(&directed).unwrap(), 0.0)
            .unwrap(),
        Position::xy(10.0, 0.0)
    );
}

#[test]
fn invalid_geometry_is_reported_instead_of_repaired_while_reading() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let invalid = Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(0.0, 0.0),
            Position::xy(3.0, 3.0),
            Position::xy(0.0, 3.0),
            Position::xy(3.0, 0.0),
            Position::xy(0.0, 0.0),
        ]],
    };
    assert!(spatial.canonical(&invalid).is_err());
    assert!(spatial.union_all(&[]).is_err());
}

#[test]
fn trace_clipping_keeps_ordered_revisits_and_isolated_boundary_contacts() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let stationary = Geometry::LineString {
        coordinates: vec![Position::xy(0.0, 0.0); 3],
    };
    assert_eq!(
        spatial
            .clip_trace(&stationary, &polygon(0.0, 0.0, 4.0))
            .unwrap(),
        Some(stationary)
    );
    let trace = Geometry::LineString {
        coordinates: vec![
            Position::xy(-1.0, 2.0),
            Position::xy(5.0, 2.0),
            Position::xy(-1.0, 2.0),
        ],
    };
    let clipped = spatial
        .clip_trace(&trace, &polygon(0.0, 0.0, 4.0))
        .unwrap()
        .unwrap();
    let Geometry::MultiLineString { coordinates } = clipped else {
        panic!("Ordered trips remain separate");
    };
    assert_eq!(
        coordinates,
        vec![
            vec![Position::xy(0.0, 2.0), Position::xy(4.0, 2.0)],
            vec![Position::xy(4.0, 2.0), Position::xy(0.0, 2.0)],
        ]
    );
    let touching = Geometry::LineString {
        coordinates: vec![Position::xy(-1.0, 1.0), Position::xy(1.0, -1.0)],
    };
    assert_eq!(
        spatial
            .clip_trace(&touching, &polygon(0.0, 0.0, 4.0))
            .unwrap(),
        Some(Geometry::Point {
            coordinates: Position::xy(0.0, 0.0)
        })
    );
}

#[test]
fn trace_resampling_retains_endpoints_and_polygonization_uses_noded_lines() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let trace = Geometry::LineString {
        coordinates: vec![
            Position::xy(0.0, 0.0),
            Position::xy(2.0, 0.01),
            Position::xy(4.0, 0.0),
        ],
    };
    let Geometry::LineString { coordinates } =
        spatial.resample_trace(&trace, 0.1, Some(1.0)).unwrap()
    else {
        panic!("Expected line");
    };
    assert_eq!(coordinates.first(), Some(&Position::xy(0.0, 0.0)));
    assert_eq!(coordinates.last(), Some(&Position::xy(4.0, 0.0)));
    assert_eq!(coordinates.len(), 5);
    assert!(spatial.resample_trace(&trace, 0.1, Some(0.0)).is_err());
    let Geometry::Polygon { coordinates } = polygon(0.0, 0.0, 4.0) else {
        unreachable!()
    };
    let boundaries = Geometry::MultiLineString { coordinates };
    let faces = spatial.polygonize(&boundaries).unwrap();
    assert_eq!(faces.len(), 1);
    assert_eq!(spatial.area(&faces[0]).unwrap(), 16.0);
}

/// A holed square around the origin and a point one unit east of it.
fn holed_square_and_point() -> [Geometry; 2] {
    let mut holed = polygon(-5.0, -5.0, 10.0);
    let Geometry::Polygon { coordinates: inner } = polygon(-4.0, -4.0, 8.0) else {
        unreachable!()
    };
    if let Geometry::Polygon { coordinates } = &mut holed {
        coordinates.push(inner[0].clone());
    }
    [
        holed,
        Geometry::Point {
            coordinates: Position::xy(1.0, 0.0),
        },
    ]
}

#[test]
fn indexed_queries_preserve_input_order_and_use_geometry_distance_not_envelope_distance() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let values = holed_square_and_point();
    let index = spatial.index(&values).unwrap();
    assert_eq!(index.query(Bounds(-5.0, -5.0, 5.0, 5.0)).unwrap(), [0, 1]);
    assert_eq!(index.query(Bounds(0.0, 0.0, 0.0, 0.0)).unwrap(), [0]);
    assert_eq!(index.nearest(Position::xy(0.0, 0.0)).unwrap(), Some(1));
    assert_eq!(
        index
            .distances(Bounds(-5., -5., 5., 5.), Position::xy(0., 0.))
            .unwrap(),
        [(0, 4.), (1, 1.)]
    );
    assert_eq!(
        index.nearest_with_distance(Position::xy(0., 0.)).unwrap(),
        Some((1, 1.))
    );
}

#[test]
fn indexed_nearest_many_and_empty_or_inverted_queries() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let values = holed_square_and_point();
    let index = spatial.index(&values).unwrap();
    assert_eq!(
        index
            .nearest_many(&[Position::xy(0.0, 0.0), Position::xy(0.0, 4.0)])
            .unwrap(),
        [Some(1), Some(0)]
    );
    assert!(index.nearest_many(&[]).unwrap().is_empty());
    assert!(index.query(Bounds(1.0, 0.0, -1.0, 0.0)).is_err());
    assert_eq!(
        spatial
            .index(&[])
            .unwrap()
            .nearest(Position::xy(0.0, 0.0))
            .unwrap(),
        None
    );
}

#[test]
fn site_topology_returns_original_indices_and_clipped_cells_in_site_order() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let sites = [
        Position::xy(1.0, 2.0),
        Position::xy(3.0, 2.0),
        Position::xy(1.0, 2.0),
    ];
    let edges = spatial.delaunay_edges(&sites).unwrap();
    assert_eq!(edges.len(), 1);
    assert!(edges[0].contains(&1) && edges[0].contains(&2));
    let cells = spatial
        .voronoi_cells(&sites, Bounds(0.0, 0.0, 4.0, 4.0))
        .unwrap();
    assert_eq!(cells.len(), 3);
    assert_eq!(spatial.area(cells[0].as_ref().unwrap()).unwrap(), 8.0);
    assert_eq!(spatial.area(cells[1].as_ref().unwrap()).unwrap(), 8.0);
    assert_eq!(cells[0], cells[2]);
    let spatial = NativeGeos::new(0.000001).unwrap();
    let sites = [
        Position::xy(1_000_000.0000005, 2.0000005),
        Position::xy(3_000_000.0000005, 2_000_000.0000005),
        Position::xy(3_500_000.0000005, 1_000_000.0000005),
    ];
    let edges = spatial.delaunay_edges(&sites).unwrap();
    assert_eq!(edges.len(), 3);
    assert!(edges.iter().flatten().all(|&site| site < sites.len()));
}

#[test]
fn bulk_masks_preserve_operand_direction_and_select_faces_without_publishing_all_of_them() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mask = polygon(0.0, 0.0, 4.0);
    let inputs = [polygon(2.0, 2.0, 4.0), polygon(10.0, 10.0, 2.0)];
    assert_eq!(
        spatial
            .relations(&mask, &inputs, Predicate::Intersects)
            .unwrap(),
        [true, false]
    );
    assert_eq!(
        spatial.intersection_areas(&mask, &inputs).unwrap(),
        [4.0, 0.0]
    );
    let differences = spatial
        .overlays(&mask, &inputs, Overlay::Difference)
        .unwrap();
    assert_eq!(
        spatial.area(differences[0].as_ref().unwrap()).unwrap(),
        12.0
    );
    assert_eq!(spatial.area(differences[1].as_ref().unwrap()).unwrap(), 4.0);
    let windows = spatial
        .clip_windows(
            &mask,
            &[Bounds(1.0, 1.0, 3.0, 3.0), Bounds(8.0, 8.0, 9.0, 9.0)],
        )
        .unwrap();
    assert_eq!(spatial.area(windows[0].as_ref().unwrap()).unwrap(), 4.0);
    assert!(windows[1].is_none());
    let Geometry::Polygon {
        coordinates: mut boundaries,
    } = mask
    else {
        unreachable!()
    };
    let Geometry::Polygon { coordinates } = inputs[1].clone() else {
        unreachable!()
    };
    boundaries.extend(coordinates);
    let selected = spatial
        .polygonize_area(&boundaries, &mut |p| p.coordinates()[0] < 5.0)
        .unwrap()
        .unwrap();
    assert_eq!(spatial.area(&selected).unwrap(), 16.0);
    let trace = Geometry::LineString {
        coordinates: vec![Position::xy(-1.0, 2.0), Position::xy(5.0, 2.0)],
    };
    let mut crossings = spatial.crossings(&trace, &selected).unwrap();
    crossings.sort_by(|a, b| a.coordinates()[0].total_cmp(&b.coordinates()[0]));
    assert_eq!(crossings, [Position::xy(0.0, 2.0), Position::xy(4.0, 2.0)]);
}

#[test]
fn intersection_area_distinguishes_covered_cells_holes_and_boundary_contacts() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mask = polygon(0.0, 0.0, 4.0);
    assert_eq!(
        spatial
            .intersection_areas(&mask, &[polygon(1.0, 1.0, 1.0), polygon(4.0, 0.0, 1.0)])
            .unwrap(),
        [1.0, 0.0]
    );
    assert_eq!(
        spatial
            .intersection_areas(
                &polygon_with_hole(),
                &[
                    polygon(1.25, 1.25, 0.5),
                    polygon(0.0, 0.0, 2.0),
                    polygon(0.0, 0.0, 0.5),
                ]
            )
            .unwrap(),
        [0.0, 3.0, 0.25]
    );
}

fn polygon_with_hole() -> Geometry {
    let mut value = polygon(0.0, 0.0, 4.0);
    let Geometry::Polygon { coordinates } = &mut value else {
        panic!("Polygon fixture")
    };
    let Geometry::Polygon { coordinates: hole } = polygon(1.0, 1.0, 2.0) else {
        panic!("Polygon fixture")
    };
    coordinates.push(hole[0].clone());
    value
}

#[test]
fn adaptive_coverage_reuses_the_mask_with_holes_and_precision() {
    let spatial = NativeGeos::new(0.001).unwrap();
    spatial
        .with_point_coverage(&polygon_with_hole(), &mut |covers| {
            assert!(covers(Position::xy(0.5, 0.5))?);
            assert!(!covers(Position::xy(2.0, 2.0))?);
            assert!(covers(Position::xy(1.0, 2.0))?);
            assert!(covers(Position::xy(-0.0001, 0.5))?);
            assert!(!covers(Position::xy(-0.01, 0.5))?);
            Ok(())
        })
        .unwrap();
}
