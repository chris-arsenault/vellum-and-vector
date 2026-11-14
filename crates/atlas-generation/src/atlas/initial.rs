//! Initial map samples and captured channels from atlasInitialState.ts.
use super::workspace::{
    inputs::{Record, Selection},
    Frame,
};
use crate::{
    field::inheritance::{resources::Resource, Inputs},
    reconstruction::{
        build::{self, Sampling},
        grid_build, resample, Layout,
    },
    spatial::{Predicate, SpatialKernel},
    storage::SharedCache,
};
use atlas_map::{regions::rectangle, Bounds};
use std::{collections::BTreeMap, io, rc::Rc};

pub struct Captured {
    pub inputs: Rc<Inputs>,
    pub facts: Vec<String>,
}
/// Independent child maps may carry their parent's sample span until the physical lattice
/// exists. This avoids inventing finer inherited information before regional generation.
pub struct Source<'a> {
    pub records: &'a [Record],
    pub ancestors: &'a [String],
    pub owned_geography: bool,
    pub reopened: bool,
    pub surface_span: Option<f64>,
}
pub fn construct(
    frame: &Frame<'_>,
    source: Source<'_>,
    spatial: &dyn SpatialKernel,
    cache: SharedCache,
) -> io::Result<Captured> {
    let Bounds(w, s, e, n) = frame.bounds;
    let bounds = [w, s, e, n];
    let cell_span = source.surface_span.unwrap_or(frame.cell_span()?);
    if !cell_span.is_finite() || cell_span <= 0.0 {
        return Err(io::Error::other(
            "Initial surface requires a positive cell span",
        ));
    }
    // owner-direction(2026-11-14): world and region use common representation rules, selected by geography rather than map type
    let rectangular = spatial
        .relation(frame.chart, &rectangle(frame.bounds), Predicate::Covers)
        .map_err(io::Error::other)?;
    let layout = if rectangular {
        Layout::Raster {
            width: dimension(e - w, cell_span)?,
            height: dimension(n - s, cell_span)?,
        }
    } else {
        let widest = (e - w).max(n - s);
        let minimum_size = halved_width(widest, cell_span) * (1.0 + 1e-9);
        Layout::Adaptive(build::adaptive(
            bounds,
            Sampling {
                minimum_size,
                maximum_size: minimum_size.max(widest / 8.0),
            },
            |[w, s, e, n], _| {
                spatial
                    .relation(
                        &rectangle(Bounds(w, s, e, n)),
                        frame.chart,
                        Predicate::Intersects,
                    )
                    .map_err(io::Error::other)
            },
            cache.clone(),
        )?)
    };
    let mut sampled = grid_build::create(
        grid_build::Frame {
            bounds,
            footprint: frame.chart,
            periodic_width: frame.coordinate_width,
            precision: frame.scope.precision,
        },
        layout,
        spatial,
        cache,
    )?;
    let parent = Selection {
        scope: frame.scope,
        owned_geography: source.owned_geography,
        reopened: source.reopened,
        ancestors: source.ancestors,
    }
    .channels(source.records, frame.coordinate_width, spatial)?;
    // hpc-exempt: channel schema metadata, never sample-indexed storage.
    let mut channels = BTreeMap::new();
    let mut remaining: Vec<_> = parent.iter().collect();
    while let Some((name, source)) = remaining.pop() {
        let mapping = crate::reconstruction::mapping::Mapping::new(
            &source.grid,
            sampled.grid.measures.len(),
            |i| sampled.grid.position(i),
            &mut sampled.coverage,
        )?;
        let mut names = vec![name];
        remaining.retain(|(name, other)| {
            if Rc::ptr_eq(&source.grid, &other.grid) {
                names.push(*name);
                false
            } else {
                true
            }
        });
        for name in names {
            let source = &parent[name];
            channels.insert(
                name.clone(),
                resample::channel(
                    source,
                    name,
                    &sampled.grid,
                    &mapping,
                    &mut sampled.coverage,
                    spatial,
                )?,
            );
        }
    }
    let facts = facts(channels.keys().cloned());
    let mut surface = Resource::new(
        sampled.grid,
        sampled.active.read_only(),
        channels,
        None,
        sampled.coverage,
    );
    surface.resolution = Some(sampled.resolution);
    Ok(Captured {
        inputs: Rc::new(Inputs {
            surface: Rc::new(surface),
            parent,
        }),
        facts,
    })
}
pub fn facts(channels: impl Iterator<Item = String>) -> Vec<String> {
    let mut facts = channels.collect::<Vec<_>>();
    if facts.iter().any(|name| name == "BedrockElevation") {
        facts.push("geology".into());
    }
    if facts.iter().any(|name| name == "FlowTargets") {
        facts.push("drainage".into());
    }
    facts
}
pub fn halved_width(widest: f64, span: f64) -> f64 {
    widest / 2.0f64.powf(((widest / span).log2() + 0.5).floor().max(0.0))
}
fn dimension(extent: f64, span: f64) -> io::Result<usize> {
    let samples = (extent / span).ceil().max(1.0) + 1.0;
    if !samples.is_finite() || samples >= usize::MAX as f64 {
        return Err(io::Error::other(
            "Raster dimensions exceed index representation",
        ));
    }
    Ok(samples as usize)
}
