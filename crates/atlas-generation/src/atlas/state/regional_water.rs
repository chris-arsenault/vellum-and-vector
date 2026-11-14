use super::State;
use crate::{
    atlas::environment::Environment,
    execution::{CommandContext, ExecutionResult, Projection},
    field::{water::network::RiverEvolution, Field},
    processes::runner::PhysicalContext,
    storage::ReadBand,
};
use std::{io, rc::Rc};

impl State {
    /// Match naturalBand: capture once at the first explicit initialization occurrence.
    pub fn captured_small_channels(&mut self) -> io::Result<ReadBand<f64>> {
        if self.require_regional()?.small_channel_length.is_none() {
            let captured = self.field().capture_small_channel_length()?;
            self.regional.as_mut().unwrap().small_channel_length = Some(captured);
        }
        Ok(self
            .require_regional()?
            .small_channel_length
            .as_ref()
            .unwrap()
            .clone())
    }
    pub fn route_regional_water(
        &mut self,
        environment: &Environment,
        context: Rc<PhysicalContext>,
    ) -> ExecutionResult<()> {
        self.require_regional()?;
        self.physical
            .executor
            .query_with_context(&environment.rivers, context)?;
        self.read_regional_drainage()?;
        Ok(())
    }
    pub fn read_regional_drainage(&self) -> io::Result<()> {
        *self.require_regional()?.drainage.borrow_mut() = Some(self.field().regional_drainage()?);
        Ok(())
    }
    pub fn derive_regional_divides(&self) -> io::Result<()> {
        let drainage = self.require_regional()?.drainage.borrow();
        self.field()
            .regional_divides(drainage.as_ref().ok_or_else(|| {
                io::Error::other("Read current drainage before classifying regional landforms")
            })?)
    }
    /// Only the explicit initialization occurrence supplies captured latent channels.
    pub fn evolve_regional_water(
        scope: &mut CommandContext<'_, Self>,
        field: &Projection<Self, Field>,
        environment: &Environment,
        context: Rc<PhysicalContext>,
        channel_length: Option<ReadBand<f64>>,
    ) -> ExecutionResult<()> {
        scope.state().require_regional()?;
        scope.project(field).run_with_context(
            &environment.river_evolution,
            &RiverEvolution { channel_length },
            context.clone(),
        )?;
        scope
            .project(field)
            .query_with_context(&environment.rivers, context)?;
        scope.state().read_regional_drainage()?;
        Ok(())
    }
    pub fn refresh_regional_ocean(
        &self,
        environment: &Environment,
        context: Rc<PhysicalContext>,
    ) -> ExecutionResult<()> {
        self.require_regional()?;
        self.physical
            .executor
            .query_with_context(&environment.ocean, context)?;
        Ok(())
    }
    pub fn classify_regional_landforms(
        &self,
        environment: &Environment,
        context: Rc<PhysicalContext>,
    ) -> ExecutionResult<()> {
        self.derive_regional_divides()?;
        self.physical
            .executor
            .query_with_context(&environment.landforms, context)?;
        self.mark_place_landforms()
    }
}
