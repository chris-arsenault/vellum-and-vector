use super::{invoke, operations, Context, Feature, Policy};
use crate::{parameters::Values, recipe::Sequence, sequence::SequenceNode};
use std::rc::Rc;

const ECOLOGY: &[(&str, &str)] = &[
    ("initialize.ecology", "atlas.ecology-initialize"),
    ("epoch.ecology-evolve", "atlas.ecology-evolve"),
    ("epoch.ecology-respond", "atlas.ecology-respond"),
    ("epoch.ecology-burial", "atlas.ecology-burial"),
    ("present.ecology", "atlas.ecology-present"),
];
const REGIONAL_ECOLOGY: &[(&str, &str)] = &[
    ("initialize.ecology", "refinement.ecology-initialize"),
    ("epoch.ecology-evolve", "refinement.ecology-develop"),
    ("present.ecology", "refinement.ecology-present"),
];
const MAGIC: &[(&str, &str)] = &[
    ("initialize.influences", "atlas.magic-initialize"),
    ("epoch.climate-forcing", "atlas.magic-climate"),
    ("epoch.material-forcing", "atlas.magic-rocks"),
    ("epoch.post-glacial-forcing", "atlas.magic-post-glacial"),
    ("epoch.influence-history", "atlas.magic-history"),
    ("epoch.coastal-forcing", "atlas.magic-coast"),
    ("present.climate-forcing", "atlas.magic-climate"),
    ("present.post-glacial-forcing", "atlas.magic-post-glacial"),
    ("present.classify", "atlas.magic-classify"),
    ("present.project", "atlas.magic-project"),
];
const REGIONAL_MAGIC: &[(&str, &str)] = &[
    ("epoch.climate-forcing", "refinement.magic-refresh"),
    ("present.climate-forcing", "refinement.magic-refresh"),
    ("epoch.material-forcing", "refinement.magic-react"),
    ("epoch.post-glacial-forcing", "refinement.magic-transport"),
    ("epoch.ecology-burial", "refinement.magic-organic"),
    ("present.classify", "refinement.magic-map"),
];
fn at(entries: &[(&str, &str)], slot: &str) -> Sequence {
    entries
        .iter()
        .find(|(name, _)| *name == slot)
        .map_or_else(Vec::new, |(_, process)| operations(&[process]))
}
fn feature(
    id: &'static str,
    domains: &'static [&'static str],
    entries: &'static [(&str, &str)],
    regional: &'static [(&str, &str)],
) -> Feature {
    let mut slots = Vec::new();
    let mut processes = Vec::new();
    for &(slot, process) in entries.iter().chain(regional) {
        if !slots.contains(&slot) {
            slots.push(slot);
        }
        if !processes.iter().any(|name| name == process) {
            processes.push(process.into());
        }
    }
    Feature {
        id,
        domains,
        requires: &[],
        absent: &[],
        parameters: &[],
        processes,
        native: vec![],
        slots,
        contribute: Rc::new(move |slot, context| {
            at(
                if context.policy == Policy::Regional {
                    regional
                } else {
                    entries
                },
                slot,
            )
        }),
    }
}
pub(super) fn features() -> Vec<Feature> {
    let mut ecology = feature("ecology.living", &["physical"], ECOLOGY, REGIONAL_ECOLOGY);
    ecology.requires = &["physical.climate", "water.routing"];
    ecology.parameters = &["vegetation", "grazing"];
    ecology.processes.push("atlas.ecology-settle".into());
    ecology.contribute = Rc::new(|slot, context| {
        if context.policy == Policy::Regional {
            return at(REGIONAL_ECOLOGY, slot);
        }
        let mut body = if slot == "present.ecology" {
            operations(&["atlas.ecology-settle"])
        } else {
            Vec::new()
        };
        body.extend(at(ECOLOGY, slot));
        body
    });
    let mut magic = feature("magic.configured", &["magic"], MAGIC, REGIONAL_MAGIC);
    magic.processes.push("refinement.magic-water".into());
    magic.slots.push("after.model-pass");
    magic.contribute = Rc::new(|slot, context| {
        if context.policy == Policy::Regional {
            if slot == "after.model-pass" && context.process == Some("atlas.groundwater") {
                return operations(&["refinement.magic-water"]);
            }
            at(REGIONAL_MAGIC, slot)
        } else {
            at(MAGIC, slot)
        }
    });
    let local = Feature {
        id: "magic.local",
        domains: &["magic"],
        requires: &[],
        absent: &[],
        parameters: &[],
        native: vec![],
        processes: [
            "magic.thermal",
            "magic.material",
            "magic.advanceStorage",
            "magic.advection",
            "atlas.atmospheric-climate",
            "refinement.climate",
            "atlas.project-forcing",
            "atlas.forcing",
        ]
        .map(str::to_owned)
        .into(),
        slots: vec![
            "before.model-pass",
            "after.model-pass",
            "epoch.storage",
            "epoch.material-forcing",
        ],
        contribute: Rc::new(local),
    };
    let mut cultures = feature(
        "human.cultures",
        &["cultural"],
        &[("present.people", "human.cultures")],
        &[("present.people", "human.cultures")],
    );
    cultures.parameters = &["cultureCount", "culturalMobility"];
    let mut politics = feature(
        "human.politics",
        &["political"],
        &[("present.people", "human.politics")],
        &[("present.people", "human.politics")],
    );
    politics.parameters = &["polityCount", "politicalReach"];
    let mut built = feature(
        "built.layout",
        &["built"],
        &[("present.people", "built.layout")],
        &[("present.people", "built.layout")],
    );
    built.parameters = &[
        "townThreshold",
        "cityReach",
        "roadTraffic",
        "highways",
    ];
    built
        .slots
        .extend(["town.initialize", "town.develop", "town.publish"]);
    built.processes.extend(
        [
            "town.initialize",
            "town.cultivation",
            "real-scale.settlement",
        ]
        .map(str::to_owned),
    );
    built.processes.extend(
        crate::processes::town::operation_ids()
            .into_iter()
            .map(str::to_owned),
    );
    built.contribute = Rc::new(|slot, context| match slot {
        "town.initialize" => vec![invoke(
            "town.initialize",
            context.selection["built.layout"]
                .configuration
                .clone()
                .unwrap_or_default(),
        )],
        "town.develop" => {
            let mut ids = vec!["town.cultivation"];
            ids.extend(crate::processes::town::operation_ids());
            operations(&ids)
        }
        "town.publish" => operations(&["town.cultivation", "real-scale.settlement"]),
        "present.people" => operations(&["built.layout"]),
        _ => vec![],
    });
    vec![ecology, magic, local, cultures, politics, built]
}
fn flag(process: &str, key: &str, value: bool) -> SequenceNode<crate::recipe::Invocation, Values> {
    invoke(process, Values::from_iter([(key.into(), value.into())]))
}
fn without_standalone() -> SequenceNode<crate::recipe::Invocation, Values> {
    let mut node = flag("atlas.forcing", "includeStandalone", false);
    if let SequenceNode::Process { id, .. } = &mut node {
        *id = "atlas.forcing.without-standalone".into();
    }
    node
}
fn local(slot: &str, context: &Context<'_>) -> Sequence {
    if !context.standalone_magic {
        return Vec::new();
    }
    if context.policy == Policy::Regional {
        if slot == "epoch.material-forcing" {
            return vec![
                invoke("atlas.project-forcing", Values::new()),
                flag("magic.material", "react", true),
                invoke("atlas.forcing", Values::new()),
            ];
        }
        return if slot == "before.model-pass" && context.process == Some("refinement.climate") {
            let mut body = vec![without_standalone()];
            body.extend(operations(&[
                "refinement.climate",
                "atlas.project-forcing",
                "magic.thermal",
                "magic.material",
                "atlas.forcing",
            ]));
            body
        } else {
            Vec::new()
        };
    }
    if slot == "epoch.storage" {
        return operations(&["magic.advanceStorage"]);
    }
    if slot == "after.model-pass" && context.process == Some("atlas.plate-advection") {
        return operations(&["magic.advection"]);
    }
    if slot != "before.model-pass" || context.process != Some("atlas.atmospheric-climate") {
        return Vec::new();
    }
    let mut body = vec![without_standalone()];
    body.extend(operations(&[
        "atlas.atmospheric-climate",
        "atlas.project-forcing",
        "magic.thermal",
    ]));
    if context.material {
        body.push(flag("magic.material", "react", true));
    }
    body.extend(operations(&["atlas.forcing"]));
    body
}
