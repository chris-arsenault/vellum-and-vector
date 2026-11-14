pub mod settings;
mod shape;
use super::{
    events::{Event, EventKind},
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query, QueryValue},
    noise::hash_unit,
    processes::runner::PhysicalContext,
    scale::{LengthUnit, RelativeMeasure},
    tectonics::sources::{area_budget, medium_area, world_candidates},
};
use settings::Settings;
use std::{io, rc::Rc};

#[derive(Clone)]
pub struct PlannedImpact {
    pub id: usize,
    pub position: [f64; 2],
    pub radius: f64,
}
impl QueryValue for PlannedImpact {}
pub struct Shape {
    pub position: [f64; 2],
    pub radius: f64,
    pub depth: f64,
    pub rim: f64,
}
fn count(field: &Field, p: &Settings, c: &PhysicalContext) -> f64 {
    let count = c.impact_count.unwrap_or(p.impact_crater_count);
    if count == 0.0 {
        return 0.0;
    }
    let primordial = (count * p.impact_primordial_share / 1000.0).trunc();
    if !field.crust_formed {
        primordial
    } else {
        ((count - primordial) / c.epoch_count.max(1) as f64 * c.span)
            .round()
            .max(1.0)
    }
}
fn planned(field: &Field, p: &Settings, c: &PhysicalContext) -> io::Result<Vec<PlannedImpact>> {
    let area = field
        .scale
        .resolve(RelativeMeasure::new(0.75, 2, 1.0, LengthUnit::Metre).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let count = area_budget(count(field, p, c), medium_area(&field.mesh), area);
    if count == 0 {
        return Ok(Vec::new());
    }
    let samples = count
        .checked_mul(256)
        .ok_or_else(|| io::Error::other("Impact candidates exceed address space"))?
        .max(256);
    let mut ranked = world_candidates(&field.mesh, c.seed, samples);
    // hpc-exempt: finite world source candidates sorted by placement priority.
    ranked.sort_by(|a, b| b.priority.total_cmp(&a.priority));
    let mut selected: Vec<PlannedImpact> = Vec::new();
    for candidate in ranked {
        if selected.len() >= count {
            break;
        }
        if selected.iter().any(|other| {
            field
                .mesh
                .delta_x(other.position[0] - candidate.position[0])
                .hypot(other.position[1] - candidate.position[1])
                < p.impact_minimum_spacing
        }) {
            continue;
        }
        selected.push(PlannedImpact {
            id: candidate.id,
            position: candidate.position,
            radius: p.impact_minimum_radius
                + (p.impact_maximum_radius - p.impact_minimum_radius)
                    * hash_unit(c.seed ^ 0x3a91, candidate.id as f64, 0.0),
        });
    }
    Ok(selected)
}
impl Field {
    pub fn planned_impacts(settings: Rc<Settings>) -> Query<Self, Vec<PlannedImpact>> {
        Query::new("planned-impacts", vec![], move |field: &Field, scope| {
            planned(field, &settings, &*scope.input::<PhysicalContext>()?)
                .map_err(|e| ExecutionError::Failed(e.to_string()))
        })
    }
    pub fn shape_impact(settings: Rc<Settings>) -> Command<Self, Shape> {
        Command::with_inputs(
            "shape-impact",
            CommandKind::Event,
            vec![],
            move |scope, input: &Shape| {
                shape::shape(
                    scope.state_mut(),
                    &settings,
                    input.position,
                    input.radius,
                    input.depth,
                    input.rim,
                )
                .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    pub fn impact_cratering(settings: Rc<Settings>) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "impact-cratering",
            CommandKind::Event,
            vec![],
            move |scope, context: &PhysicalContext| {
                let field = scope.state_mut();
                let mut run = || -> io::Result<()> {
                    for center in planned(field, &settings, context)? {
                        field.events.push(Event {
                            id: format!("impact:{}:{}", context.seed, center.id),
                            kind: EventKind::Impact,
                            x: center.position[0],
                            y: center.position[1],
                            radius: center.radius,
                            epoch: if field.crust_formed {
                                context.epoch_index
                            } else {
                                -1
                            },
                            strength: 1000.0,
                            caldera: None,
                        });
                        let scale = (center.radius
                            / center.radius.max(settings.impact_maximum_radius))
                        .powf(0.3);
                        let depth = (settings.elevation_scale * settings.impact_depth_ratio
                            / 1000.0
                            * scale)
                            .round()
                            .max(1.0);
                        let rim = (settings.elevation_scale * settings.impact_rim_height_ratio
                            / 1000.0
                            * scale)
                            .round()
                            .max(1.0);
                        shape::shape(field, &settings, center.position, center.radius, depth, rim)?;
                    }
                    Ok(())
                };
                run().map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
}
