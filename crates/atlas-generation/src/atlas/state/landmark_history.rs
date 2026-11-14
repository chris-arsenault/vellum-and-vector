use super::{Scope, State};
use crate::{
    atlas::{history::Cause, landmarks::Inputs},
    field::{
        events::EventKind,
        landmark_ledger::LandmarkRecord,
        landmarks::{
            catalogue::Landmark,
            generation::{self, Counts, Forming},
            lifecycle::Work,
            placement::Tracking,
            roster::Identity,
        },
    },
    tectonics::fracture::Plume,
};
use std::io;

fn extent<'a>(scope: &'a Scope, input: &Inputs) -> generation::Scope<'a> {
    generation::Scope {
        identity: Identity {
            world: &scope.world,
            area: &scope.area,
            space: &scope.space,
        },
        footprint: &scope.footprint,
        epochs: input.epochs.len(),
        regional: input.has_parent,
    }
}
fn describe(record: &LandmarkRecord) -> String {
    let measures = record
        .target
        .iter()
        .map(|(key, target)| {
            let measured = record
                .measured
                .get(key)
                .filter(|v| v.is_finite())
                .map_or_else(|| "latent".into(), |value| format!("{value:.0}"));
            format!("{key} {measured}/{target}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} {}: {measures}", record.kind, record.id)
}
impl State {
    fn landmark_drift(&self, input: &Inputs) -> io::Result<Vec<f64>> {
        let drift = self
            .physical
            .settings
            .profile
            .values()
            .get("PlateDriftPerMyr")
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| io::Error::other("Landmark tracking requires PlateDriftPerMyr"))?;
        Ok(generation::drift_steps(
            drift,
            &input.epochs,
            input.tectonic_history,
        ))
    }
    fn landmark_plumes(&self) -> Vec<Plume> {
        self.field()
            .events()
            .iter()
            .filter(|event| event.kind == EventKind::Plume)
            .map(|event| Plume {
                position: [event.x, event.y],
                radius: event.radius,
                strength: event.strength,
            })
            .collect()
    }
    pub fn site_landmarks(&mut self, input: &Inputs, epoch: usize) -> io::Result<Vec<String>> {
        if input.has_parent {
            return Ok(Vec::new());
        }
        let scope = extent(&self.scope, input);
        let physical = &mut self.physical;
        if physical.landmark_roster.is_none() {
            let selected =
                generation::selected(&physical.landmarks, &scope, self.spatial.as_ref())?;
            let magic = physical.magic.as_ref().map(|magic| magic.borrow());
            let enabled = magic
                .iter()
                .flat_map(|magic| &magic.fields)
                .filter(|field| field.definition().enabled)
                .map(|field| field.definition().id.as_str())
                .collect::<Vec<_>>();
            physical.landmark_roster = Some(generation::roster(
                &physical.landmarks,
                &selected,
                &scope,
                Counts {
                    landscape: input.parameters.landscape_landmarks,
                    magic: input.parameters.magic_landmarks,
                },
                &enabled,
                input.seed,
            )?);
        }
        let drift = self.landmark_drift(input)?;
        let plumes = self.landmark_plumes();
        let physical = &mut self.physical;
        generation::site_forming(
            physical.executor.state(),
            &mut physical.landmarks,
            physical
                .landmark_roster
                .as_mut()
                .expect("Roster was initialized"),
            &Forming {
                scope,
                seed: input.seed,
                tracking: Tracking {
                    drift: &drift,
                    epoch,
                    plumes: &plumes,
                    kernel: self.spatial.as_ref(),
                },
            },
        )
    }
    pub fn landmark_work(
        &self,
        input: &Inputs,
        epoch: usize,
        maintenance: bool,
    ) -> io::Result<Vec<Work>> {
        let scope = extent(&self.scope, input);
        let selected =
            generation::selected(&self.physical.landmarks, &scope, self.spatial.as_ref())?;
        let drift = self.landmark_drift(input)?;
        let plumes = self.landmark_plumes();
        let mut scene = self.landmark_scene();
        if let Some(magic) = &self.physical.magic {
            let magic = magic.borrow();
            for system in &mut scene.systems {
                let definition = magic
                    .fields
                    .iter()
                    .find(|field| field.definition().id == system.id)
                    .expect("Scene contains current magic fields")
                    .definition();
                system.activity = if definition.enabled {
                    definition.strength
                        * input
                            .epochs
                            .get(epoch)
                            .and_then(|e| e.magic_activity.as_ref())
                            .and_then(|activity| activity.get(&system.id))
                            .copied()
                            .unwrap_or(1.0)
                } else {
                    0.0
                };
            }
        }
        Ok(selected
            .into_iter()
            .map(|i| &self.physical.landmarks[i])
            .filter(|landmark| {
                if maintenance {
                    landmark.emplaced_at_epoch <= epoch as i32
                } else {
                    landmark.emplaced_at_epoch == epoch as i32
                }
            })
            .map(|landmark| Work {
                landmark: landmark.clone(),
                epoch,
                drift: drift.clone(),
                plumes: plumes.clone(),
                scene: scene.clone(),
            })
            .collect())
    }
    pub fn record_landmark_cause(
        &mut self,
        landmark: &Landmark,
        maintenance: bool,
        before: f64,
        sited: bool,
    ) {
        let Some(record) = self
            .field()
            .landmark_ledger()
            .iter()
            .find(|r| r.id == landmark.id)
        else {
            return;
        };
        let label = if landmark.name.is_empty() {
            landmark.kind.label().to_lowercase()
        } else {
            landmark.name.clone()
        };
        let description = if maintenance {
            format!(
                "{label} held: {}; correction {:.1} m this epoch.",
                describe(record),
                record.maintenance - before
            )
        } else {
            format!(
                "{}{label} formed: {}.{}",
                if sited { "The generator sited a " } else { "" },
                describe(record),
                if record.notes.is_empty() {
                    String::new()
                } else {
                    format!(" {}", record.notes.join(" "))
                }
            )
        };
        self.causes.push(Cause::Domain {
            process: if maintenance {
                "landmark.maintain"
            } else {
                "landmark.emplace"
            }
            .into(),
            subjects: vec![landmark.id.clone()],
            description,
        });
    }
}
