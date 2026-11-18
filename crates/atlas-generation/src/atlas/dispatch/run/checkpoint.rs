use super::Run;
use crate::{
    checkpoint::{Archive, Point},
    sequence::StageKind,
};
use std::io;

impl Run<'_> {
    // owner-direction(2026-11-15): limited checkpoints only; do not chase arbitrary resume points.
    pub(crate) fn checkpoint_point(&self) -> Option<Point> {
        self.point_at(self.next)
    }

    fn point_at(&self, next: usize) -> Option<Point> {
        if next == self.stages.len() {
            return Some(Point::Publication);
        }
        let stage = &self.stages[next];
        if matches!(stage.kind, StageKind::EpochStart(_))
            && stage.context.path == ["physical-history"]
            && stage.context.epoch_indices == [0]
        {
            return Some(Point::WorldFormation);
        }
        if let StageKind::Process(call) = &stage.kind {
            if call.process == "refinement.round"
                && stage.context.path == ["round-1/refinement.round"]
            {
                return Some(Point::RegionalDetail);
            }
        }
        let previous = self.stages.get(next.checked_sub(1)?)?;
        if matches!(previous.kind, StageKind::EpochEnd) && previous.context.epochs.len() == 1 {
            let epoch = previous.context.epochs[0].id.clone();
            match previous.context.path.first()?.as_str() {
                "physical-history" => return Some(Point::PhysicalEpoch { epoch }),
                "human-eras" => return Some(Point::HumanEra { era: epoch }),
                _ => {}
            }
        }
        self.regional_round_at(next)
    }

    fn regional_round_at(&self, next: usize) -> Option<Point> {
        let previous = self.stages.get(next.checked_sub(1)?)?;
        let stage = self.stages.get(next)?;
        let path = previous.context.path.first()?;
        let (round, rest) = path.strip_prefix("round-")?.split_once('/')?;
        if !rest.starts_with("final-courses/") && !rest.starts_with("town-development/") {
            return None;
        }
        let round = round.parse().ok()?;
        if stage.context.path.first().is_some_and(|path| {
            path.starts_with(&format!("round-{round}/final-courses/"))
                || path.starts_with(&format!("round-{round}/town-development/"))
        }) {
            return None;
        }
        Some(Point::RegionalRound { round })
    }

    pub(crate) fn checkpoint(&mut self, archive: &mut Archive<'_>) -> io::Result<()> {
        let mut point = self.checkpoint_point().unwrap_or(Point::Publication);
        archive.value("point", &mut point)?;
        if archive.loading() {
            self.next = (0..=self.stages.len())
                .find(|&next| self.point_at(next).as_ref() == Some(&point))
                .ok_or_else(|| {
                    io::Error::other("Checkpoint boundary is absent from the current schedule")
                })?;
        } else if self.checkpoint_point().as_ref() != Some(&point) {
            return Err(io::Error::other(
                "The schedule is not at a supported checkpoint",
            ));
        }
        self.products.checkpoint(archive)?;
        archive.value("epoch-parents", &mut *self.parents.borrow_mut())?;
        if !self.parents.borrow().is_empty() {
            return Err(io::Error::other("Checkpoint cannot be inside an epoch"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        atlas::{
            dispatch::{run::Settings, Registry},
            features::invoke,
        },
        parameters::Values,
        products::ProductLedger,
        recipe::Configuration,
        sequence::{Epoch, SequenceNode},
    };

    #[test]
    fn checkpoints_exclude_processes_and_nested_epochs() {
        let epoch = |id: &str| Epoch {
            id: id.into(),
            duration: 1.0,
            parent_epoch: None,
            variables: Values::new(),
        };
        let configuration = Configuration {
            id: "supplied".into(),
            version: 1,
            parameters: Values::new(),
            inputs: Values::new(),
            sequence: vec![
                invoke("formation", Values::new()),
                SequenceNode::Epochs {
                    id: "physical-history".into(),
                    reset_facts: vec![],
                    epochs: vec![epoch("first"), epoch("second")],
                    body: vec![
                        invoke("physical", Values::new()),
                        SequenceNode::Epochs {
                            id: "nested".into(),
                            reset_facts: vec![],
                            epochs: vec![epoch("nested")],
                            body: vec![invoke("nested-work", Values::new())],
                        },
                    ],
                },
                invoke("finish", Values::new()),
            ],
        };
        let registry = Registry::default();
        let run = Run {
            configuration: &configuration,
            registry: &registry,
            stages: configuration.stages().unwrap(),
            settings: Settings {
                seed: String::new(),
                seed_scope: String::new(),
                physical_seed: 0,
                epochs: vec![],
            },
            next: 0,
            products: ProductLedger::new(vec![], vec![]).unwrap(),
            parents: Default::default(),
        };
        let points = (0..=run.stages.len())
            .filter_map(|next| run.point_at(next))
            .collect::<Vec<_>>();
        assert_eq!(
            points,
            vec![
                Point::WorldFormation,
                Point::PhysicalEpoch {
                    epoch: "first".into()
                },
                Point::PhysicalEpoch {
                    epoch: "second".into()
                },
                Point::Publication
            ]
        );
    }
}
