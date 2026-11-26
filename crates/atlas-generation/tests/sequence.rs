use atlas_generation::atlas::features::{Catalogue, Context, Policy, Selected, Selection};
use atlas_generation::{bindings::DurationBinding, sequence::*};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn epoch(id: &str, parent: Option<&str>) -> Epoch<bool> {
    Epoch {
        id: id.into(),
        duration: 20.0,
        parent_epoch: parent.map(str::to_owned),
        variables: true,
    }
}

#[test]
fn creator_configuration_binds_owned_settings_before_building_the_sequence() {
    use atlas_generation::atlas::{
        configuration::{self, Frame, Input, Settings},
        resolution::Profile,
    };
    use serde_json::json;
    let settings: Settings = serde_json::from_value(json!({
        "epochs": [{"id": "Present", "tectonics": 1, "hydrology": 1, "ice": 0,
            "coasts": 1, "temperature": 15, "seaLevel": 0}],
        "humanEras": [], "magicSystems": [], "confluences": []
    }))
    .unwrap();
    let mut input: Input = serde_json::from_value(json!({
        "areaId": atlas_map::Id::from_name("world"), "domains": ["physical"], "quality": "draft", "seed": 4,
        "features": {
            "built.layout": {"settings": {"districtCatchmentScale": 2.8}},
            "physical.foundation": {"settings": {"continents": 7}, "configuration": {"profile": {"ContinentalWarpStrength": 0.8}}},
            "physical.lifecycle": {"configuration": {"history": {"plateTravel": [0.9, 0.5, 0.1]}}},
            "ecology.living": {"configuration": {"landscape": {"rainfall": 0.5}}}
        }
    })).unwrap();
    let resolved = configuration::resolve(&input, &settings).unwrap();
    assert_eq!(resolved.parameters.continents, 7.0);
    assert_eq!(resolved.parameters.district_catchment_scale, 2.8);
    assert_eq!(resolved.overrides["ContinentalWarpStrength"], 0.8);
    assert_eq!(resolved.settings.epochs[0].plate_travel, Some(0.1));
    assert_eq!(
        resolved.settings.epochs[0]
            .ecology
            .as_ref()
            .unwrap()
            .rainfall,
        0.5
    );
    assert!(settings.epochs[0].plate_travel.is_none());
    assert!(!resolved.selection["human.cultures"].enabled);
    let recipe = resolved
        .recipe(
            &input,
            &Frame {
                profile: Profile::World,
                regional: false,
                city: false,
                inherited: false,
                landmarks_apply: true,
                standalone_magic: false,
            },
        )
        .unwrap();
    let processes = recipe
        .stages()
        .unwrap()
        .into_iter()
        .filter_map(|stage| match stage.kind {
            StageKind::Process(operation) => Some(operation.process.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(processes.first(), Some(&"atlas.prepare"));
    assert_eq!(processes.last(), Some(&"atlas.names"));
    input
        .features
        .get_mut("physical.foundation")
        .unwrap()
        .settings
        .insert("rainfall".into(), json!(2));
    assert!(configuration::resolve(&input, &settings)
        .err()
        .unwrap()
        .to_string()
        .contains("does not own rainfall"));
}

fn selected_catalogue(catalogue: &Catalogue) -> Selection {
    catalogue
        .features
        .iter()
        .map(|feature| {
            (
                feature.id.to_owned(),
                Selected {
                    enabled: true,
                    ..Default::default()
                },
            )
        })
        .collect()
}
fn contribution_context(selection: &Selection) -> Context<'_> {
    Context {
        selection,
        policy: Policy::Regional,
        refinement: true,
        landmarks_apply: true,
        standalone_magic: false,
        initial: false,
        material: false,
        process: None,
    }
}
#[test]
fn child_sequence_realizes_captured_ground_once_and_selects_local_exposure() {
    use atlas_generation::atlas::regional::sequence::sequence;
    let catalogue = Catalogue::default();
    let mut selected = selected_catalogue(&catalogue);
    for enabled in [true, false] {
        selected.get_mut("physical.mountains").unwrap().enabled = enabled;
        check_child_exposure(&catalogue, &selected);
    }
    selected.get_mut("material.load-response").unwrap().enabled = false;
    let body = sequence(&catalogue, &contribution_context(&selected)).unwrap();
    assert!(!stages(&body).unwrap().iter().any(|stage| matches!(stage.kind, StageKind::Process(p) if p.process == "atlas.crustal-relaxation")));
}
#[test]
fn configured_world_runs_bound_human_history_before_the_next_physical_epoch() {
    use atlas_generation::atlas::{configuration::defaults, sequence::configured};
    let settings = defaults::settings().unwrap();
    let catalogue = Catalogue::default();
    let selected = selected_catalogue(&catalogue);
    let context = Context {
        policy: Policy::World,
        refinement: false,
        ..contribution_context(&selected)
    };
    let sequence = configured(
        &catalogue,
        &context,
        &settings.epochs,
        &settings.human_eras,
        false,
    )
    .unwrap();
    let stages = stages(&sequence).unwrap();
    let mut events = Vec::new();
    for stage in &stages {
        if let StageKind::Process(op) = stage.kind {
            if op.process == "atlas.begin-epoch" || op.process == "human.place-offers" {
                events.push(
                    stage
                        .context
                        .epochs
                        .iter()
                        .map(|e| e.id.as_str())
                        .collect::<Vec<_>>(),
                );
            }
        }
    }
    assert_eq!(
        events,
        [
            vec!["Formation"],
            vec!["Cold age"],
            vec!["Cold age", "Ice age"],
            vec!["Present"],
            vec!["Hearthfall"],
            vec!["Age of Crowns"],
            vec!["Lantern Age"]
        ]
    );
}
#[test]
fn regional_population_is_published_after_the_last_settlement_changes() {
    let catalogue = Catalogue::default();
    let mut selected = selected_catalogue(&catalogue);
    for society in [true, false] {
        for id in ["human.cultures", "human.politics", "built.layout"] {
            selected.get_mut(id).unwrap().enabled = society;
        }
        let body = atlas_generation::atlas::regional::sequence::sequence(
            &catalogue,
            &contribution_context(&selected),
        )
        .unwrap();
        let stages = stages(&body).unwrap();
        let processes: Vec<_> = stages
            .iter()
            .filter_map(|stage| match stage.kind {
                StageKind::Process(p) => Some(p.process.as_str()),
                _ => None,
            })
            .collect();
        let places = processes.iter().position(|&p| p == "refinement.places");
        let population = processes
            .iter()
            .position(|&p| p == "human.population-present");
        assert_eq!(places.is_some(), society);
        assert_eq!(population.is_some(), society);
        if let Some(places) = places {
            assert!(places < population.unwrap());
        }
    }
}
fn check_child_exposure(catalogue: &Catalogue, selected: &Selection) {
    let body = atlas_generation::atlas::regional::sequence::sequence(
        catalogue,
        &contribution_context(selected),
    )
    .unwrap();
    let stages = stages(&body).unwrap();
    let ids = stages
        .iter()
        .filter_map(|stage| match stage.kind {
            StageKind::Process(p) => Some(p.process.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        ids.iter().filter(|id| **id == "refinement.relief").count(),
        1
    );
    let at = |name| ids.iter().position(|id| *id == name).unwrap();
    assert!(at("refinement.context") < at("refinement.relief"));
    assert!(at("refinement.relief") < at("refinement.round"));
    assert!(!ids.contains(&"atlas.refine-relief"));
    assert!(!ids.contains(&"atlas.orogenic-construction"));
    let relaxation = stages
        .iter()
        .filter_map(|stage| match stage.kind {
            StageKind::Process(p) if p.process == "atlas.crustal-relaxation" => Some((stage, p)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(relaxation.len(), 3);
    for (stage, process) in relaxation {
        assert!(stage.context.epochs.is_empty());
        assert_eq!(process.parameters["workSpan"], 1.0 / 3.0);
    }
}
#[test]
fn feature_ownership_keeps_local_magic_hooks_and_world_refinement() {
    let catalogue = Catalogue::default();
    let selected = selected_catalogue(&catalogue);
    let context = Context {
        standalone_magic: true,
        ..contribution_context(&selected)
    };
    let body = catalogue
        .compose(
            "climate.atmosphere",
            "current",
            &context,
            &Default::default(),
        )
        .unwrap();
    let stages = stages(&body).unwrap();
    let processes = stages
        .iter()
        .filter_map(|stage| match stage.kind {
            StageKind::Process(p) => Some(p),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(processes[0].process, "atlas.forcing");
    assert_eq!(processes[0].feature.as_deref(), Some("magic.local"));
    assert_eq!(
        processes.last().unwrap().feature.as_deref(),
        Some("physical.climate")
    );
    let world = Context {
        policy: Policy::World,
        ..context
    };
    let body = catalogue.contribute("terrain.refinement", &world).unwrap();
    assert!(
        matches!(&body[0], SequenceNode::Process { operation, .. } if operation.process == "atlas.refine-relief")
    );
}
fn supplied_sequence() -> Vec<SequenceNode<i32, bool>> {
    vec![SequenceNode::Epochs {
        id: "history".into(),
        epochs: vec![epoch("first", Some("Cold")), epoch("second", None)],
        reset_facts: vec!["response".into()],
        body: vec![SequenceNode::Epochs {
            id: "rounds".into(),
            epochs: vec![epoch("round", None)],
            reset_facts: vec![],
            body: vec![SequenceNode::Process {
                id: "consume".into(),
                operation: 73,
            }],
        }],
    }]
}
#[test]
fn nested_loops_preserve_named_paths_ordinals_and_selected_references() {
    let sequence = supplied_sequence();
    let expanded = stages(&sequence).unwrap();
    let process: Vec<_> = expanded
        .iter()
        .filter(|stage| matches!(stage.kind, StageKind::Process(_)))
        .collect();
    assert_eq!(process.len(), 2);
    assert_eq!(process[0].context.path, ["history", "rounds", "consume"]);
    assert_eq!(process[0].context.epoch_indices, [0, 0]);
    assert_eq!(process[1].context.epoch_indices, [1, 0]);
    assert!(matches!(process[0].kind, StageKind::Process(73)));
}
#[test]
fn explicit_ancestry_binds_physical_clocks_independently_of_loop_ordinals() {
    let sequence = supplied_sequence();
    let expanded = stages(&sequence).unwrap();
    let process: Vec<_> = expanded
        .iter()
        .filter(|stage| matches!(stage.kind, StageKind::Process(_)))
        .collect();
    assert_eq!(
        process[0]
            .context
            .physical_epoch_index(&["Formation".into(), "Cold".into()])
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        process[1]
            .context
            .physical_epoch_index(&["Formation".into(), "Cold".into()])
            .unwrap(),
        None
    );
    assert_eq!(
        DurationBinding::EpochFraction(0.5)
            .years(process[0].context.duration())
            .unwrap(),
        10.0
    );
    assert!(process[0]
        .context
        .physical_epoch_index(&["Formation".into()])
        .is_err());
}
#[test]
fn recipe_validation_rejects_ambiguous_invocations_and_invalid_epoch_inputs() {
    let duplicate: Vec<SequenceNode<(), ()>> = vec![
        SequenceNode::Process {
            id: "same".into(),
            operation: (),
        },
        SequenceNode::Process {
            id: "same".into(),
            operation: (),
        },
    ];
    assert!(matches!(
        stages(&duplicate),
        Err(SequenceError::DuplicateInvocation(_))
    ));
    let empty: Vec<SequenceNode<(), bool>> = vec![SequenceNode::Epochs {
        id: "empty".into(),
        epochs: vec![],
        reset_facts: vec![],
        body: vec![],
    }];
    assert!(matches!(
        stages(&empty),
        Err(SequenceError::InvalidEpochSchedule(_))
    ));
    let mut invalid = epoch("invalid", None);
    invalid.duration = f64::NAN;
    let invalid: Vec<SequenceNode<(), bool>> = vec![SequenceNode::Epochs {
        id: "invalid".into(),
        epochs: vec![invalid],
        reset_facts: vec![],
        body: vec![],
    }];
    assert!(matches!(
        stages(&invalid),
        Err(SequenceError::InvalidEpochDuration(_))
    ));
}

#[test]
fn current_recipe_preserves_feature_epoch_and_explicit_parameter_precedence() {
    use atlas_generation::{parameters::Definitions, recipe::Configuration};
    use serde_json::json;
    let recipe: Configuration = serde_json::from_value(json!({
        "id":"supplied", "version":1, "parameters":{"amount":1,"unrelated":true},
        "inputs":{"features":{"selection":{"physical.supplied":{"settings":{"amount":2}}}}},
        "sequence":[{"kind":"epochs","id":"history","resetFacts":[],
            "epochs":[{"id":"present","duration":20,"parentEpoch":null,
                "variables":{"amount":3,"enabled":true}}],
            "body":[{"kind":"process","id":"apply","process":"supplied","version":"1",
                "feature":"physical.supplied","parameters":{"amount":4},
                "when":{"variable":"enabled","equals":true}}]}]
    }))
    .unwrap();
    let definitions: Definitions = serde_json::from_value(json!({
        "amount":{"type":"number","unit":null,"required":true},
        "optional":{"type":"text","unit":null,"required":true,"nullable":true,"default":null}
    }))
    .unwrap();
    let stages = recipe.stages().unwrap();
    let stage = &stages[1];
    let StageKind::Process(invocation) = stage.kind else {
        panic!("Expected supplied process")
    };
    assert!(invocation.enabled(&stage.context));
    assert_eq!(stage.context.path, ["history", "apply"]);
    let values = recipe
        .invocation_parameters(&definitions, invocation, &stage.context)
        .unwrap();
    assert_eq!(values["amount"], 4);
    assert!(values["optional"].is_null());
    let mut inherited = invocation.clone();
    inherited.parameters.clear();
    assert_eq!(
        recipe
            .invocation_parameters(&definitions, &inherited, &stage.context)
            .unwrap()["amount"],
        3
    );
    inherited.parameters.insert("undeclared".into(), json!(0));
    assert!(recipe
        .invocation_parameters(&definitions, &inherited, &stage.context)
        .is_err());
}
