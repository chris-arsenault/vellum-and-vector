//! Current magic queries share the map scope with physical and human owners.
pub mod initialize;
pub mod work;
use super::{context::Epoch, environment::Environment, state::State, terrain::Terrain};
use crate::{
    execution::{Command, CommandKind, Executor, Projection, Query},
    field::Field,
    magic::{configuration::Phase, sources::placed::PlacedSource, workspace::Activity},
};
use std::{io, rc::Rc};

pub struct Inputs {
    pub seed: i32,
    pub epochs: Vec<Epoch>,
    pub placed: Vec<PlacedSource>,
}
impl Inputs {
    pub fn epoch(&self, bound: i32) -> io::Result<i32> {
        if bound >= 0 {
            if bound as usize >= self.epochs.len() {
                return Err(io::Error::other(
                    "Magic evaluation requires a configured physical epoch",
                ));
            }
            Ok(bound)
        } else {
            i32::try_from(self.epochs.len())
                .map(|len| len - 1)
                .map_err(io::Error::other)
        }
    }
    pub fn activity(&self, epoch: i32) -> Vec<Activity> {
        self.epochs
            .get(epoch as usize)
            .and_then(|e| e.magic_activity.as_ref())
            .into_iter()
            .flatten()
            .map(|(system, &multiplier)| Activity {
                system: system.clone(),
                multiplier,
            })
            .collect()
    }
}
pub struct Operations {
    pub current: Query<State, ()>,
    pub climate: Query<State, ()>,
    pub post_glacial: Query<State, ()>,
    pub classify: Query<State, ()>,
    pub coast: Query<State, ()>,
    pub project: Command<State>,
}
impl Operations {
    pub fn new(
        inputs: Rc<Inputs>,
        environment: &Environment,
        terrain: &Terrain,
        projection: &Projection<State, Field>,
    ) -> Self {
        let reading = |name, phase| {
            let input = inputs.clone();
            let ocean = environment.ocean.projected(projection);
            let bathymetry = environment.bathymetry.projected(projection);
            Query::new(name, vec![], move |state: &State, read| {
                if state.physical.magic.is_none() {
                    return Ok(());
                }
                // Read the present coast; atmospheric and ecological fields are preceding inputs.
                read.get(&ocean)?;
                read.get(&bathymetry)?;
                state.refresh_magic(&input, read.invocation().epoch_index, phase)?;
                Ok(())
            })
        };
        let current = reading("magic.current", None);
        let climate = reading("magic.current-climate", Some(Phase::Climate));
        let post_glacial = reading("magic.current-post-glacial", Some(Phase::PostGlacial));
        let seed = inputs.seed;
        let classify = Query::new(
            "atlas.magic-classify",
            vec![current.dependency()],
            move |state: &State, _| {
                if let Some(magic) = &state.physical.magic {
                    state
                        .field()
                        .classify_magic(&mut magic.borrow_mut(), seed)?;
                }
                state.clear_queries();
                Ok(())
            },
        );
        let forcing = terrain.coastal_forcing.projected(projection);
        let coast = Query::new(
            "atlas.magic-coast",
            vec![current.dependency()],
            move |_, read| {
                read.get(&forcing)?;
                Ok(())
            },
        );
        let project = Command::new(
            "atlas.magic-project",
            CommandKind::Publish,
            vec![classify.dependency()],
            |state: &mut State, _| {
                state.project_magic()?;
                Ok(())
            },
        );
        Self {
            current,
            climate,
            post_glacial,
            classify,
            coast,
            project,
        }
    }
    pub fn select(&self, executor: &mut Executor<State>) {
        for query in [
            &self.current,
            &self.climate,
            &self.post_glacial,
            &self.classify,
            &self.coast,
        ] {
            executor.select(query);
        }
    }
}
