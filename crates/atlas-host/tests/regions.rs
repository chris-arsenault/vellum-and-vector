#![cfg(not(target_arch = "wasm32"))]
use atlas_gis::geometry::NativeGeos;
use atlas_map::regions::{change_navigation, draw_region, region_choices, RegionInput};
use atlas_map::spatial::{Overlay, Predicate, SpatialKernel};
use atlas_map::{
    Bounds, Geometry, Id, MapNavigationState, MapRef, MapRegion, MapView, NavigationChange,
    Position, RegionCandidate, RegionDrawing, RegionGeometry, RegionQuery,
};
use serde_json::json;

fn id(name: &str) -> Id {
    Id::from_name(name)
}

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
        "reference":{"mapId":id("island"),"revision":id("one")},"worldId":id("world"),"name":"Island",
        "primarySpaceId":id("surface"),"profile":"world",
        "footprint":rectangle(0.0,0.0,100.0,100.0),"bounds":[0,0,100,100],"parent":null,"state":"complete","layers":[],
        "regionScale":{"level":0,"nextArea":400,"subdivision":7,"minimumWidth":0.1,"enabled":true},
        "spaces":[{"id":id("surface"),"parentSpaceId":null,"bounds":[0,0,100,100],"metresPerUnit":1,"precision":0.000001,"periodicWidth":null,
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
            space_id: id("surface"),
            parent_id: None,
            editing_id: None,
            position: Some(Position::xy(20.0, 20.0)),
            viewport: Bounds(0.0, 0.0, 100.0, 100.0),
            cuts: vec![],
        },
        NativeGeos::new(1e-6).unwrap(),
    )
}
fn kept(name: &str, bounds: Bounds) -> MapRegion {
    MapRegion {
        id: name.into(),
        name: name.into(),
        space_id: id("surface"),
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
fn saved_regions_can_be_selected_and_do_not_cut_holes_in_temporary_selections() {
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
    assert!(kernel
        .relation(
            &shape(&drawn.geometry),
            &rectangle(11.0, 11.0, 19.0, 29.0),
            Predicate::Covers
        )
        .unwrap());
    assert!(change_navigation(
        &input.map,
        &input.navigation,
        NavigationChange::PutRegion(kept("overlapping", Bounds(10.0, 10.0, 30.0, 30.0))),
        &kernel,
    )
    .is_err());
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
                map_id: id("child"),
                revision: id("captured"),
            },
        },
        &kernel,
    )
    .unwrap();
    let refined = MapRef {
        map_id: id("child"),
        revision: id("refined"),
    };
    input.navigation = change_navigation(
        &input.map,
        &input.navigation,
        NavigationChange::AttachChild {
            region_id: parent.id.clone(),
            child: refined.clone(),
        },
        &kernel,
    )
    .unwrap();
    assert_eq!(input.navigation.regions[0].child, Some(refined));
    assert!(change_navigation(
        &input.map,
        &input.navigation,
        NavigationChange::AttachChild {
            region_id: parent.id.clone(),
            child: MapRef {
                map_id: id("other"),
                revision: id("captured"),
            },
        },
        &kernel,
    )
    .is_err());
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

/// An organic region becomes a child map of that outline. The child generates over the
/// outline with a band of context around it, which is not a rectangle.
#[test]
fn an_organic_region_is_captured_as_its_outline_with_a_context_band() {
    use atlas_host::{
        generation_world::{random_id, CreateWorld},
        numerical_resource::{Descriptor, Scope},
        regional_capture::{Selection, Source},
    };
    struct Empty;
    impl Source for Empty {
        fn resource(&self, _: &str) -> std::io::Result<Descriptor> {
            unreachable!()
        }
        fn geography(&self, _: &Scope, _: &str) -> std::io::Result<serde_json::Value> {
            unreachable!()
        }
    }
    let (mut input, _, kernel) = supplied();
    let world_id = random_id();
    let document = CreateWorld {
        id: world_id,
        name: "Parent".into(),
        seed: 1,
        width: 100.0,
        height: 100.0,
        settings: None,
        boundary_mode: None,
    }
    .create()
    .unwrap();
    input.map.reference.map_id = document.scope.located.area_id;
    input.map.world_id = world_id;
    input.map.primary_space_id = world_id;
    input.map.spaces[0].id = world_id;
    // A valley bending round a ridge: an L of two arms.
    let valley = Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(20.0, 20.0),
            Position::xy(60.0, 20.0),
            Position::xy(60.0, 35.0),
            Position::xy(35.0, 35.0),
            Position::xy(35.0, 70.0),
            Position::xy(20.0, 70.0),
            Position::xy(20.0, 20.0),
        ]],
    };
    let region = MapRegion {
        id: "valley".into(),
        name: "Valley".into(),
        space_id: world_id,
        parent_id: None,
        geometry: region(valley.clone()),
        child: None,
    };
    let selection = atlas_map::RegionSelection {
        parent: input.map.reference.clone(),
        space_id: world_id,
        geometry: region.geometry.clone(),
        feature_ids: vec![],
        region_path: vec![region],
    };
    let area_id = random_id();
    let captured = Selection {
        parent: &input.map,
        selection: &selection,
        id: area_id,
        name: "Valley",
        operation: id("capture"),
        real_scale: None,
        city: None,
    }
    .capture(document, vec![], &Empty, &kernel)
    .unwrap();
    let area = &captured.document.world["areas"][&area_id.to_string()];
    let outline: Geometry = serde_json::from_value(area["footprint"].clone()).unwrap();
    let extent: Geometry = serde_json::from_value(area["map"]["extent"].clone()).unwrap();
    let area_of = |g: &Geometry| kernel.area(g).unwrap();
    // The child map is exactly the valley, not its bounding box.
    assert!((area_of(&outline) - area_of(&valley)).abs() < 1e-6);
    // Generation covers the valley and a band around it, cut to the parent's domain.
    assert!(kernel
        .relation(&extent, &outline, Predicate::Covers)
        .unwrap());
    assert!(area_of(&extent) > area_of(&outline));
    let Bounds(w, s, e, n) = kernel.bounds(&extent).unwrap();
    assert!(area_of(&extent) < 0.8 * (e - w) * (n - s));
    // The ridge inside the bend stays outside the band.
    assert!(
        !kernel
            .covers_points(&extent, &[Position::xy(55.0, 65.0)])
            .unwrap()[0]
    );
    assert_eq!(
        kernel.area(&captured.document.scope.footprint).unwrap(),
        area_of(&extent)
    );
}

#[test]
fn regional_capture_preserves_selected_depth_and_leaves_room_for_coasts() {
    use atlas_host::{
        generation_world::random_id,
        generation_world::CreateWorld,
        numerical_resource::{Descriptor, Scope},
        regional_capture::{Selection, Source},
    };
    struct Empty;
    impl Source for Empty {
        fn resource(&self, _: &str) -> std::io::Result<Descriptor> {
            unreachable!()
        }
        fn geography(&self, _: &Scope, _: &str) -> std::io::Result<serde_json::Value> {
            unreachable!()
        }
    }
    let (mut input, _, kernel) = supplied();
    let world_id = random_id();
    let document = CreateWorld {
        id: world_id,
        name: "Parent".into(),
        seed: 1,
        width: 100.0,
        height: 100.0,
        settings: None,
        boundary_mode: None,
    }
    .create()
    .unwrap();
    input.map.reference.map_id = document.scope.located.area_id;
    input.map.world_id = world_id;
    input.map.primary_space_id = world_id;
    input.map.spaces[0].id = world_id;
    let mut parent = kept("district", Bounds(5.0, 5.0, 80.0, 80.0));
    parent.space_id = world_id;
    let mut child = kept("coast", Bounds(10.0, 10.0, 30.0, 30.0));
    child.space_id = world_id;
    child.parent_id = Some(parent.id.clone());
    let selection = atlas_map::RegionSelection {
        parent: input.map.reference.clone(),
        space_id: world_id,
        geometry: child.geometry.clone(),
        feature_ids: vec![],
        region_path: vec![parent, child],
    };
    let area_id = random_id();
    let captured = Selection {
        parent: &input.map,
        selection: &selection,
        id: area_id,
        name: "Coast",
        operation: id("capture"),
        real_scale: None,
        city: None,
    }
    .capture(
        serde_json::from_value(serde_json::to_value(&document).unwrap()).unwrap(),
        vec![],
        &Empty,
        &kernel,
    )
    .unwrap();
    let area = &captured.document.world["areas"][&area_id.to_string()];
    assert_eq!(area["map"]["refinementLevel"], 2);
    assert_eq!(area["traits"], json!([]));
    assert_eq!(
        kernel.bounds(&captured.document.scope.footprint).unwrap(),
        Bounds(8.0, 8.0, 32.0, 32.0)
    );
    assert_eq!(area["frame"]["origin"]["x"], 20.0);

    // A real-scale child is a 4:3 frame of the chosen hexes across, centred on the selection,
    // outside the regional ladder.
    let real = atlas_generation::features::context::RealScaleMap {
        kind: atlas_map::RealScaleKind::Ground,
        hex_size: atlas_generation::atlas::resolution::HexSize::OneAndHalfMetres,
        hexes_across: 20,
        triangles_per_edge: 2,
    };
    let point = atlas_map::RegionSelection {
        region_path: vec![],
        ..selection
    };
    let area_id = random_id();
    let captured = Selection {
        parent: &input.map,
        selection: &point,
        id: area_id,
        name: "Glen",
        operation: id("real-scale"),
        real_scale: Some(real),
        city: None,
    }
    .capture(document, vec![], &Empty, &kernel)
    .unwrap();
    let area = &captured.document.world["areas"][&area_id.to_string()];
    assert_eq!(area["profile"], "local");
    assert_eq!(area["map"]["refinementLevel"], 0);
    assert_eq!(area["map"]["realScale"]["hexSize"], "1.5m");
    assert_eq!(area["map"]["realScale"]["trianglesPerEdge"], 2);
    assert_eq!(
        kernel.bounds(&captured.document.scope.footprint).unwrap(),
        Bounds(5.0, 8.75, 35.0, 31.25)
    );
}
