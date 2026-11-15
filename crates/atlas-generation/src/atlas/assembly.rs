//! Compose the selected owner graph once; configured sequences remain the runtime schedule.
use super::{
    dispatch::{registration, Process, Registry},
    ecology,
    features::Context,
    landmarks, magic, people, physical, regional,
    runtime::Runtime,
    state::State,
    world,
};
use crate::{
    ecology::lifecycle::Authority,
    execution::ExecutionResult,
    field::{
        inheritance::Inputs as CapturedInputs,
        poi::carry::Outcomes,
        refinement::{causes, people::PlaceSettings},
    },
    magic::workspace::Configuration,
    reconstruction::Grid,
    storage::SharedCache,
};
use std::{cell::RefCell, io, rc::Rc};

pub struct Inputs {
    pub physical: physical::Options,
    pub magic: Rc<magic::Inputs>,
    pub local_magic: Rc<Vec<crate::field::landmarks::magic::Source>>,
    pub magic_configuration: Configuration,
    pub ecology: Rc<ecology::Inputs>,
    pub people: Rc<people::Inputs>,
    pub world: Rc<world::Inputs>,
    pub landmarks: Rc<landmarks::Inputs>,
    pub captured: Rc<CapturedInputs>,
    pub cache: SharedCache,
    pub regional: Option<Region>,
}
pub struct Operations {
    pub registry: Registry,
    pub physical: Rc<physical::Physical>,
    pub magic: magic::Operations,
    pub people: people::Operations,
    regional_magic: crate::execution::Command<State>,
    people_input: Rc<people::Inputs>,
    publication: Rc<people::Publication>,
    recovery_initialize: Option<crate::execution::Command<State>>,
    regional_input: Option<Rc<regional::work::Inputs>>,
}
impl Operations {
    /// Regional settings must be bound before constructing the shared physical operations.
    pub fn new(
        runtime: &mut Runtime,
        features: &Context<'_>,
        mut input: Inputs,
    ) -> ExecutionResult<Self> {
        let state = runtime.executor.state();
        let base = &state.physical.settings.profile;
        let profile = match &input.regional {
            Some(region) => base
                .regional_profile(region.capture.parent_span, state.field().scale())
                .map_err(io::Error::other)?,
            None => base.clone(),
        };
        input.physical.refined = input.regional.is_some();
        if input.physical.refined {
            input.physical.passes = 1.0;
        }
        let physical = Rc::new(physical::Physical::new(
            runtime,
            &profile,
            features,
            input.physical,
        )?);
        let magic = runtime.bind_magic(
            input.magic.clone(),
            &physical.environment,
            &physical.terrain,
        );
        let epochs = input.magic.epochs.len();
        let magic_work = magic::work::Work::new(input.magic, &magic);
        let mut authority = input.ecology.authority.clone();
        authority
            .fixed
            .extend(runtime.executor.state().physical.protection.ecology_fixed());
        let ecology = ecology::Operations::new(
            Rc::new(ecology::Inputs {
                seed: input.ecology.seed,
                epochs: input.ecology.epochs.clone(),
                parameters: input.ecology.parameters.clone(),
                inherited: input.ecology.inherited,
                authority,
            }),
            physical.environment.clone(),
            runtime.field_projection(),
        );
        ecology.select(&mut runtime.executor);
        let field = runtime.field_projection().clone();
        let spatial = runtime.executor.state().spatial.clone();
        let publication = input.world.publication.clone();
        publication
            .landmarks
            .select_in(&mut runtime.executor.selection_in(&field));
        let people = people::Operations::new(
            input.people.clone(),
            &physical,
            &magic,
            &field,
            spatial.clone(),
            publication.clone(),
        );
        let world = world::Operations::new(input.world, &field);
        let landmarks = landmarks::Operations::new(
            input.landmarks,
            publication.landmarks.clone(),
            spatial,
            &field,
        );
        let systems = input.magic_configuration.systems.clone();
        let configuration = &input.magic_configuration;
        let regional_magic = magic::initialize::operation(
            Configuration {
                enabled: configuration.enabled,
                systems: configuration.systems.clone(),
                confluences: configuration.confluences.clone(),
            },
            input.captured.clone(),
            input.cache.clone(),
            true,
        );
        let inherited = input.captured.surface.channels.contains_key("Elevation");
        let inherited_products = if inherited {
            input.captured.products()
        } else {
            Vec::new()
        };
        let relief_inputs = input.captured.clone();
        let initialize = magic::initialize::operation(
            input.magic_configuration,
            input.captured,
            input.cache,
            false,
        );
        let mut registry = Registry::default();
        let initialization = registration::initialization(inherited_products);
        let setup = physical.clone();
        registry.register(Process::setup(initialization, move |runtime, _| {
            setup.initialize(runtime, inherited)
        }))?;
        registration::native(&mut registry, &physical)?;
        registration::world::register(&mut registry, &world, &publication)?;
        registration::ecology::register(&mut registry, &ecology)?;
        registration::people::register(&mut registry, &people)?;
        registration::magic::register(
            &mut registry,
            &magic,
            &magic_work,
            &systems,
            initialize.clone(),
        )?;
        registration::landmarks::register(&mut registry, &landmarks)?;
        super::relief::register(&mut registry, relief_inputs)?;
        super::local_magic::register(&mut registry, input.local_magic, epochs)?;
        let mut operations = Self {
            registry,
            physical,
            magic,
            people,
            regional_magic,
            people_input: input.people,
            publication,
            recovery_initialize: features.enabled("magic.configured").then_some(initialize),
            regional_input: None,
        };
        if let Some(region) = input.regional {
            operations.regional(runtime, features, region)?;
        }
        Ok(operations)
    }
    fn regional(
        &mut self,
        runtime: &mut Runtime,
        features: &Context<'_>,
        mut input: Region,
    ) -> ExecutionResult<()> {
        input
            .authority
            .fixed
            .extend(runtime.executor.state().physical.protection.ecology_fixed());
        let reads = self.physical.regional_reads(runtime, &self.magic, features);
        let regional_input = Rc::new(regional::work::Inputs {
            seed: input.seed,
            captured: input.ground,
            causes: input.causes,
            publication: self.publication.places.clone(),
            outcomes: RefCell::new(input.outcomes),
            parameters: self.people_input.parameters.clone(),
            ecology: input.ecology,
            authority: input.authority,
            people: regional::work::People {
                land: self.people.land.clone(),
                questions: self.physical.people.clone(),
                record: self.people.record.clone(),
                settings: input.places,
                parent: input.parent_people,
            },
            progress: self.people_input.progress.clone(),
        });
        self.regional_input = Some(regional_input.clone());
        let work = regional::work::Work::new(
            regional_input,
            self.physical.environment.clone(),
            &reads,
            &self.magic,
            runtime.field_projection(),
        );
        self.recovery_initialize = Some(regional::begin::operation(
            input.capture.clone(),
            features
                .enabled("magic.configured")
                .then(|| self.regional_magic.clone()),
        ));
        registration::regional::initialize(
            &mut self.registry,
            input.capture,
            features
                .enabled("magic.configured")
                .then(|| self.regional_magic.clone()),
        )?;
        registration::regional::register(&mut self.registry, &reads, &work, &self.physical.native)
    }

    pub(crate) fn restore_bindings(&self, runtime: &mut Runtime) -> ExecutionResult<()> {
        self.physical.initialize(runtime, false)?;
        if let Some(initialize) = &self.recovery_initialize {
            runtime.executor.run(initialize)?;
        }
        Ok(())
    }

    pub(crate) fn checkpoint(
        &self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.value(
            "published-places",
            &mut *self.publication.places.borrow_mut(),
        )?;
        if let Some(input) = &self.regional_input {
            archive.value("regional-outcomes", &mut *input.outcomes.borrow_mut())?;
        }
        Ok(())
    }
}
pub struct Region {
    pub capture: regional::begin::Capture,
    pub seed: i32,
    pub ground: regional::work::CapturedGround,
    pub causes: causes::Registry<State>,
    pub outcomes: Outcomes,
    pub ecology: super::context::EcologyEpoch,
    pub authority: Authority,
    pub places: PlaceSettings,
    pub parent_people: Option<Rc<Grid>>,
}
