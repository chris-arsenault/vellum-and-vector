use super::*;
use crate::field::people::feed::PROVISION;
use serde_json::json;

fn example(id: &str, order: Option<u16>, range: serde_json::Value) -> Definition {
    serde_json::from_value(json!({
        "process": "example", "id": id, "kind": "Algorithm",
        "clock": "Present", "order": order, "required": [],
        "scopes": [{"map": "City", "resolution": range}]
    }))
    .unwrap()
}

#[test]
fn ordered_composition_and_adjacent_intervals() {
    let range = |lo, hi| json!({"above_metres": lo, "through_metres": hi});
    let policies = [
        example("detail", Some(2), range(0, 50)),
        example("prepare", Some(1), range(0, 50)),
        example("coarser", None, range(50, 100)),
    ];
    let site = Site {
        map_type: MapType::City,
        cell_metres: 50.0,
    };
    let names = |cell_metres| {
        at(
            &policies,
            Site {
                cell_metres,
                ..site
            },
            Timing::Present,
        )
        .unwrap()
        .into_iter()
        .map(|p| p.id.as_str())
        .collect::<Vec<_>>()
    };
    assert_eq!(names(50.0), ["prepare", "detail"]);
    assert_eq!(names(50.0_f64.next_up()), ["coarser"]);
    assert!(at(
        &policies,
        Site {
            cell_metres: 101.0,
            ..site
        },
        Timing::Present
    )
    .is_err());
    let overlap = [
        example("a", None, range(0, 50)),
        example("b", Some(1), range(0, 100)),
    ];
    assert!(at(&overlap, site, Timing::Present).is_err());
    let tied = [
        example("a", Some(1), range(0, 50)),
        example("b", Some(1), range(0, 100)),
    ];
    assert!(at(&tied, site, Timing::Present).is_err());
}

#[test]
fn historical_and_present_algorithms_can_share_world_ground() {
    let mut policies = [
        example("history", None, json!("World")),
        example("present", None, json!("World")),
    ];
    policies[0].clock = Some(Timing::Elapsed);
    for definition in &mut policies {
        definition.scopes[0].map = MapType::World;
        definition.validate().unwrap();
    }
    let site = Site {
        map_type: MapType::World,
        cell_metres: 10_000.0,
    };
    assert_eq!(
        at(&policies, site, Timing::Elapsed).unwrap()[0].id,
        "history"
    );
    assert_eq!(
        at(&policies, site, Timing::Present).unwrap()[0].id,
        "present"
    );
}

#[test]
fn preflight_finds_an_interior_gap_and_invalid_child_clock() {
    let mut all = example("current", None, json!("Regional"));
    all.scopes = MapType::ALL
        .iter()
        .map(|&map| Scope {
            map,
            resolution: Some(ScaleBand::Metric(Resolution::POSITIVE)),
            reason: None,
        })
        .collect();
    validate_coverage(std::slice::from_ref(&all)).unwrap();
    all.scopes.retain(|s| s.map != MapType::City);
    let fine = example("fine", None, json!({"above_metres":0, "through_metres":49}));
    let coarse = example(
        "coarse",
        None,
        json!({"above_metres":50, "through_metres":10000}),
    );
    assert!(validate_coverage(&[all, fine, coarse]).is_err());
    let mut child = example("event", None, json!("Regional"));
    child.clock = Some(Timing::Elapsed);
    assert!(child.validate().is_err());
}

#[test]
fn noop_requires_a_reason_for_each_map() {
    let mut noop = json!({
        "process":"town.districts", "id":"noop", "kind":"NoOp", "required":[],
        "scopes":[
            {"map":"World", "resolution":"World", "reason":"Settlements at this scale have numerical extent."},
            {"map":"Region", "resolution":"Regional"}
        ]
    });
    for missing in [serde_json::Value::Null, json!(" "), json!("N/A")] {
        noop["scopes"][1]["reason"] = missing;
        assert!(serde_json::from_value::<Definition>(noop.clone())
            .unwrap()
            .validate()
            .is_err());
    }
    let districts = definitions("town.districts").unwrap();
    let coarse = districts.iter().find(|s| s.kind == Kind::NoOp).unwrap();
    assert_eq!(coarse.scopes.len(), 2);
    assert_ne!(coarse.scopes[0].reason, coarse.scopes[1].reason);
    coarse.validate().unwrap();
}

#[test]
fn the_registry_requires_the_bound_algorithm_and_its_inputs() {
    PROVISION.validate().unwrap();
    let algorithms = PROVISION.strategies;
    let mut owner = PROVISION;
    owner.strategies = &[];
    assert!(owner
        .validate()
        .unwrap_err()
        .to_string()
        .contains("no algorithm binding"));
    // Explicitly omit the outside-market provider from the current provisioning strategy.
    let current = Strategy {
        boundary: Condition::None,
        ..algorithms[1]
    };
    let definition = definitions(owner.catalog_id)
        .unwrap()
        .iter()
        .find(|d| d.id == current.name)
        .unwrap();
    assert!(current
        .validate(definition)
        .unwrap_err()
        .to_string()
        .contains("Boundary"));
}
