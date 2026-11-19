use super::*;
use crate::{BandValue, Position};
use serde_json::json;

fn building(storeys: Option<i64>) -> MapFeature {
    let mut attributes = BTreeMap::from([
        ("use".to_owned(), json!("inn")),
        ("address".to_owned(), json!("3 Drovers' Way")),
        ("street".to_owned(), json!("Drovers' Way")),
        ("ward".to_owned(), json!("Glenfoot")),
        ("settlement".to_owned(), json!("Glen")),
    ]);
    if let Some(storeys) = storeys {
        attributes.insert("storeys".into(), json!(storeys));
    }
    serde_json::from_value(json!({
        "id":crate::Id::from_name("inn"),"spaceId":crate::Id::from_name("world"),"entityId":null,
        "layerId":"vector:structures","name":"The Rowan",
        "kind":"building","typeId":"building","catalog":{"values":{},"origin":"Generated","mapOnly":false},
        "geometry":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,6],[0,6],[0,0]]]},
        "footprint":null,"attributes":attributes,"relations":[],"causes":[]
    }))
    .unwrap()
}

#[test]
fn the_front_wall_is_the_edge_nearest_the_street() {
    let ring = [[0.0, 0.0], [10.0, 0.0], [10.0, 6.0], [0.0, 6.0]];
    let north_street = Geometry::LineString {
        coordinates: vec![Position::xy(-5.0, 9.0), Position::xy(15.0, 9.0)],
    };
    // Edges run 0 south, 1 east, 2 north, 3 west on this counter-clockwise ring.
    assert_eq!(frontage(&ring, Some(&north_street)), 2);
    let west_lane = Geometry::LineString {
        coordinates: vec![Position::xy(-3.0, -5.0), Position::xy(-3.0, 10.0)],
    };
    assert_eq!(frontage(&ring, Some(&west_lane)), 3);
    // Without a street the longest edge fronts.
    assert!([0, 2].contains(&frontage(&ring, None)));
}

#[test]
fn levels_come_from_storeys_with_a_cellar_beneath() {
    assert_eq!(shell_levels(&building(Some(2))), vec![-1, 0, 1]);
    assert_eq!(shell_levels(&building(None)), vec![-1, 0]);
    let world = crate::Id::from_name("world");
    assert_eq!(level_space_id(world, 0), world);
    assert_ne!(level_space_id(world, -1), world);
    assert_ne!(level_space_id(world, -1), level_space_id(world, 1));
}

#[test]
fn level_layers_keep_their_family_and_walls_are_lines() {
    assert_eq!(
        level_layer_id("vector:structures", 2),
        "vector:structures@2"
    );
    assert_eq!(
        crate::authoring::family("vector:structures@-1"),
        "structures"
    );
    assert_eq!(
        crate::authoring::shape_of_kind("vector:structures@1", "wall"),
        Some(crate::authoring::Shape::Line)
    );
    assert_eq!(
        crate::authoring::shape_of_kind("vector:structures@1", "door"),
        Some(crate::authoring::Shape::Area)
    );
    assert_eq!(crate::authoring::level_name(-1), "Cellar");
    assert_eq!(crate::authoring::level_name(1), "First floor");
}

#[test]
fn connections_are_the_passage_kinds() {
    assert!(is_connection("trapdoor") && is_connection("stair") && !is_connection("wall"));
}

/// The band values read at one point: each channel's `value` band.
fn reading(values: &[(&str, f64)]) -> Vec<BandValue> {
    values
        .iter()
        .map(|(channel, value)| BandValue {
            layer_id: format!("raster:{channel}"),
            band_id: "value".into(),
            value: *value,
            unit: "ratio".into(),
            label: format!("{channel} label"),
            display: crate::DisplayUnit {
                unit: "ratio".into(),
                factor: 1.0,
            },
            category: None,
        })
        .collect()
}

#[test]
fn magic_prevalence_is_the_mean_published_coverage_under_the_site() {
    let samples = [
        reading(&[
            ("magic:aurora:coverage", 0.6),
            ("magic:fire:coverage:vein", 1.0),
        ]),
        reading(&[
            ("magic:aurora:coverage", 0.2),
            ("magic:confluence:ember-frost:coverage", 0.5),
        ]),
        // A point outside the published map.
        Vec::new(),
    ];
    let site = StructureSite {
        building_id: crate::Id::from_name("inn"),
        name: Some("The Rowan".into()),
        use_: Some("inn".into()),
        address: Some("3 Drovers' Way".into()),
    };
    let context = site_context(&site, Some(&building(Some(2))), [5.0, 3.0], &samples, &[]);
    let shares: Vec<_> = context
        .magic
        .iter()
        .map(|share| (share.system.as_str(), (share.share * 100.0).round() / 100.0))
        .collect();
    // The vein band is a rule's coverage, not a system's, so it is not a prevalence.
    assert_eq!(
        shares,
        vec![("aurora", 0.4), ("confluence:ember-frost", 0.25)]
    );
    assert_eq!(context.place.street.as_deref(), Some("Drovers' Way"));
    assert_eq!(context.place.ward.as_deref(), Some("Glenfoot"));
    // When the parent's record is gone, the record kept at opening still names the place.
    let kept = site_context(&site, None, [5.0, 3.0], &samples, &[]);
    assert_eq!(kept.place.address.as_deref(), Some("3 Drovers' Way"));
    assert_eq!(kept.place.street, None);
}

#[test]
fn a_raster_layer_of_its_own_names_its_system() {
    let raster = reading(&[("magic:aurora:coverage", 0.6)]);
    let site = StructureSite {
        building_id: crate::Id::from_name("inn"),
        name: None,
        use_: None,
        address: None,
    };
    let context = site_context(&site, None, [0.0, 0.0], &[raster], &[]);
    assert_eq!(context.magic.len(), 1);
    assert_eq!(context.magic[0].system, "aurora");
    assert_eq!(context.magic[0].label, "Aurora");
}

#[test]
fn nearby_magic_features_sort_by_distance_from_the_building() {
    let (well, stone) = (crate::Id::from_name("well"), crate::Id::from_name("stone"));
    let mut near = building(None);
    near.id = well;
    near.kind = "aurora:rime".into();
    near.geometry = Geometry::Point {
        coordinates: Position::xy(8.0, 7.0),
    };
    let mut far = near.clone();
    far.id = stone;
    far.geometry = Geometry::Point {
        coordinates: Position::xy(40.0, 3.0),
    };
    let site = StructureSite {
        building_id: crate::Id::from_name("inn"),
        name: None,
        use_: None,
        address: None,
    };
    let glen = crate::Id::from_name("glen");
    let nearby = [(glen, far), (glen, near)];
    let context = site_context(&site, None, [5.0, 3.0], &[], &nearby);
    let ids: Vec<_> = context.features.iter().map(|f| f.feature_id).collect();
    assert_eq!(ids, vec![well, stone]);
    assert_eq!(context.features[0].distance, 5.0);
}
