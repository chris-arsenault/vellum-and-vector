//! Current resolved application inputs. Resources and mutable workspaces are local host handles.
use crate::{
    generation_inputs::{AuthoredField, CapturedField},
    numerical_resource::{Store, WorkingSet},
};
use atlas_generation::{
    atlas::{
        application::{self, Products},
        configuration::{self, Input as ConfigurationInput, Resolved, Settings as HistorySettings},
        dispatch::run::Settings,
        initial,
        regional::work::Progress,
        resolution::{Profile, Quality},
        state::{PeopleRecords, Records, Scope, Services},
        validation::SurfaceRules,
        workflow::Generation,
        workspace::{Construction, Frame},
        world::Sources,
    },
    execution::ExecutionResult,
    features::records::Entity,
    field::{
        landmarks::{catalogue::Landmark, magic::Source},
        people::traditions,
    },
    magic::workspace::Configuration as Magic,
    naming::{Configuration as NamingConfiguration, Naming},
    recipe::Configuration,
    rock::ground::observers::GroundObservers,
    scale_settings::RelativeOverrides,
    spatial::SpatialKernel,
    storage::SharedCache,
    water::captured::{DrainageNetwork, RetainedNetwork},
};
use atlas_map::{Bounds, Geometry};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    io,
    rc::Rc,
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFrame {
    pub scope: Scope,
    pub chart: Geometry,
    pub bounds: Bounds,
    pub quality: Quality,
    pub profile: Profile,
    pub has_parent: bool,
    pub child_resolution: Option<f64>,
    pub coordinate_width: Option<f64>,
    pub boundary_mode: f64,
}
impl MapFrame {
    fn frame(&self) -> Frame<'_> {
        Frame {
            scope: &self.scope,
            chart: &self.chart,
            bounds: self.bounds,
            quality: self.quality,
            profile: self.profile,
            has_parent: self.has_parent,
            child_resolution: self.child_resolution,
            coordinate_width: self.coordinate_width,
            boundary_mode: self.boundary_mode,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capture {
    pub inputs: crate::generation_capture::Inputs,
    #[serde(skip)]
    pub fields: Vec<CapturedField>,
    #[serde(skip)]
    pub authored: Vec<AuthoredField>,
    #[serde(skip)]
    pub ancestors: Vec<atlas_map::Id>,
    #[serde(skip)]
    pub owned_geography: bool,
    pub reopened: bool,
    #[serde(skip)]
    pub surface_span: Option<f64>,
    pub retained_rivers: Option<RetainedNetwork>,
    pub drainage: Option<DrainageNetwork>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    pub parent_span: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub naming: NamingConfiguration,
    pub geography: crate::generation_frame::Geography,
    pub capture: Capture,
    #[serde(skip)]
    pub region: Option<Region>,
    pub input: ConfigurationInput,
    pub history: HistorySettings,
    pub existing: bool,
    #[serde(skip)]
    pub crossed_features: BTreeSet<atlas_map::Id>,
    pub landmarks: Vec<Landmark>,
    pub magic_sources: Vec<Source>,
    #[serde(skip)]
    pub area_spaces: BTreeMap<atlas_map::Id, atlas_map::Id>,
    pub entities: BTreeMap<atlas_map::Id, Entity>,
}
pub struct PreparedRequest {
    pub request: Request,
    pub resolved: Resolved,
    pub configuration: Configuration,
    pub geography: crate::generation_frame::Prepared,
    pub surface_rules: SurfaceRules,
}
pub struct Host {
    pub resources: Rc<dyn Store>,
    pub cache: SharedCache,
    pub spatial: Rc<dyn SpatialKernel>,
    pub records: Records,
    pub original: Sources,
    pub progress: Progress,
}
impl Request {
    pub fn resolve(
        mut self,
        spatial: &dyn SpatialKernel,
        resources: &dyn Store,
    ) -> io::Result<PreparedRequest> {
        let resolved = crate::generation_configuration::resolve(&mut self)?;
        let geography = self.geography.prepare(&self.input, spatial)?;
        let frame = &geography.frame;
        let captured =
            self.capture
                .inputs
                .resolve(&self.geography.fields, self.input.area_id, resources)?;
        self.region = self.geography.areas[&self.input.area_id]
            .area
            .map
            .as_ref()
            .map(|_| Region {
                parent_span: captured
                    .parent_span
                    .unwrap_or(geography.scope.resolution.unwrap_or(0.0) * 4.0),
            });
        self.capture.fields = captured.fields;
        self.capture.authored = captured.authored;
        self.capture.ancestors = geography.ancestors.clone();
        self.capture.owned_geography = frame.scope.owns_map_geography;
        self.capture.surface_span = self.region.as_ref().and(geography.scope.resolution);
        self.area_spaces = geography.area_spaces.clone();
        self.crossed_features = geography.contracted.clone();
        self.landmarks = crate::generation_rules::landmarks(
            self.landmarks,
            &geography,
            resolved.settings.epochs.len(),
            spatial,
        )?;
        let configuration = resolved.recipe(
            &self.input,
            &configuration::Frame {
                profile: frame.profile,
                regional: self.region.is_some(),
                inherited: frame.has_parent,
                landmarks_apply: !frame.has_parent || !self.landmarks.is_empty(),
                standalone_magic: !crate::generation_rules::located_sources(
                    &self.magic_sources,
                    &geography,
                    resolved.settings.epochs.len(),
                    spatial,
                )?
                .is_empty(),
            },
        )?;
        Ok(PreparedRequest {
            surface_rules: crate::generation_rules::surface(&self.geography, &geography),
            request: self,
            resolved,
            configuration,
            geography,
        })
    }
}
impl PreparedRequest {
    pub fn prepare(self, host: Host) -> ExecutionResult<Generation> {
        let PreparedRequest {
            request,
            resolved,
            configuration,
            geography,
            surface_rules,
        } = self;
        request.prepare(
            host,
            resolved,
            configuration,
            geography.frame,
            surface_rules,
        )
    }
}
impl Request {
    fn prepare(
        self,
        mut host: Host,
        resolved: Resolved,
        configuration: Configuration,
        frame: MapFrame,
        surface_rules: SurfaceRules,
    ) -> ExecutionResult<Generation> {
        let context = self.geography.context();
        atlas_generation::features::mapped::validate(
            &context,
            self.input.area_id,
            host.original.features.as_ref(),
            host.spatial.as_ref(),
        )?;
        for patch in self
            .capture
            .inputs
            .patches
            .iter()
            .filter(|patch| patch.map_only)
        {
            atlas_generation::features::mapped::overlap(
                &context,
                self.input.area_id,
                patch.area_id,
                &format!("{} painting", patch.channels.join(", ")),
                std::iter::once(&patch.footprint),
                host.spatial.as_ref(),
            )?;
        }
        host.original = atlas_generation::features::procedural::initialize(
            host.original,
            host.records.features.as_mut(),
            host.records.networks.as_mut(),
        )?;
        let naming = Rc::new(Naming::new(
            self.naming,
            self.entities.clone(),
            host.spatial.clone(),
        ));
        let mut resources = WorkingSet::new(host.resources, host.cache.clone());
        let fields = self
            .capture
            .fields
            .iter()
            .map(|input| input.load(&mut resources))
            .collect::<io::Result<Vec<_>>>()?;
        let authored = self
            .capture
            .authored
            .iter()
            .map(|input| input.load(&mut resources))
            .collect::<io::Result<Vec<_>>>()?;
        let overrides = RelativeOverrides::from_value(Value::Object(resolved.overrides));
        let last_era = resolved
            .settings
            .human_eras
            .last()
            .map(|era| era.id.clone());
        let published_fields = atlas_generation::publication::channels::Inputs {
            selection: &resolved.selection,
            systems: &resolved.settings.magic_systems,
            confluences: &resolved.settings.confluences,
            sources: &self.magic_sources,
            inherited: &self
                .capture
                .fields
                .iter()
                .flat_map(|field| field.source.channels.iter().cloned())
                .collect(),
        }
        .bindings(&self.entities)
        .into_iter()
        .filter(|binding| binding.publish)
        .map(|binding| binding.channel)
        .collect();
        let region = self.region.map(|region| application::Region {
            parent_span: region.parent_span,
            last_era: last_era.clone(),
            rivers: self.capture.drainage.clone().map(Rc::new),
        });
        let domain = application::Domain {
            people: people(frame.scope.world, self.entities, naming.clone()),
            records: host.records,
            services: Services {
                spatial: host.spatial.clone(),
                naming,
            },
            original: host.original,
            area_spaces: self.area_spaces,
            magic_sources: self.magic_sources,
            drainage: self.capture.drainage,
        };
        application::prepare(
            Construction {
                frame: frame.frame(),
                parameters: &resolved.parameters,
                overrides: &overrides,
                inputs: initial::Source {
                    records: &fields,
                    ancestors: &self.capture.ancestors,
                    owned_geography: self.capture.owned_geography,
                    reopened: self.capture.reopened,
                    surface_span: self.capture.surface_span,
                },
                retained_rivers: self.capture.retained_rivers.as_ref(),
                landmarks: &self.landmarks,
                authored: &authored,
                spatial: host.spatial.as_ref(),
                cache: host.cache,
                ground_events: Box::<GroundObservers>::default(),
            },
            domain,
            application::Run {
                interfaces: crate::generation_rules::interfaces(&self.geography),
                configuration,
                settings: Settings {
                    seed: self.input.seed.to_string(),
                    seed_scope: serde_json::to_string(&(frame.profile, frame.bounds))
                        .map_err(io::Error::other)?,
                    physical_seed: self.input.seed,
                    epochs: resolved.settings.epochs,
                },
                magic: Magic {
                    enabled: resolved
                        .selection
                        .get("magic.configured")
                        .is_some_and(|feature| feature.enabled),
                    systems: resolved.settings.magic_systems,
                    confluences: resolved.settings.confluences,
                },
                selection: resolved.selection,
                domains: self.input.domains,
                naming_era: last_era.unwrap_or_else(|| "Before societies".into()),
                products: Products {
                    fields: published_fields,
                    crossed_features: self.crossed_features,
                },
                surface_rules,
                progress: host.progress,
            },
            region,
        )
    }
}
fn people(
    world: atlas_map::Id,
    entities: BTreeMap<atlas_map::Id, Entity>,
    naming: Rc<Naming>,
) -> PeopleRecords {
    PeopleRecords {
        places: Default::default(),
        ways: Default::default(),
        events: Default::default(),
        works: Default::default(),
        memory: Rc::new(RefCell::new(traditions::Context {
            world,
            entities,
            traditions: Default::default(),
            naming,
        })),
    }
}
