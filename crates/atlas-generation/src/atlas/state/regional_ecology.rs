use super::State;
use crate::{
    atlas::{context::EcologyEpoch, environment::Environment, parameters::AtlasParameters},
    ecology::lifecycle::{Authority, Development, Fixed},
    execution::{CommandContext, ExecutionResult, Projection},
    features::{FeatureSelection, State as FeatureState},
    field::{
        ecology,
        poi::map_records::MapState,
        refinement::{people::DEVELOPMENT_EXPOSURE, seats},
        Field,
    },
    processes::runner::PhysicalContext,
};
use std::{io, rc::Rc};

pub(super) fn habitat_dependencies(
    environment: &Environment,
) -> Vec<crate::execution::QueryDependency<crate::field::Field>> {
    [
        &environment.atmosphere,
        &environment.bathymetry,
        &environment.river_heat,
        &environment.floodplains,
        &environment.deltas,
    ]
    .map(|q| q.dependency())
    .into()
}
impl State {
    pub fn regional_ecology_authority(&self, fixed: Vec<Fixed>) -> io::Result<Authority> {
        let field = self.field();
        let chart = self.chart();
        let mut woodland = Vec::new();
        for feature in self.records.features.values(FeatureSelection {
            area_id: Some(&self.scope.area),
            kind: Some("forest"),
            ..Default::default()
        })? {
            let feature = feature?;
            if feature.state == FeatureState::Generated {
                continue;
            }
            woodland.push(feature.geometry);
        }
        let mut authority =
            field.ecology_authority(&woodland, self.spatial.as_ref(), Some(&chart))?;
        authority.fixed = fixed;
        Ok(authority)
    }
    pub fn prepare_regional_ecology(&mut self, seed: i32) -> ExecutionResult<()> {
        self.require_regional()?;
        self.physical
            .executor
            .run_with(&ecology::prepare_child(), &seed)
    }
    pub fn develop_regional_ecology(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        environment: &Environment,
        context: Rc<PhysicalContext>,
        input: &RegionalEcology<'_>,
    ) -> ExecutionResult<()> {
        let state = scope.state();
        let regional = state.require_regional()?;
        let exposure = regional
            .round
            .checked_sub(1)
            .and_then(|i| DEVELOPMENT_EXPOSURE.get(i))
            .copied()
            .unwrap_or(0.0);
        if exposure <= 0.0 {
            return Ok(());
        }
        let forcing = state.field().ecological_forcing(
            state
                .physical
                .magic
                .as_ref()
                .map(|magic| magic.borrow())
                .as_deref()
                .map_or(&[], |m| m.fields.as_slice()),
            input.parameters,
            input.epoch,
        )?;
        let seats = regional
            .evidence
            .seats
            .iter()
            .map(|s| s.cell)
            .collect::<Vec<_>>();
        let radius = seats::radius(regional.parent_span, state.field().scale().cells(1.0));
        let spatial = state.spatial.clone();
        let work = ecology::RegionalDevelopment {
            development: Development {
                exposure,
                land_million_years: input.land_million_years,
                land_share: 1.0 / DEVELOPMENT_EXPOSURE.len() as f64,
                seed: input.seed,
                round: i32::try_from(regional.round).map_err(io::Error::other)?,
            },
            forcing: &forcing,
            authority: input.authority,
            seats: &seats,
            seat_radius: radius,
            spatial: spatial.as_ref(),
        };
        scope.project(field).run_with_context(
            &ecology::develop_child(habitat_dependencies(environment)),
            &work,
            context,
        )?;
        Ok(())
    }
    pub fn present_regional_ecology(
        &mut self,
        environment: &Environment,
        context: Rc<PhysicalContext>,
    ) -> ExecutionResult<()> {
        self.require_regional()?;
        let query = ecology::classify_child(habitat_dependencies(environment));
        self.physical.executor.select(&query);
        self.physical.executor.query_with_context(&query, context)?;
        Ok(())
    }
}
pub struct RegionalEcology<'a> {
    pub seed: i32,
    pub parameters: &'a AtlasParameters,
    pub epoch: &'a EcologyEpoch,
    pub land_million_years: f64,
    pub authority: &'a Authority,
}
