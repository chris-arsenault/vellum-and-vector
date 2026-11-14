//! Current reads derive magic and forcing from retained inputs without material work.
use super::{ChannelAccess, Channels};
use crate::{
    field::Field,
    human::HumanField,
    magic::{
        configuration::Phase,
        hallowed::{Seat, Seats, Way},
        sources::{placed::PlacedSource, run::People, Environment},
        workspace::{Activity, Evaluation, Workspace},
    },
    spatial::SpatialKernel,
    storage::Coverage,
    water::Water,
};
use std::io;

pub struct Current<'a> {
    pub seed: i32,
    pub epoch: i32,
    pub phase: Option<Phase>,
    pub activity: &'a [Activity],
    pub placed: &'a [PlacedSource],
    pub space: &'a str,
    pub seats: &'a [Seat],
    pub ways: &'a [Way],
    pub spatial: &'a dyn SpatialKernel,
}
impl Field {
    // The callback is private to this owner. Callers cannot obtain a material environment
    // from an immutable field; these two entry points refresh only current observations.
    fn with_current_magic<T>(
        &self,
        read: impl FnOnce(&mut Environment<'_>, &mut Water, &mut Coverage) -> io::Result<T>,
    ) -> io::Result<T> {
        let mut water = self.water.borrow_mut();
        let view = water.read_only();
        let mut ground = self.ground.borrow_mut();
        read(
            &mut Environment {
                mesh: &self.mesh,
                scale: &self.scale,
                fields: Channels(ChannelAccess::Current(&self.shared)),
                ground: &mut ground,
                water: &view,
                events: &self.events,
            },
            &mut water,
            &mut self.coverage.borrow_mut(),
        )
    }
    pub fn refresh_magic(&self, magic: &mut Workspace, input: &Current<'_>) -> io::Result<()> {
        let tenure = self.people.view(HumanField::Tenure);
        let kept = self.people.view(HumanField::KeptLine);
        let walked = self.people.view(HumanField::WalkedRoute);
        self.with_current_magic(|env, water, coverage| {
            magic.refresh(
                env,
                &Evaluation {
                    seed: input.seed,
                    epoch: input.epoch,
                    phase: input.phase,
                    activity: input.activity,
                    placed: input.placed,
                    space_id: input.space,
                    people: People {
                        seats: Seats {
                            living: input.seats,
                            ways: input.ways,
                            tenure: &tenure,
                        },
                        kept: &kept,
                        walked: &walked,
                    },
                    rivers: &water.river_reader(),
                    kernel: input.spatial,
                },
                coverage,
            )?;
            magic.shared_forcing(env, water, 0.0, coverage)
        })
    }
    pub fn classify_magic(&self, magic: &mut Workspace, seed: i32) -> io::Result<()> {
        self.with_current_magic(|env, water, coverage| {
            magic.classify(
                env,
                &water.river_reader(),
                self.ecology_initialized,
                seed,
                coverage,
            )
        })
    }
    pub fn current_magic_coast(&self, magic: &mut Workspace) -> io::Result<()> {
        self.with_current_magic(|env, _, coverage| {
            crate::magic::feedback::coast::feedback(
                env,
                &magic.fields,
                &magic.meetings,
                &mut magic.forcing,
                coverage,
            )
        })
    }
}
