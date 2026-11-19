#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::atlas::{state::Scope, workspace::inputs::Selection};
use atlas_gis::geometry::NativeGeos;
use atlas_map::{regions::rectangle, Bounds, Id};
use serde_json::json;

#[test]
fn captured_context_can_seed_a_child_margin_without_accepting_unrelated_or_partial_present_fields()
{
    let footprint = rectangle(Bounds(8.0, 8.0, 32.0, 32.0));
    let scope: Scope = serde_json::from_value(json!({
        "world":Id::from_name("world"), "area":Id::from_name("child"), "areaName":"Child",
        "space":Id::from_name("surface"),
        "worldGeography":false, "ownsMapGeography":true, "areaParents":{},
        "domain":rectangle(Bounds(0.0,0.0,100.0,100.0)), "domainBounds":[0,0,100,100],
        "footprint":footprint, "cylindrical":false, "hasBoundary":false,
        "precision":0.000001, "generationDomains":{}, "contracted":[]
    }))
    .unwrap();
    let selection = Selection {
        scope: &scope,
        owned_geography: true,
        reopened: false,
        ancestors: &[],
    };
    let spatial = NativeGeos::new(1e-6).unwrap();
    let parent = rectangle(Bounds(10.0, 10.0, 30.0, 30.0));
    let (child, surface) = (Id::from_name("child"), Id::from_name("surface"));
    assert!(selection.accepts(child, surface, true));
    assert!(selection.supports(true, &parent, &spatial).unwrap());
    assert!(!selection.supports(false, &parent, &spatial).unwrap());
    assert!(!selection.accepts(Id::from_name("sibling"), surface, true));
    assert!(!selection.accepts(child, Id::from_name("another-space"), true));
    assert!(!selection
        .supports(true, &rectangle(Bounds(40.0, 40.0, 50.0, 50.0)), &spatial)
        .unwrap());
    assert!(!selection
        .supports(true, &rectangle(Bounds(32.0, 8.0, 40.0, 32.0)), &spatial)
        .unwrap());
    assert!(selection.supports(false, &footprint, &spatial).unwrap());
}
