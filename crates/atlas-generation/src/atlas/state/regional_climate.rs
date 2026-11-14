use super::State;
use crate::{
    atlas::environment::Environment,
    execution::ExecutionResult,
    field::{climate::regional::Capture, forcing, refinement::media::Media},
    processes::runner::PhysicalContext,
};
use std::{io, rc::Rc};

impl State {
    pub fn contribute_external_heat(&mut self, include_standalone: bool) -> ExecutionResult<()> {
        self.physical.executor.run_with(
            &forcing::replace_heat(),
            &forcing::Heat {
                surface: &self.physical.surface,
                include_standalone,
                magic: self
                    .physical
                    .magic
                    .as_ref()
                    .map(|m| m.borrow().forcing.heat.read_only()),
            },
        )
    }
    pub fn prepare_regional_climate(&mut self) -> ExecutionResult<()> {
        if self.require_regional()?.climate.is_some() {
            return Ok(());
        }
        let capture = Capture::new(self.field(), &self.physical.settings.climate)?;
        self.regional.as_mut().unwrap().climate = Some(capture);
        self.contribute_external_heat(true)
    }
    pub fn derive_regional_media(
        &mut self,
        environment: &Environment,
        context: Rc<PhysicalContext>,
    ) -> ExecutionResult<()> {
        let regional = self.require_regional()?;
        if regional.network.is_none() {
            return Ok(());
        }
        self.physical
            .executor
            .query_with_context(&environment.distance, context)?;
        self.refresh_regional_media()?;
        Ok(())
    }
    pub fn refresh_regional_media(&self) -> io::Result<()> {
        let regional = self.require_regional()?;
        if regional.network.is_none() {
            return Ok(());
        }
        let media = Media::derive(
            self.field(),
            regional.parent_span,
            &self.physical.settings.climate.latitude(),
        )?;
        *regional.media.borrow_mut() = Some(media);
        Ok(())
    }
    pub fn respond_regional_climate(&self) -> io::Result<()> {
        let regional = self.require_regional()?;
        let capture = regional.climate.as_ref().ok_or_else(|| {
            io::Error::other(
                "Capture the inherited atmosphere before responding to regional terrain",
            )
        })?;
        capture.respond(
            self.field(),
            &self.physical.settings.climate,
            &regional.inherited_height,
            &regional.contributions,
            regional.media.borrow().as_ref(),
        )
    }
    pub fn refresh_regional_ocean_distance(&self) -> io::Result<()> {
        let regional = self.require_regional()?;
        let capture = regional.climate.as_ref().ok_or_else(|| {
            io::Error::other("Capture maritime context before reading regional ocean distance")
        })?;
        self.field()
            .captured_ocean_distance(&capture.ocean_distance())
    }
}
