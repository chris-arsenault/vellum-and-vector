//! Construct the common physical lattice and import captured map-owned resources once.
pub mod inputs;
use super::{
    parameters::AtlasParameters,
    state::{Physical, Scope, Settings},
};
use crate::{
    execution::{ExecutionResult, Executor},
    field::{
        self,
        inheritance::{self, Inputs},
        projection::Surface,
        FieldSeed,
    },
    lattice::{TriangularLattice, WorldLatticeOptions},
    rock::ground::GroundEvents,
    scale::MapScale,
    scale_settings::{RelativeOverrides, ResolvedSettings},
    spatial::SpatialKernel,
    storage::{Coverage, SharedCache},
    water::captured::RetainedNetwork,
};
use atlas_map::{Bounds, Geometry};
use std::{collections::BTreeMap, io, rc::Rc};

pub struct Frame<'a> {
    pub scope: &'a Scope,
    pub chart: &'a Geometry,
    pub bounds: Bounds,
    pub quality: super::resolution::Quality,
    pub profile: super::resolution::Profile,
    pub has_parent: bool,
    /// Captured child resolution; root maps always use the configured fixed level.
    pub child_resolution: Option<f64>,
    pub coordinate_width: Option<f64>,
    pub boundary_mode: f64,
}
impl Frame<'_> {
    pub fn cell_span(&self) -> io::Result<f64> {
        let fixed_span = self.quality.cell_span(self.profile);
        let span = if self.has_parent {
            self.child_resolution.unwrap_or(fixed_span)
        } else {
            fixed_span
        };
        if !span.is_finite() || span <= 0.0 {
            return Err(io::Error::other("Workspace requires a positive cell span"));
        }
        Ok(span)
    }
}
pub struct Construction<'a, Sources = &'a Inputs> {
    pub frame: Frame<'a>,
    pub parameters: &'a AtlasParameters,
    pub overrides: &'a RelativeOverrides,
    pub inputs: Sources,
    pub retained_rivers: Option<&'a RetainedNetwork>,
    pub landmarks: &'a [field::landmarks::catalogue::Landmark],
    pub authored: &'a [field::protection::Input],
    pub spatial: &'a dyn SpatialKernel,
    pub cache: SharedCache,
    pub ground_events: Box<dyn GroundEvents>,
}
pub struct Prepared {
    pub physical: Physical,
    pub inherited: bool,
}
pub struct CapturedWorkspace {
    pub workspace: Prepared,
    pub captured: super::initial::Captured,
}
/// Both hosts enter through captured records; initial samples and the physical lattice share
/// the same map frame, selected inputs and cache ownership.
pub fn prepare(
    input: Construction<'_, super::initial::Source<'_>>,
) -> ExecutionResult<CapturedWorkspace> {
    let captured = super::initial::construct(
        &input.frame,
        input.inputs,
        input.spatial,
        input.cache.clone(),
    )?;
    let workspace = construct(Construction {
        frame: input.frame,
        parameters: input.parameters,
        overrides: input.overrides,
        inputs: &captured.inputs,
        retained_rivers: input.retained_rivers,
        landmarks: input.landmarks,
        authored: input.authored,
        spatial: input.spatial,
        cache: input.cache,
        ground_events: input.ground_events,
    })?;
    Ok(CapturedWorkspace {
        workspace,
        captured,
    })
}
fn frame_bounds(scope: &Scope) -> [f64; 4] {
    let b = scope.domain_bounds;
    [b.0, b.1, b.2, b.3]
}
fn profile(input: &Construction<'_>) -> io::Result<ResolvedSettings> {
    let bounds = frame_bounds(input.frame.scope);
    MapScale::from_cells(bounds, 60_000.0)
        .map_err(io::Error::other)?
        .atlas_profile(
            input.parameters,
            &super::profile::definition(),
            input.overrides,
        )
        .map_err(io::Error::other)?
        .atlas_frame(bounds, input.frame.boundary_mode)
        .map_err(io::Error::other)
}
fn number(profile: &ResolvedSettings, name: &str) -> io::Result<f64> {
    profile
        .values()
        .get(name)
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| io::Error::other(format!("Workspace requires profile setting {name}")))
}
fn lattice(input: &Construction<'_>, profile: &ResolvedSettings) -> io::Result<TriangularLattice> {
    let frame = &input.frame;
    let cell_span = frame.cell_span()?;
    let world = frame.scope.world_geography;
    let wrap = if world {
        frame.boundary_mode == 1.0
    } else {
        frame.scope.cylindrical
            && frame.bounds.2 - frame.bounds.0
                >= frame.scope.domain_bounds.2 - frame.scope.domain_bounds.0 - 1e-6
    };
    let padding = if world {
        number(profile, "BoundaryPadding")?
    } else {
        4.0 * cell_span
    };
    let [x, y, _] = input
        .spatial
        .interior_position(frame.chart)
        .map_err(io::Error::other)?
        .coordinates();
    let options = WorldLatticeOptions {
        wrap_x: wrap,
        close_poles: world
            && wrap
            && number(profile, "LatitudeSouth")? == -90.0
            && number(profile, "LatitudeNorth")? == 90.0,
        coordinate_width: frame.coordinate_width,
        area: Some(input.spatial.area(frame.chart).map_err(io::Error::other)?),
        anchor: Some([x, y]),
    };
    let samples = (frame.bounds.2 - frame.bounds.0 + 2.0 * padding)
        * (frame.bounds.3 - frame.bounds.1 + 2.0 * padding)
        / cell_span.powi(2);
    options
        .build_batch(frame.bounds, samples, padding, |points| {
            input.spatial.covers_points(frame.chart, points)
        })
        .map_err(io::Error::other)
}
pub fn construct(input: Construction<'_>) -> ExecutionResult<Prepared> {
    let profile = profile(&input)?;
    let mut lattice = lattice(&input, &profile)?;
    let inherited = input.inputs.surface.channels.contains_key("Elevation");
    if inherited {
        let mut scratch = Coverage::samples(0, input.cache.clone());
        input
            .inputs
            .sample_ghosts(&mut lattice, &mut scratch, input.spatial)?;
    }
    let mesh = Rc::new(lattice);
    let scale = MapScale::from_bounds(frame_bounds(input.frame.scope), mesh.spacing())
        .map_err(io::Error::other)?;
    let mut seed = FieldSeed::new(mesh.clone(), scale, input.cache.clone());
    let mut imported = Coverage::new(mesh.clone(), input.cache.clone());
    let samples = if inherited {
        Some(
            input
                .inputs
                .sample_all(&mesh, &mut imported, input.spatial)?,
        )
    } else {
        None
    };
    if let Some(samples) = &samples {
        samples.import_seed(&mut seed, &mesh)?;
        seed.ground.sea_level = datum(input.inputs, "EffectiveSeaLevel")?;
        let material = input.inputs.material();
        if let Some(cargo) = &material.cargo {
            inheritance::cargo::import(&mut seed, &mesh, &material.grid, cargo)?;
        }
    }
    let mut executor = Executor::new(seed.finish(input.ground_events)?);
    if let Some(samples) = &samples {
        executor.run_with(
            &inheritance::complete(),
            &inheritance::Completion {
                samples,
                base_sea_level: datum(input.inputs, "BaseSeaLevel")?,
                effective_sea_level: datum(input.inputs, "EffectiveSeaLevel")?,
                retained_rivers: input.retained_rivers,
            },
        )?;
    }
    let protection = Rc::new(field::protection::Protection::capture(
        executor.state(),
        &input.frame.scope.space,
        input.authored,
        input.spatial,
        input.cache.clone(),
    )?);
    let mut surface =
        Surface::captured(input.inputs.surface.clone(), executor.state(), input.cache)?;
    surface.compose_authored(input.authored, &input.frame.scope.space, input.spatial)?;
    Ok(Prepared {
        inherited,
        physical: Physical {
            protection,
            active: surface.active(),
            surface,
            field_footprint: input.frame.chart.clone(),
            executor,
            ocean: None,
            lakes: Vec::new(),
            lake_outlines: BTreeMap::new(),
            magic: None,
            landmarks: input.landmarks.to_vec(),
            landmark_roster: None,
            settings: Settings::new(&profile, &profile)?,
        },
    })
}
fn datum(input: &Inputs, name: &str) -> io::Result<f64> {
    input
        .surface
        .channels
        .get(name)
        .ok_or_else(|| io::Error::other("Captured physical fields require canonical sea levels"))?
        .values
        .get(0)
}
