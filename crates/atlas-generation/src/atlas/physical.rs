//! Build the selected native operations from their actual owner commands and shared questions.
use super::{
    environment::{Environment, Questions},
    features::{Catalogue, Context},
    native::NativeSteps,
    questions,
    runtime::Runtime,
    terrain::{Terrain, TerrainContext},
};
use crate::{
    execution::{ExecutionResult, Query},
    field::{glaciers, people, Field},
    scale_settings::ResolvedSettings,
    storage::ReadBand,
};
use std::{io, rc::Rc};

pub struct Options {
    pub seed: i32,
    pub passes: f64,
    pub refined: bool,
    pub open_boundary: bool,
    pub inherited_landforms: bool,
}
pub struct Physical {
    pub environment: Rc<Environment>,
    pub terrain: Rc<Terrain>,
    pub native: NativeSteps,
    pub questions: Questions,
    pub people: Rc<people::questions::Questions>,
    pub rivers: Query<Field, ReadBand<u32>>,
    pub validation: Query<Field, ()>,
    selected: Vec<&'static str>,
    seed: i32,
}
impl Physical {
    pub fn new(
        runtime: &mut Runtime,
        profile: &ResolvedSettings,
        context: &Context<'_>,
        options: Options,
    ) -> ExecutionResult<Self> {
        let spatial = runtime.executor.state().spatial.clone();
        let questions = Questions::default();
        let environment = Rc::new(Environment::new(
            profile,
            &questions,
            options.open_boundary,
            None,
        )?);
        let terrain = Rc::new(Terrain::new(
            profile,
            &questions,
            &environment,
            spatial.clone(),
            TerrainContext {
                passes: options.passes,
                refined: options.refined,
                open_boundary: options.open_boundary,
            },
        )?);
        let rivers = people::travel::river_orders(vec![environment.rivers.optional_dependency()]);
        let people = Rc::new(people::questions::Questions::bound(&questions));
        let mut book = questions::base(profile, &environment, &terrain, rivers.clone())?;
        runtime.place_water_responders(&mut book)?;
        questions.bind(book)?;
        let landforms = options.inherited_landforms || context.enabled("physical.landforms");
        let validation = Field::structural_validation(
            Rc::new(glaciers::Settings::from_resolved(profile).map_err(io::Error::other)?),
            options.open_boundary,
            move || landforms,
            vec![environment.routing.optional_dependency()],
        );
        let catalogue = Catalogue::default();
        let drift = profile
            .values()
            .get("PlateDriftPerMyr")
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| io::Error::other("Plate advection requires PlateDriftPerMyr"))?;
        let native = NativeSteps::new(
            &terrain,
            &environment,
            &validation,
            options.open_boundary,
            |definitions| {
                let deformation = catalogue
                    .plate_deformation(context, definitions)?
                    .into_iter()
                    .cloned()
                    .collect::<Vec<_>>();
                Ok(terrain.plates(
                    spatial,
                    drift,
                    Some(Runtime::plate_magic_hook()),
                    Some(NativeSteps::deformation(&deformation)),
                    Field::carriers()?,
                ))
            },
        )?;
        let selected = catalogue.selected_native(context.selection, &native)?;
        let selected = selected.iter().map(|step| step.name).collect();
        Ok(Self {
            environment,
            terrain,
            native,
            questions,
            people,
            rivers,
            validation,
            selected,
            seed: options.seed,
        })
    }
    pub fn initialize(&self, runtime: &mut Runtime, inherited: bool) -> ExecutionResult<()> {
        runtime.select_physical(
            &self.native,
            &self.environment,
            &self.terrain,
            self.seed,
            self.selected.iter().copied(),
        )?;
        let field = runtime.field_projection().clone();
        let mut selection = runtime.executor.selection_in(&field);
        selection.select(&self.rivers);
        self.people.select_in(&mut selection);
        if inherited {
            let settings = crate::field::crust_settings::Settings::from_resolved(
                &runtime.executor.state().physical.settings.profile,
            )
            .map_err(io::Error::other)?;
            runtime.executor.run_with(
                &Field::capture_support_datum(settings).projected(&field),
                &crate::processes::runner::PhysicalContext::default(),
            )?;
        }
        Ok(())
    }
    pub fn regional_reads(
        &self,
        runtime: &mut Runtime,
        magic: &super::magic::Operations,
        context: &Context<'_>,
    ) -> super::regional::queries::Reads {
        let reads = super::regional::queries::Reads::new(
            &self.environment,
            magic,
            &self.validation,
            runtime.field_projection(),
        );
        reads.select(&mut runtime.executor);
        if context.enabled("water.routing") {
            runtime.bind_regional_water(&self.environment);
        }
        if context.enabled("ocean.geography") {
            runtime.bind_regional_ocean_distance(&self.environment);
        }
        if context.enabled("physical.climate") {
            runtime.bind_regional_climate(&self.environment, reads.climate.clone());
        }
        reads
    }
}
