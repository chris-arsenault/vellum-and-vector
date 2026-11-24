use super::{Input, State};
use crate::{
    atlas::state::Scope,
    execution::{Command, CommandKind, ExecutionResult},
    features::{network::NetworkWorkspace, FeatureWorkspace},
    field::{schema::NamedBand, Field},
    lattice::TriangularLattice,
};

/// Inputs and geographic output stores for a registered classifier or publisher.
/// The numerical field stays behind the read interface, including its interior-mutable owners.
pub struct Publication<'a> {
    field: &'a Field,
    pub scope: &'a Scope,
    pub template: Option<&'a crate::town::templates::Selection>,
    pub urban: Option<&'a crate::processes::town::urban::Urban>,
    pub features: &'a mut dyn FeatureWorkspace,
    pub networks: &'a mut dyn NetworkWorkspace,
}

impl Publication<'_> {
    pub fn mesh(&self) -> &TriangularLattice {
        self.field.mesh()
    }

    pub fn bands(&self) -> Vec<NamedBand> {
        self.field.bands()
    }
}

pub type Publish = fn(Publication<'_>, &Input) -> ExecutionResult<()>;

pub(super) fn command(id: &str, publish: Publish) -> Command<State, Input> {
    Command::with_inputs(id, CommandKind::Publish, vec![], move |scope, input| {
        let state: &mut State = scope.state_mut();
        // owner-direction(2026-11-23): the orchestrator controls mutability during publication
        publish(
            Publication {
                field: state.physical.executor.state(),
                scope: &state.scope,
                template: state
                    .regional
                    .as_ref()
                    .and_then(|r| r.city.template.as_ref()),
                urban: state.regional.as_ref().map(|r| &r.city.urban),
                features: state.records.features.as_mut(),
                networks: state.records.networks.as_mut(),
            },
            input,
        )
    })
}
