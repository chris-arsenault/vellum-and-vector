//! Existing mapInspectionSections supplied-input cases, without running generation.
use super::*;
use crate::scale::MapScale;

#[test]
fn publishes_ground_valley_and_mixed_rock_descriptions() {
    // hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
    let values = BTreeMap::from([
        ("RockLayerDepth0", MapScale::native(12.0)),
        ("RockLayerSecondaryKind0", 1.0),
        ("RockLayerSecondaryShare0", 0.25),
        ("RockLayerStrength0", 0.8),
        ("RockLayerDamage0", 0.2),
        ("RockLayerFormedMin0", 2.0),
        ("RockLayerFormedMax0", 4.0),
        ("RockCutLayerDepth0", MapScale::native(6.0)),
        ("RockCutLayerKind0", 1.0),
        ("GroundCutShare", 0.4),
        ("GroundCutDepth", MapScale::native(30.0)),
    ]);
    let read = |name: &str| Ok(values.get(name).copied().unwrap_or(0.0));
    let sections = Cell {
        read: &read,
        class_name: &|_, code| Some(format!("Rock {code}")),
        population: false,
        measure: 100.0,
    }
    .sections()
    .unwrap();
    assert_eq!(sections[0].records[0]["Depth"], "30 m");
    assert_eq!(sections[0].records[0]["Share of ground"], "40%");
    assert_eq!(sections[1].records[0]["Thickness"], "12 m");
    assert_eq!(sections[1].records[0]["Fractured"], "20%");
    assert_eq!(sections[1].records[0]["Formed"], "epochs 2–4");
    assert_eq!(sections[2].records[0]["Thickness"], "6 m");
}
#[test]
fn publishes_named_identity_land_use_and_ruins() {
    // hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
    let values = BTreeMap::from([
        ("Population", 20.0),
        ("Farmland", 0.3),
        ("RuinedBuiltUp", 0.1),
        ("RuinCover", 0.5),
        ("IdentityPeople0", 10.0),
        ("IdentityTongue0", 7.0),
        ("IdentityAge0", 100.0),
        ("IdentityHardness0", 0.8),
    ]);
    let read = |name: &str| Ok(values.get(name).copied().unwrap_or(0.0));
    let names = |channel: &str, code: f64| {
        (channel == "IdentityTongue0" && code == 7.0).then(|| "Coast speech".into())
    };
    let sections = Cell {
        read: &read,
        class_name: &names,
        population: true,
        measure: 2e6,
    }
    .sections()
    .unwrap();
    assert_eq!(
        sections[0].records[0]["Value"],
        "20 per km² · about 40 on this cell"
    );
    assert_eq!(
        sections[0].records[5]["Value"],
        "10% of the ground, 50% of them buried or drowned"
    );
    assert_eq!(sections[1].records[0]["Traditions"], "tongue: Coast speech");
    assert_eq!(sections[1].records[0]["Share of people"], "50%");
    assert_eq!(sections[1].records[0]["Age"], "100 years");
    assert_eq!(sections[1].records[0]["Holds against change"], "80%");
}
