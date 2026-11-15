//! The world policy preserves causal epoch order and selected feature hooks.
mod epoch;
mod people;
use super::{
    context::Epoch,
    features::{invoke, operations, Catalogue, Context, Policy},
};
use crate::{
    parameters::Values,
    recipe::Sequence,
    sequence::{Epoch as LoopEpoch, SequenceNode},
};
pub use people::{configured, people};
use std::io;

struct Composition<'a, 'c> {
    catalogue: &'a Catalogue,
    context: &'a Context<'c>,
}
impl Composition<'_, '_> {
    fn group(
        &self,
        slot: &str,
        occurrence: &str,
        initial: bool,
        material: bool,
    ) -> io::Result<Sequence> {
        let context = Context {
            initial,
            material,
            ..self.context.clone()
        };
        self.catalogue.compose(
            slot,
            &format!("{occurrence}/{slot}"),
            &context,
            &Values::from_iter([("initial".into(), initial.into())]),
        )
    }
    fn slots(
        &self,
        slots: &[&str],
        occurrence: &str,
        initial: bool,
        material: bool,
    ) -> io::Result<Sequence> {
        slots.iter().try_fold(Vec::new(), |mut body, slot| {
            body.extend(self.group(slot, occurrence, initial, material)?);
            Ok(body)
        })
    }
    fn contribute(&self, slot: &str) -> io::Result<Sequence> {
        self.catalogue.contribute(slot, self.context)
    }
    fn climate(&self, occurrence: &str, material: bool) -> io::Result<Sequence> {
        self.slots(
            &["climate.ocean", "climate.circulation", "climate.atmosphere"],
            occurrence,
            false,
            material,
        )
    }
    fn drainage(&self, occurrence: &str) -> io::Result<Sequence> {
        self.slots(&["water.runoff", "water.routing"], occurrence, false, false)
    }
    // Arconis: docs/architecture/subsystems.arconis#item=e2 — composes plate drift, mountains, volcanoes, impacts and landmarks.
    fn geology(&self, initial: bool) -> io::Result<Sequence> {
        let occurrence = if initial {
            "formation"
        } else {
            "epoch.geology"
        };
        let mut slots = if initial {
            vec![
                "formation.foundation",
                "formation.mountains",
                "formation.volcanism",
                "formation.impacts",
            ]
        } else {
            vec![
                "epoch.advection",
                "epoch.crust.provinces",
                "epoch.crust.activity",
                "epoch.crust.structure",
            ]
        };
        if !initial {
            if !self.context.enabled("physical.tectonic-history") {
                slots.push("epoch.mountains");
            }
            slots.extend(["epoch.volcanism", "epoch.impacts", "epoch.landmarks"]);
        }
        slots.extend([
            "material.relaxation",
            "material.hillslopes",
            "material.support.before-margins",
            "material.ocean.before-margins",
            "material.margins",
            "material.support.after-margins",
            "material.ocean.after-margins",
        ]);
        if initial {
            slots.extend(["formation.coastal-construction", "formation.ocean.final"]);
        }
        slots.extend(["geology.fractures", "geology.geothermal"]);
        self.slots(&slots, occurrence, initial, false)
    }
    fn peopled(&self, process: &str) -> Sequence {
        if ["human.cultures", "human.politics", "built.layout"]
            .iter()
            .any(|id| self.context.enabled(id))
        {
            operations(&[process])
        } else {
            Vec::new()
        }
    }
}
// Arconis: docs/architecture/subsystems.arconis#item=init — composes world-state setup, where magic and ecology start.
pub fn physical(
    catalogue: &Catalogue,
    context: &Context<'_>,
    epochs: &[Epoch],
    inherited: bool,
) -> io::Result<Sequence> {
    let context = Context {
        policy: Policy::World,
        ..context.clone()
    };
    let c = Composition {
        catalogue,
        context: &context,
    };
    let mut body = operations(&["atlas.initialize", "atlas.absent-physical"]);
    body.extend(c.contribute("initialize.influences")?);
    if inherited {
        let mut refinement = c.contribute("terrain.refinement")?;
        for node in &mut refinement {
            let (SequenceNode::Process { id, .. } | SequenceNode::Epochs { id, .. }) = node;
            *id = format!("refinement/{id}");
        }
        body.extend(refinement);
    } else {
        body.extend(c.geology(true)?);
    }
    body.extend(c.contribute("initialize.ecology")?);
    body.push(SequenceNode::Epochs {
        id: "physical-history".into(),
        reset_facts: Vec::new(),
        epochs: epochs
            .iter()
            .map(|epoch| LoopEpoch {
                id: epoch.id.clone(),
                duration: epoch.duration.unwrap_or(1000.0),
                parent_epoch: Some(epoch.id.clone()),
                variables: Values::from_iter([
                    ("temperature".into(), epoch.temperature.into()),
                    ("seaLevel".into(), epoch.sea_level.into()),
                    ("activity".into(), epoch.tectonics.into()),
                ]),
            })
            .collect(),
        body: c.epoch(inherited)?,
    });
    body.extend(c.climate("present.climate", false)?);
    body.extend(c.contribute("present.climate-forcing")?);
    for (slot, occurrence) in [
        ("water.current", "present.initial-water"),
        ("ice.flow", "present.initial-ice"),
        ("ice.meltwater", "present"),
        ("water.current", "present.meltwater"),
        ("ice.flow", "present.final-ice"),
    ] {
        body.extend(c.group(slot, occurrence, false, false)?);
    }
    body.extend(c.slots(
        &[
            "present.glacial-landforms",
            "present.sea-ice",
            "present.landforms",
            "present.river-geometry",
            "present.floodplains",
            "present.deltas",
            "present.validation",
        ],
        "present",
        false,
        false,
    )?);
    for slot in [
        "present.post-glacial-forcing",
        "present.ecology",
        "present.classify",
    ] {
        body.extend(c.contribute(slot)?);
    }
    body.push(invoke("atlas.project", Values::new()));
    body.extend(c.contribute("present.project")?);
    body.push(invoke("atlas.features", Values::new()));
    Ok(body)
}
