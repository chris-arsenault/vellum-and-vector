use super::State;
use crate::{execution::ExecutionResult, field::magic, magic::feedback::history::Record};
use std::cell::RefCell;

impl State {
    pub fn supply_magic_sources(
        &mut self,
        phase: crate::magic::configuration::Phase,
        seed: i32,
        physical_epoch: Option<usize>,
        activity: &[crate::magic::workspace::Activity],
    ) -> ExecutionResult<()> {
        let Some(epoch) = physical_epoch else {
            return Ok(());
        };
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        let epoch = i32::try_from(epoch).map_err(std::io::Error::other)?;
        self.physical.executor.run_with(
            &magic::supply::phase(phase),
            &magic::supply::Input {
                workspace: RefCell::new(workspace.get_mut()),
                seed,
                epoch,
                activity,
                spatial: self.spatial.as_ref(),
            },
        )
    }
    pub fn record_magic_history(
        &mut self,
        classify: &crate::execution::Query<crate::field::Field, ()>,
        context: std::rc::Rc<crate::processes::runner::PhysicalContext>,
        physical_epoch: Option<usize>,
        epoch_indices: &[usize],
    ) -> ExecutionResult<()> {
        let Some(epoch) = physical_epoch else {
            return Ok(());
        };
        self.physical
            .executor
            .query_with_context(classify, context)?;
        self.record_classified_magic_history(epoch, epoch_indices)
    }
    pub fn record_classified_magic_history(
        &mut self,
        epoch: usize,
        epoch_indices: &[usize],
    ) -> ExecutionResult<()> {
        if let Some(cause) = crate::field::poi::wild_history::record(
            self,
            &self.history,
            &self.causes,
            Some(epoch),
            epoch_indices,
        )? {
            self.causes.push(cause);
        }
        let epoch = i32::try_from(epoch).map_err(std::io::Error::other)?;
        for record in self.retain_magic_history(epoch)? {
            self.causes.push(crate::atlas::history::Cause::Domain {
                process: "atlas.magic-history".into(),
                subjects: Vec::new(),
                description: record.description(),
            });
        }
        Ok(())
    }
    pub fn project_magic(&mut self) -> std::io::Result<()> {
        if let Some(magic) = &self.physical.magic {
            self.physical
                .surface
                .project_magic(self.physical.executor.state(), &magic.borrow())?;
        }
        Ok(())
    }
    pub fn initialize_magic(
        &mut self,
        configuration: crate::magic::workspace::Configuration,
        capture: Option<magic::initialization::Capture<'_>>,
    ) -> ExecutionResult<()> {
        let features = self
            .records
            .features
            .values(crate::features::FeatureSelection {
                area_id: Some(&self.scope.area),
                ..Default::default()
            })?
            .collect::<std::io::Result<Vec<_>>>()?;
        let input = magic::initialization::Initialize {
            configuration: RefCell::new(Some(configuration)),
            capture,
            features: &features,
            surface: &self.physical.surface,
            output: RefCell::default(),
        };
        self.physical
            .executor
            .run_with(&magic::initialization::initialize(), &input)?;
        self.physical.magic = input.output.into_inner().map(RefCell::new);
        Ok(())
    }
    pub fn apply_magic_rocks(&mut self) -> ExecutionResult<()> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        self.physical.executor.run_with(
            &magic::rocks(),
            &magic::RockResponse {
                workspace: RefCell::new(workspace.get_mut()),
                floor: self.physical.settings.magic.fracture_conductance_floor,
            },
        )
    }
    pub fn apply_magic_forcing(
        &mut self,
        seed: i32,
        span: f64,
        post_glacial: bool,
    ) -> ExecutionResult<()> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        let operation = if post_glacial {
            magic::post_glacial_cover()
        } else {
            magic::elapsed_forcing()
        };
        self.physical.executor.run_with(
            &operation,
            &magic::Elapsed {
                workspace: RefCell::new(workspace.get_mut()),
                seed,
                span,
            },
        )
    }
    pub fn react_magic_material(
        &mut self,
        seed: i32,
        phase: i32,
        span: f64,
    ) -> ExecutionResult<()> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        let weather = self.physical.settings.magic.weather();
        self.physical.executor.run_with(
            &magic::react(),
            &magic::Response {
                workspace: RefCell::new(workspace.get_mut()),
                seed,
                phase,
                span,
                weather: &weather,
            },
        )?;
        Ok(())
    }
    pub fn exchange_magic_water(&mut self) -> ExecutionResult<()> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        self.physical
            .executor
            .run_with(&magic::exchange_water(), &RefCell::new(workspace.get_mut()))
    }
    pub fn transport_retained_magic(&mut self) -> ExecutionResult<()> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        self.physical
            .executor
            .run_with(&magic::transport(), &RefCell::new(workspace.get_mut()))
    }
    pub fn advect_magic(&mut self) -> ExecutionResult<()> {
        if let Some(workspace) = &mut self.physical.magic {
            self.physical
                .executor
                .run_with(&magic::advect(), &RefCell::new(workspace.get_mut()))?;
        }
        Ok(())
    }
    pub fn respond_organic_magic(&mut self) -> ExecutionResult<()> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(());
        };
        self.physical.executor.run_with(
            &magic::respond_organic(),
            &RefCell::new(workspace.get_mut()),
        )
    }
    pub fn retain_magic_history(&mut self, epoch: i32) -> ExecutionResult<Vec<Record>> {
        let Some(workspace) = &mut self.physical.magic else {
            return Ok(Vec::new());
        };
        let input = magic::History {
            workspace: RefCell::new(workspace.get_mut()),
            epoch,
            records: RefCell::default(),
        };
        self.physical
            .executor
            .run_with(&magic::retain_history(), &input)?;
        Ok(input.records.into_inner())
    }
    pub fn react_regional_magic(&mut self, seed: i32, exposure: f64) -> ExecutionResult<()> {
        if !self
            .require_regional()?
            .domains
            .iter()
            .any(|d| d == "magic")
            || self.physical.magic.is_none()
        {
            return Ok(());
        }
        self.apply_magic_rocks()?;
        let phase = self.field().ground().completed_epochs() as i32;
        self.react_magic_material(seed, phase, exposure)
    }
    pub fn respond_regional_organic(&mut self) -> ExecutionResult<()> {
        if self
            .require_regional()?
            .domains
            .iter()
            .any(|d| d == "magic")
        {
            self.respond_organic_magic()?;
        }
        Ok(())
    }
}
