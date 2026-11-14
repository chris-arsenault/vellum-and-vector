pub mod actions;
pub mod configuration;
use crate::{
    magic::{
        channels::Channel,
        contact::Contact,
        regions::{self, Inputs, Rule},
        sources::Environment,
        state::MagicField,
        veil::strain_at,
    },
    storage::{Band, Coverage, ReadBand},
};
use configuration::ResolvedConfluence;
use std::io;
pub struct State {
    pub definition: usize,
    pub members: Band<f64>,
    pub coverage: Band<f64>,
}
pub struct Workspace {
    pub definitions: Vec<ResolvedConfluence>,
    pub states: Vec<State>,
    pub strain: Band<f64>,
}
impl Workspace {
    pub fn new(definitions: Vec<ResolvedConfluence>, coverage: &mut Coverage) -> Self {
        Self {
            definitions,
            states: vec![],
            strain: coverage.allocate(0.0),
        }
    }
    pub fn evaluate(
        &mut self,
        env: &Environment<'_>,
        fields: &mut [MagicField],
        seed: i32,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.states.clear();
        for cell in 0..env.mesh.len() {
            self.strain.set(cell, 0.0)?;
        }
        for (index, definition) in self.definitions.iter().enumerate() {
            if !definition.enabled {
                continue;
            }
            let participants: Option<Vec<_>> = definition
                .systems
                .iter()
                .map(|id| {
                    fields
                        .iter()
                        .position(|field| field.definition.enabled && &field.definition.id == id)
                })
                .collect();
            let Some(participants) = participants else {
                continue;
            };
            let contacts = participants
                .iter()
                .map(|&index| Contact::new(env, &fields[index], coverage))
                .collect::<io::Result<Vec<_>>>()?;
            let read = |id: &str, cell| {
                definition
                    .systems
                    .iter()
                    .position(|system| system == id)
                    .map_or(Ok(0.0), |index| contacts[index].intensity(cell))
            };
            let input = Inputs {
                field: &fields[participants[0]],
                fields,
                seed,
                system_read: Some(&read),
            };
            let members = regions::grow(
                env,
                &input,
                Rule {
                    seeds: &definition.rule.seeds,
                    retains: definition.rule.retains.as_deref(),
                },
                coverage,
            )?;
            let mut state = State {
                definition: index,
                members,
                coverage: coverage.allocate(0.0),
            };
            let strengths = participants[..2]
                .iter()
                .map(|&index| fields[index].channel(Channel::Intensity))
                .collect::<Vec<_>>();
            occupy(
                env,
                definition,
                &mut state,
                &contacts,
                &strengths,
                &mut self.strain,
            )?;
            for cell in 0..env.mesh.len() {
                if state.members.get(cell)? <= 0.0 {
                    continue;
                }
                for &index in &participants {
                    displace(&mut fields[index], cell, state.coverage.get(cell)?)?;
                }
            }
            self.states.push(state);
        }
        bound_coverage(fields, &mut self.states, env.mesh.len())
    }
}
fn occupy(
    env: &Environment<'_>,
    definition: &ResolvedConfluence,
    state: &mut State,
    contacts: &[Contact],
    strengths: &[ReadBand<f64>],
    strain: &mut Band<f64>,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        if state.members.get(cell)? <= 0.0 {
            continue;
        }
        let mut parents: f64 = f64::INFINITY;
        for contact in contacts {
            parents = parents.min(contact.coverage(cell)?);
        }
        if parents < definition.floor {
            state.members.set(cell, 0.0)?;
            continue;
        }
        let here = strain_at(env, &strengths[0], &strengths[1], cell)?;
        strain.set(cell, strain.get(cell)?.max(here))?;
        state.coverage.set(
            cell,
            parents * (0.25 + here * definition.strain_scale).clamp(0.0, 1.0),
        )?;
    }
    Ok(())
}
fn displace(field: &mut MagicField, cell: usize, taken: f64) -> io::Result<()> {
    let remaining = (1.0 - taken).max(0.0);
    for feature in &mut field.features {
        feature
            .coverage
            .set(cell, feature.coverage.get(cell)? * remaining)?;
    }
    field
        .system_coverage
        .set(cell, field.system_coverage.get(cell)? * remaining)
}
fn bound_coverage(fields: &mut [MagicField], states: &mut [State], count: usize) -> io::Result<()> {
    for cell in 0..count {
        let mut total = 0.0;
        for field in fields.iter() {
            total += field.system_coverage.get(cell)?;
        }
        for state in states.iter() {
            total += state.coverage.get(cell)?;
        }
        if total <= 1.0 {
            continue;
        }
        for field in fields.iter_mut() {
            field
                .system_coverage
                .set(cell, field.system_coverage.get(cell)? / total)?;
            for feature in &mut field.features {
                feature
                    .coverage
                    .set(cell, feature.coverage.get(cell)? / total)?;
            }
        }
        for state in states.iter_mut() {
            state
                .coverage
                .set(cell, state.coverage.get(cell)? / total)?;
        }
    }
    Ok(())
}
