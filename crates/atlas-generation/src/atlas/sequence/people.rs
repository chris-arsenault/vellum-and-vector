use super::{physical, Catalogue, Context, Epoch, Sequence, Values};
use crate::{
    atlas::{context::HumanEra, features::operations},
    sequence::{Epoch as LoopEpoch, SequenceNode},
};
use std::io;

pub fn people(context: &Context<'_>, epochs: &[Epoch], eras: &[HumanEra]) -> io::Result<Sequence> {
    let earlier = epochs.len().saturating_sub(1);
    let present = eras
        .iter()
        .filter(|era| {
            era.bound_epoch(epochs)
                .is_none_or(|bound| !epochs[..earlier].iter().any(|epoch| epoch.id == bound.id))
        })
        .collect::<Vec<_>>();
    let mut sequence = Vec::new();
    if !present.is_empty() {
        for era in &present {
            era.validate().map_err(io::Error::other)?;
        }
        let mut body = operations(&["human.land-era"]);
        if context.enabled("human.cultures") {
            body.extend(operations(&["human.identity-era"]));
        }
        body.extend(operations(&["human.places", "human.waterworks"]));
        if context.enabled("human.politics") {
            body.extend(operations(&["human.realm-era"]));
        }
        body.extend(operations(&["human.events", "human.magic-era"]));
        sequence.push(SequenceNode::Epochs {
            id: "human-eras".into(),
            reset_facts: Vec::new(),
            body,
            epochs: present
                .into_iter()
                .map(|era| LoopEpoch {
                    id: era.id.clone(),
                    duration: era.years,
                    parent_epoch: None,
                    variables: Values::from_iter([
                        ("mobility".into(), era.mobility.into()),
                        ("politicalCapacity".into(), era.political_capacity.into()),
                    ]),
                })
                .collect(),
        });
        sequence.extend(operations(&["human.water-present", "human.magic-present"]));
    }
    sequence.extend(operations(&["human.population-present"]));
    Ok(sequence)
}
pub fn configured(
    catalogue: &Catalogue,
    context: &Context<'_>,
    epochs: &[Epoch],
    eras: &[HumanEra],
    profile: &str,
    inherited: bool,
) -> io::Result<Sequence> {
    let mut body = operations(&["atlas.prepare"]);
    if profile != "interior" {
        body.extend(physical(catalogue, context, epochs, inherited)?);
    }
    for slot in ["present.products", "present.people", "present.after-people"] {
        if slot == "present.people"
            && !["site", "interior"].contains(&profile)
            && ["human.cultures", "human.politics", "built.layout"]
                .iter()
                .any(|id| context.enabled(id))
        {
            body.extend(people(context, epochs, eras)?);
        }
        body.extend(catalogue.contribute(slot, context)?);
    }
    if body.len() <= 1 {
        return Err(io::Error::other(
            "Choose a generation domain supported by this profile",
        ));
    }
    body.extend(operations(&["atlas.magic-places", "atlas.names"]));
    Ok(body)
}
