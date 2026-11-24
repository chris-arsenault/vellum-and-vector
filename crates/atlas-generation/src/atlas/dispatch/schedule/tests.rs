use super::*;
use crate::{
    atlas::{
        dispatch::{specifications::Catalogue, Feedback, Process, Registry},
        features::invoke,
        state::State,
    },
    execution::{Command, CommandKind},
    parameters::Values,
    processes::strategies::MapType,
    recipe::Sequence,
    sequence::{Epoch, SequenceNode},
};

const REGION: Site = Site {
    map_type: MapType::Region,
    cell_metres: 500.0,
};

fn configuration(sequence: Sequence) -> Configuration {
    Configuration {
        id: "dispatch".into(),
        version: 1,
        parameters: Values::new(),
        sequence,
        inputs: Values::new(),
    }
}

fn calls(ids: &[&str]) -> Configuration {
    configuration(ids.iter().map(|id| invoke(id, Values::new())).collect())
}

fn specification(id: &str, schedule: Schedule) -> Specification {
    Specification::new(id, "", "", true).scheduled("people", schedule)
}

fn semantic(id: &'static str, schedule: Schedule) -> Specification {
    use crate::{atlas::dispatch::SemanticRegistration, field::people::feed};
    let mut specification = SemanticRegistration {
        owner: feed::PROVISION,
        module: "people",
        schedule,
        requires: "",
        produces: "",
    }
    .specification();
    specification.contract.id = id.into();
    specification
}

fn catalogue(specifications: Vec<Specification>) -> Catalogue {
    let mut registry = Catalogue::default();
    registry.extend(specifications).unwrap();
    registry
}

fn ids<'a>(stages: &[Stage<'a>]) -> Vec<&'a str> {
    stages
        .iter()
        .filter_map(|stage| match stage.kind {
            StageKind::Process(call) => Some(call.process.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn keeps_legacy_callers_in_recipe_order_and_schedules_explicit_stages() {
    let registry = catalogue(vec![
        specification("setup", Schedule::default()),
        specification(
            "settle",
            Schedule {
                stage: Some("settlement"),
                after: &["source"],
                ..Schedule::default()
            },
        ),
        specification(
            "source",
            Schedule {
                stage: Some("supply"),
                ..Schedule::default()
            },
        ),
        specification(
            "report",
            Schedule {
                stage: Some("supply"),
                order: 1,
                ..Schedule::default()
            },
        ),
        specification("finish", Schedule::default()),
    ]);
    let recipe = calls(&["setup", "settle", "report", "source", "finish"]);
    let compiled = stages(&recipe, &registry, REGION).unwrap();
    assert_eq!(
        ids(&compiled),
        ["setup", "source", "report", "settle", "finish"]
    );
    assert_eq!(compiled[0].context.path, ["setup"]);
    assert_eq!(compiled[4].context.path, ["finish"]);
}

#[test]
fn legacy_entries_keep_owner_identity_and_duplicate_registrations_fail() {
    let mut registry = Registry::default();
    let make = || {
        Process::unit(
            specification("old", Schedule::default()),
            Command::<State>::new("owner.old", CommandKind::Work, vec![], |_, _| Ok(())),
        )
    };
    registry.register(make()).unwrap();
    assert!(registry.register(make()).is_err());
    let entry = registry.inventory().next().unwrap();
    assert_eq!(entry.1, "owner.old");
    let Category::LegacyUnmigrated(legacy) = entry.0.category else {
        panic!("registered legacy entry")
    };
    assert!(legacy.declared_at.file().ends_with("schedule/tests.rs"));
    let recipe = calls(&["old"]);
    let compiled = stages(&recipe, &registry, REGION).unwrap();
    assert_eq!(ids(&compiled), ["old"]);
    let publication = Process::unit(
        specification("invalid", Schedule::default()).publication(),
        Command::<State>::new("owner.publish", CommandKind::Publish, vec![], |_, _| Ok(())),
    );
    assert!(registry.register(publication).is_err());
    registry
        .register(Process::publication(
            specification("derived", Schedule::default()),
            |_, _| Ok(()),
        ))
        .unwrap();
}

#[test]
fn feedback_is_ordered_bounded_and_spatial() {
    let feedback = Some(Feedback {
        name: "provision",
        iterations: 3.try_into().unwrap(),
    });
    let member = |id, order, after| {
        semantic(
            id,
            Schedule {
                stage: Some("need and supply"),
                feedback,
                order,
                after,
            },
        )
    };
    let registry = catalogue(vec![
        member("need", 0, &["supply"]),
        member("supply", 1, &["need"]),
    ]);
    let recipe = calls(&["supply", "need"]);
    let compiled = stages(&recipe, &registry, REGION).unwrap();
    assert_eq!(
        ids(&compiled),
        ["need", "supply", "need", "supply", "need", "supply"]
    );
    assert!(compiled
        .iter()
        .all(|stage| stage.context.duration().is_none()));
    assert_eq!(compiled[4].context.path, ["need", "feedback-provision/3"]);
    let elapsed = configuration(vec![SequenceNode::Epochs {
        id: "history".into(),
        reset_facts: Vec::new(),
        body: recipe.sequence,
        epochs: vec![Epoch {
            id: "elapsed".into(),
            duration: 1.0,
            variables: Values::new(),
            parent_epoch: None,
        }],
    }]);
    assert!(
        matches!(stages(&elapsed, &registry, REGION), Err(ExecutionError::Failed(message)) if message.contains("nonhistorical"))
    );
}

#[test]
fn repeated_feedback_resolves_dependencies_within_each_occurrence() {
    let schedule = |after, order| Schedule {
        stage: Some("settle"),
        after,
        order,
        feedback: Some(Feedback {
            name: "settlement",
            iterations: 2.try_into().unwrap(),
        }),
    };
    let registry = catalogue(vec![
        semantic("people", schedule(&["food"], 1)),
        semantic("food", schedule(&["people"], 0)),
        specification("land", Schedule::default()),
    ]);
    let occurrence = |id: &str, label: &str| {
        let SequenceNode::Process { operation, .. } = invoke(id, Values::new()) else {
            unreachable!()
        };
        SequenceNode::Process {
            id: format!("{label}/{id}"),
            operation,
        }
    };
    let recipe = configuration(vec![
        occurrence("people", "before"),
        occurrence("food", "before"),
        invoke("land", Values::new()),
        occurrence("people", "after"),
        occurrence("food", "after"),
    ]);
    let compiled = stages(&recipe, &registry, REGION).unwrap();
    assert_eq!(
        ids(&compiled),
        ["food", "people", "food", "people", "land", "food", "people", "food", "people"]
    );
    assert_eq!(
        compiled[5].context.path,
        ["after/food", "feedback-settlement/1"]
    );
}

#[test]
fn rejects_missing_duplicate_and_cyclic_dependencies() {
    let recipe = calls(&["a", "b"]);
    for (a, b, error) in [
        (&["unknown"][..], &[][..], "missing dependency"),
        (&["b", "b"][..], &[][..], "duplicate dependency"),
        (&["b"][..], &["a"][..], "Dependency cycle"),
    ] {
        let registry = catalogue(vec![
            specification(
                "a",
                Schedule {
                    after: a,
                    ..Schedule::default()
                },
            ),
            specification(
                "b",
                Schedule {
                    after: b,
                    ..Schedule::default()
                },
            ),
        ]);
        assert!(
            matches!(stages(&recipe, &registry, REGION), Err(ExecutionError::Failed(message)) if message.contains(error))
        );
    }
}

#[test]
fn semantic_strategy_has_explicit_inactivity_at_the_same_resolution() {
    let spec = semantic("present", Schedule::default());
    let recipe = calls(&["present"]);
    let recipe = recipe.stages().unwrap();
    let stage = &recipe[0];
    assert_eq!(
        spec.strategy(
            Site {
                cell_metres: 50.0,
                ..REGION
            },
            stage
        )
        .unwrap()[0]
            .time,
        EffectTime::SpatialIteration
    );
    assert!(!spec
        .active(
            Site {
                map_type: MapType::Street,
                cell_metres: 50.0
            },
            stage
        )
        .unwrap());
}

#[test]
fn production_recipes_keep_each_registered_caller_and_epoch_boundary() {
    use crate::atlas::{
        configuration::defaults,
        features::{Catalogue as Features, Context, Policy, Selected},
        regional,
        resolution::{Profile, Quality},
        sequence,
    };
    let defaults = defaults::settings().unwrap();
    let features = Features::default();
    let selection = features
        .features
        .iter()
        .map(|feature| {
            (
                feature.id.into(),
                Selected {
                    enabled: true,
                    ..Selected::default()
                },
            )
        })
        .collect();
    let world = Context {
        selection: &selection,
        policy: Policy::World,
        refinement: false,
        landmarks_apply: true,
        standalone_magic: false,
        initial: false,
        material: false,
        process: None,
    };
    let region = Context {
        policy: Policy::Regional,
        refinement: true,
        ..world.clone()
    };
    let world_site = Site {
        map_type: MapType::World,
        cell_metres: Quality::Draft.cell_span(Profile::World).unwrap(),
    };
    let configurations = [
        (
            false,
            world_site,
            sequence::configured(
                &features,
                &world,
                &defaults.epochs,
                &defaults.human_eras,
                false,
            )
            .unwrap(),
        ),
        (
            true,
            REGION,
            regional::sequence::sequence(&features, &region).unwrap(),
        ),
    ];
    for (regional, site, recipe) in configurations {
        let registry = Catalogue::atlas(
            &selection,
            &defaults.magic_systems,
            &BTreeSet::new(),
            &BTreeSet::new(),
            regional,
        )
        .unwrap();
        let recipe = configuration(recipe);
        let original = recipe.stages().unwrap();
        let compiled = stages(&recipe, &registry, site).unwrap();
        let occurrences = |stages: Vec<Stage<'_>>| {
            stages
                .into_iter()
                .filter_map(|stage| {
                    let mut path = stage.context.path.clone();
                    if path
                        .last()
                        .is_some_and(|part| part.starts_with("feedback-"))
                    {
                        if !path.pop()?.ends_with("/1") {
                            return None;
                        }
                    }
                    Some((path, stage.context.duration()))
                })
                .collect::<Vec<_>>()
        };
        if regional {
            let gathering = ids(&compiled)
                .into_iter()
                .filter(|id| *id == "human.land.gather")
                .count();
            assert_eq!(gathering, 9);
        }
        assert_eq!(occurrences(original), occurrences(compiled));
    }
}
