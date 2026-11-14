#![cfg(not(target_arch = "wasm32"))]
use atlas_gis::geometry::NativeGeos;
use atlas_map::regions::{change_navigation, draw_region, region_choices, RegionInput};
use atlas_map::spatial::{Overlay, Predicate, SpatialKernel};
use atlas_map::{
    Bounds, Geometry, MapNavigationState, MapRef, MapRegion, MapView, NavigationChange, Position,
    RegionCandidate, RegionDrawing, RegionGeometry, RegionQuery,
};
use serde_json::json;

fn rectangle(w: f64, s: f64, e: f64, n: f64) -> Geometry {
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
fn region(shape: Geometry) -> RegionGeometry {
    serde_json::from_value(serde_json::to_value(shape).unwrap()).unwrap()
}
fn shape(region: &RegionGeometry) -> Geometry {
    serde_json::from_value(serde_json::to_value(region).unwrap()).unwrap()
}
fn supplied() -> (RegionInput, RegionQuery, NativeGeos) {
    let map = serde_json::from_value(json!({
        "reference":{"mapId":"island","revision":"one"},"worldId":"world","name":"Island","primarySpaceId":"surface","profile":"world",
        "footprint":rectangle(0.0,0.0,100.0,100.0),"bounds":[0,0,100,100],"parent":null,"state":"complete","layers":[],
        "regionScale":{"level":0,"nextArea":400,"subdivision":7,"minimumWidth":0.1,"enabled":true},
        "spaces":[{"id":"surface","parentSpaceId":null,"bounds":[0,0,100,100],"metresPerUnit":1,"precision":0.000001,"periodicWidth":null,
            "frame":{"origin":[0,0,0],"rotation":0,"floor":null}}]
    })).unwrap();
    (
        RegionInput {
            map,
            navigation: MapNavigationState::default(),
            sources: vec![RegionCandidate {
                name: "Island".into(),
                geometry: region(rectangle(10.0, 10.0, 30.0, 30.0)),
            }],
            anchors: vec![],
            ocean: None,
        },
        RegionQuery {
            space_id: "surface".into(),
            parent_id: None,
            editing_id: None,
            position: Some(Position::xy(20.0, 20.0)),
            viewport: Bounds(0.0, 0.0, 100.0, 100.0),
            cuts: vec![],
        },
        NativeGeos::new(1e-6).unwrap(),
    )
}
fn kept(id: &str, bounds: Bounds) -> MapRegion {
    MapRegion {
        id: id.into(),
        name: id.into(),
        space_id: "surface".into(),
        parent_id: None,
        geometry: region(rectangle(bounds.0, bounds.1, bounds.2, bounds.3)),
        child: None,
    }
}
#[test]
fn whole_islands_and_their_holes_survive_selection() {
    let (mut input, query, kernel) = supplied();
    let island = kernel
        .overlay(
            &rectangle(10.0, 10.0, 30.0, 30.0),
            &rectangle(22.0, 22.0, 25.0, 25.0),
            Overlay::Difference,
        )
        .unwrap()
        .unwrap();
    input.sources[0].geometry = region(island.clone());
    let result = region_choices(&input, &query, &kernel).unwrap();
    assert_eq!(result.candidates.len(), 1);
    let selected = shape(&result.candidates[0].geometry);
    assert!(kernel
        .relation(&selected, &island, Predicate::Covers)
        .unwrap());
    assert!(!kernel
        .relation(
            &selected,
            &rectangle(23.0, 23.0, 24.0, 24.0),
            Predicate::Intersects
        )
        .unwrap());
}
#[test]
fn oversized_landmasses_offer_local_districts_and_the_whole_shape() {
    let (mut input, query, kernel) = supplied();
    input.sources[0].geometry = region(rectangle(5.0, 5.0, 95.0, 95.0));
    input.anchors.push(Position::xy(18.0, 18.0));
    let result = region_choices(&input, &query, &kernel).unwrap();
    assert!(result
        .candidates
        .iter()
        .any(|candidate| candidate.name.contains('·')));
    assert!(result
        .candidates
        .iter()
        .any(|candidate| candidate.name == "Island"));
    assert!(kernel.area(&shape(&result.candidates[0].geometry)).unwrap() < 2000.0);
}
#[test]
fn dividing_lines_snap_to_existing_edges_and_pick_the_clicked_side() {
    let (input, query, kernel) = supplied();
    let drawn = draw_region(
        &input,
        &RegionDrawing {
            query: query.clone(),
            geometry: Geometry::LineString {
                coordinates: vec![Position::xy(20.0, 10.2), Position::xy(20.0, 29.8)],
            },
            tolerance: 0.5,
        },
        &kernel,
    )
    .unwrap();
    let query = RegionQuery {
        position: Some(Position::xy(15.0, 20.0)),
        cuts: drawn.cuts,
        ..query
    };
    let result = region_choices(&input, &query, &kernel).unwrap();
    let selected = shape(&result.candidates[0].geometry);
    assert!(kernel
        .relation(
            &selected,
            &Geometry::Point {
                coordinates: Position::xy(15.0, 20.0)
            },
            Predicate::Covers
        )
        .unwrap());
    assert!(!kernel
        .relation(
            &selected,
            &Geometry::Point {
                coordinates: Position::xy(25.0, 20.0)
            },
            Predicate::Covers
        )
        .unwrap());
}
#[test]
fn committed_siblings_are_navigated_and_excluded_from_new_outlines() {
    let (mut input, query, kernel) = supplied();
    input
        .navigation
        .regions
        .push(kept("kept", Bounds(10.0, 10.0, 20.0, 30.0)));
    let click = RegionQuery {
        position: Some(Position::xy(15.0, 20.0)),
        ..query.clone()
    };
    assert_eq!(
        region_choices(&input, &click, &kernel)
            .unwrap()
            .child_id
            .as_deref(),
        Some("kept")
    );
    let drawing = RegionDrawing {
        query,
        geometry: rectangle(10.0, 10.0, 30.0, 30.0),
        tolerance: 0.0,
    };
    let drawn = draw_region(&input, &drawing, &kernel)
        .unwrap()
        .candidate
        .unwrap();
    assert!(!kernel
        .relation(
            &shape(&drawn.geometry),
            &rectangle(11.0, 11.0, 19.0, 29.0),
            Predicate::Intersects
        )
        .unwrap());
}
#[test]
fn saved_views_and_refined_children_retain_region_identity_and_outline() {
    let (mut input, _, kernel) = supplied();
    let parent = kept("parent", Bounds(10.0, 10.0, 30.0, 30.0));
    let state = change_navigation(
        &input.map,
        &input.navigation,
        NavigationChange::PutRegion(parent.clone()),
        &kernel,
    )
    .unwrap();
    let view = MapView {
        id: "view".into(),
        name: "View".into(),
        region_id: Some(parent.id.clone()),
        settings: Default::default(),
    };
    let state =
        change_navigation(&input.map, &state, NavigationChange::PutView(view), &kernel).unwrap();
    assert!(change_navigation(
        &input.map,
        &state,
        NavigationChange::RemoveRegion(parent.id.clone()),
        &kernel
    )
    .is_err());
    input.navigation = change_navigation(
        &input.map,
        &state,
        NavigationChange::AttachChild {
            region_id: parent.id.clone(),
            child: MapRef {
                map_id: "child".into(),
                revision: "captured".into(),
            },
        },
        &kernel,
    )
    .unwrap();
    let mut changed = input.navigation.regions[0].clone();
    changed.geometry = region(rectangle(10.0, 10.0, 25.0, 30.0));
    assert!(change_navigation(
        &input.map,
        &input.navigation,
        NavigationChange::PutRegion(changed),
        &kernel
    )
    .is_err());
    let mut renamed = input.navigation.regions[0].clone();
    renamed.name = "New name".into();
    assert!(change_navigation(
        &input.map,
        &input.navigation,
        NavigationChange::PutRegion(renamed),
        &kernel
    )
    .is_ok());
}
#[test]
fn cylindrical_seam_fragments_form_one_selected_island() {
    let (mut input, mut query, kernel) = supplied();
    input.map.spaces[0].periodic_width = Some(100.0);
    input.sources[0].geometry = region(
        kernel
            .union_all(&[
                rectangle(0.0, 10.0, 10.0, 30.0),
                rectangle(90.0, 10.0, 100.0, 30.0),
            ])
            .unwrap()
            .unwrap(),
    );
    query.position = Some(Position::xy(5.0, 20.0));
    let result = region_choices(&input, &query, &kernel).unwrap();
    assert_eq!(result.candidates.len(), 1);
    let selected = shape(&result.candidates[0].geometry);
    assert!(kernel
        .relation(
            &selected,
            &Geometry::Point {
                coordinates: Position::xy(95.0, 20.0)
            },
            Predicate::Covers
        )
        .unwrap());
}

#[test]
fn surveyed_dry_land_can_be_divided_without_named_polygons() {
    let (mut input, query, kernel) = supplied();
    input.sources.clear();
    assert!(region_choices(&input, &query, &kernel)
        .unwrap()
        .candidates
        .is_empty());
    input.ocean = Some(Geometry::GeometryCollection { geometries: vec![] });
    let result = region_choices(&input, &query, &kernel).unwrap();
    assert!(!result.candidates.is_empty());
    for candidate in result.candidates {
        let selected = shape(&candidate.geometry);
        assert!(candidate.name.starts_with("Landmass"));
        assert!(kernel.area(&selected).unwrap() < 10000.0);
        assert!(kernel
            .relation(
                &selected,
                &Geometry::Point {
                    coordinates: query.position.unwrap()
                },
                Predicate::Covers
            )
            .unwrap());
    }
}

#[test]
fn regional_capture_preserves_selected_depth_and_leaves_room_for_coasts() {
    use atlas_host::{
        generation_world::CreateWorld,
        numerical_resource::Scope,
        regional_capture::{Selection, Source},
    };
    struct Empty;
    impl Source for Empty {
        fn resource(&self, _: &str) -> std::io::Result<serde_json::Value> {
            unreachable!()
        }
        fn geography(&self, _: &Scope, _: &str) -> std::io::Result<serde_json::Value> {
            unreachable!()
        }
    }
    let (mut input, _, kernel) = supplied();
    let world_id = uuid::Uuid::new_v4().to_string();
    let document = CreateWorld {
        id: world_id.clone(),
        name: "Parent".into(),
        seed: 1,
        width: 100.0,
        height: 100.0,
        settings: None,
        boundary_mode: None,
    }
    .create()
    .unwrap();
    input.map.reference.map_id = document.scope.located.area_id.clone();
    input.map.world_id = world_id.clone();
    input.map.primary_space_id = world_id.clone();
    input.map.spaces[0].id = world_id.clone();
    let mut parent = kept("district", Bounds(5.0, 5.0, 80.0, 80.0));
    parent.space_id = world_id.clone();
    let mut child = kept("coast", Bounds(10.0, 10.0, 30.0, 30.0));
    child.space_id = world_id.clone();
    child.parent_id = Some(parent.id.clone());
    let selection = atlas_map::RegionSelection {
        parent: input.map.reference.clone(),
        space_id: world_id,
        geometry: child.geometry.clone(),
        feature_ids: vec![],
        region_path: vec![parent, child],
    };
    let id = uuid::Uuid::new_v4().to_string();
    let captured = Selection {
        parent: &input.map,
        selection: &selection,
        id: &id,
        name: "Coast",
        operation: "capture",
    }
    .capture(document, vec![], &Empty, &kernel)
    .unwrap();
    let area = &captured.document.world["areas"][&id];
    assert_eq!(area["map"]["refinementLevel"], 2);
    assert_eq!(area["traits"], json!([]));
    assert_eq!(
        kernel.bounds(&captured.document.scope.footprint).unwrap(),
        Bounds(8.0, 8.0, 32.0, 32.0)
    );
    assert_eq!(area["frame"]["origin"]["x"], 20.0);
}
