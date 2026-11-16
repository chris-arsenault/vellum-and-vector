//! Bind captured map inputs to the existing owner graph on either local execution host.
mod ecology;
mod publication;
mod region;
use super::{
    assembly,
    context::Epoch,
    dispatch::run::Settings,
    features::{Context, Policy, Selection},
    initial, landmarks, magic,
    parameters::AtlasParameters,
    people, physical, regional,
    resolution::Profile,
    state::{PeopleRecords, Records, Services, State},
    validation::SurfaceRules,
    workflow::{Generation, Prepared},
    workspace, world,
};
use crate::{
    execution::ExecutionResult, field::landmarks::magic::Source,
    magic::workspace::Configuration as MagicConfiguration, recipe::Configuration,
    storage::SharedCache,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    rc::Rc,
};

/// Canonical records and naming stay host/application capabilities; no numerical callbacks.
pub struct Domain {
    pub records: Records,
    pub people: PeopleRecords,
    pub services: Services,
    pub original: world::Sources,
    // hpc-exempt: located area identities, not cell storage.
    pub area_spaces: BTreeMap<String, String>,
    pub magic_sources: Vec<Source>,
    pub drainage: Option<crate::water::captured::DrainageNetwork>,
}
/// Active publication declarations already resolved by the shared domain application.
pub struct Products {
    // hpc-exempt: published channel and layer identities.
    pub fields: BTreeSet<String>,
    pub crossed_features: BTreeSet<String>,
}
pub struct Run {
    pub configuration: Configuration,
    pub settings: Settings,
    pub selection: Selection,
    pub domains: Vec<String>,
    pub naming_era: String,
    pub magic: MagicConfiguration,
    pub products: Products,
    pub surface_rules: SurfaceRules,
    pub interfaces: super::validation::interfaces::Rules,
    pub progress: regional::work::Progress,
}
/// Regional captured geometry remains pinned; the run creates its own ground and coast.
pub struct Region {
    pub parent_span: f64,
    pub rivers: Option<Rc<crate::water::captured::DrainageNetwork>>,
    pub last_era: Option<String>,
}
struct Binding {
    has_parent: bool,
    inherited: bool,
    parameters: AtlasParameters,
    captured: initial::Captured,
    cache: SharedCache,
}
/// The same construction is used for native and WASM. Host I/O has already opened local
/// captured resources, and the returned generator owns everything required for this run.
pub fn prepare(
    construction: workspace::Construction<'_, initial::Source<'_>>,
    domain: Domain,
    run: Run,
    region: Option<Region>,
) -> ExecutionResult<Generation> {
    let scope = construction.frame.scope.clone();
    scope.validate_ancestry()?;
    let profile = construction.frame.profile;
    let has_parent = construction.frame.has_parent;
    let parameters = construction.parameters.clone();
    parameters.validate().map_err(io::Error::other)?;
    let cache = construction.cache.clone();
    let prepared = workspace::prepare(construction)?;
    let binding = Binding {
        has_parent,
        parameters,
        cache,
        inherited: prepared.workspace.inherited,
        captured: prepared.captured,
    };
    let mut state = State::new(
        scope,
        prepared.workspace.physical,
        domain.records,
        domain.people,
        domain.services,
    )?;
    state.drainage = domain.drainage;
    let authority = ecology::authority(&state, &domain.area_spaces, region.is_some())?;
    let context = Context {
        selection: &run.selection,
        policy: if region.is_some() {
            Policy::Regional
        } else {
            Policy::World
        },
        refinement: !matches!(profile, Profile::World),
        landmarks_apply: !has_parent || !state.physical.landmarks.is_empty(),
        standalone_magic: domain
            .magic_sources
            .iter()
            .any(|source| source.system_id.is_none()),
        initial: false,
        material: false,
        process: None,
    };
    let publication = Rc::new(publication::create(
        &state,
        &context,
        run.products,
        region.as_ref(),
    )?);
    let operations = owners(
        &state,
        &binding,
        OwnerInputs {
            seed: run.settings.physical_seed,
            epochs: &run.settings.epochs,
            authority,
            domain_sources: domain.original,
            magic_sources: domain.magic_sources,
            domains: run.domains,
            naming_era: run.naming_era,
            magic: run.magic,
            progress: run.progress,
            publication,
            context: &context,
            region,
        },
    )?;
    Generation::new(
        Prepared {
            state,
            operations,
            configuration: run.configuration,
            settings: run.settings,
            facts: binding.captured.facts,
            surface_rules: run.surface_rules,
            interfaces: run.interfaces,
        },
        &context,
    )
}
struct OwnerInputs<'a, 'c> {
    seed: i32,
    epochs: &'a [Epoch],
    authority: crate::ecology::lifecycle::Authority,
    domain_sources: world::Sources,
    magic_sources: Vec<Source>,
    domains: Vec<String>,
    naming_era: String,
    magic: MagicConfiguration,
    progress: regional::work::Progress,
    publication: Rc<people::Publication>,
    context: &'a Context<'c>,
    region: Option<Region>,
}
fn owners(
    state: &State,
    binding: &Binding,
    input: OwnerInputs<'_, '_>,
) -> ExecutionResult<assembly::Inputs> {
    let inherited_channels = binding
        .captured
        .inputs
        .surface
        .channels
        .keys()
        .chain(binding.captured.inputs.parent.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let region = input
        .region
        .as_ref()
        .map(|region| region::create(state, binding, &input, region))
        .transpose()?;
    Ok(assembly::Inputs {
        physical: physical::Options {
            seed: input.seed,
            passes: 1.0,
            refined: region.is_some(),
            open_boundary: binding.inherited || state.field().mesh().open_boundary(),
            inherited_landforms: inherited_channels.contains("LandformCodes"),
        },
        magic: Rc::new(magic::Inputs {
            seed: input.seed,
            epochs: input.epochs.to_vec(),
            placed: input.magic_sources.iter().map(Source::placed).collect(),
        }),
        local_magic: Rc::new(input.magic_sources),
        magic_configuration: MagicConfiguration {
            enabled: input.context.enabled("magic.configured"),
            ..input.magic
        },
        ecology: Rc::new(super::ecology::Inputs {
            seed: input.seed,
            epochs: input.epochs.to_vec(),
            parameters: binding.parameters.clone(),
            inherited: binding.inherited,
            authority: input.authority,
        }),
        people: Rc::new(people::Inputs {
            parameters: binding.parameters.clone(),
            progress: input.progress.clone(),
        }),
        world: Rc::new(world::Inputs {
            domains: input.domains,
            naming_era: input.naming_era,
            selection: input.context.selection.clone(),
            inherited_channels,
            publication: input.publication,
            original: input.domain_sources,
            progress: input.progress,
        }),
        landmarks: Rc::new(landmarks::Inputs {
            seed: input.seed,
            epochs: input.epochs.to_vec(),
            parameters: binding.parameters.clone(),
            tectonic_history: input.context.enabled("physical.tectonic-history"),
            has_parent: binding.has_parent,
        }),
        captured: binding.captured.inputs.clone(),
        cache: binding.cache.clone(),
        regional: region,
    })
}
