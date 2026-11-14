use super::{
    events::{Event, EventKind},
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    noise::hash_unit,
    processes::runner::PhysicalContext,
    scale::{LengthUnit, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    tectonics::sources::{area_budget, medium_area, world_candidates, Candidate},
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "MantlePlumeCount":3,
        "MantlePlumeRadius":{"kind":"relative-measure","fraction":0.0275,"dimension":1,"exponent":1},
        "MantlePlumeMinimumSpacing":{"kind":"relative-measure","fraction":0.09,"dimension":1,"exponent":1},
        "MantlePlumeStrength":940,"MantlePlumeMinimumShare":260,"MantlePlumeStrengthExponent":1700
    }})).expect("Declared plume settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    mantle_plume_count: f64,
    mantle_plume_radius: f64,
    mantle_plume_minimum_spacing: f64,
    mantle_plume_strength: f64,
    mantle_plume_minimum_share: f64,
    mantle_plume_strength_exponent: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
fn separated(
    field: &Field,
    candidates: impl IntoIterator<Item = Candidate>,
    count: usize,
    spacing: f64,
) -> Vec<Candidate> {
    let mut selected: Vec<Candidate> = Vec::new();
    for candidate in candidates {
        if selected.len() >= count {
            break;
        }
        if selected.iter().all(|p| {
            field
                .mesh
                .delta_x(p.position[0] - candidate.position[0])
                .hypot(p.position[1] - candidate.position[1])
                >= spacing
        }) {
            selected.push(candidate);
        }
    }
    selected
}
impl Field {
    pub fn events(&self) -> &[Event] {
        &self.events
    }
    fn ocean_plate_at(&self, cell: usize) -> io::Result<i32> {
        let province = self.shared.code(C::CrustProvinceIds).get(cell)?;
        Ok(self
            .tectonics
            .as_ref()
            .and_then(|state| {
                province
                    .checked_sub(1)
                    .and_then(|i| usize::try_from(i).ok())
                    .and_then(|i| state.sites.get(i))
            })
            .map_or(0, |s| s.province.ocean_plate as i32))
    }
    fn plume_candidates(&self, seed: i32, world_count: usize) -> io::Result<Vec<Candidate>> {
        let count = world_count
            .checked_mul(256)
            .ok_or_else(|| io::Error::other("Plume candidates exceed address space"))?
            .max(256);
        let mut candidates = world_candidates(&self.mesh, seed, count);
        let strain = self.shared.scalar(S::TectonicStrain);
        for source in &mut candidates {
            let cell = self
                .mesh
                .cell_at(source.position[0], source.position[1])
                .ok_or_else(|| io::Error::other("Plume source lies outside lattice"))?;
            source.priority = 1000.0 - strain.get(cell)? + source.priority * 420.0;
        }
        // hpc-exempt: seeded world candidates ranked once, matching plume placement source.
        candidates.sort_by(|a, b| b.priority.total_cmp(&a.priority));
        Ok(candidates)
    }
    fn ocean_plumes(
        &self,
        p: &Settings,
        ranked: &[Candidate],
        reference: f64,
    ) -> io::Result<Vec<Candidate>> {
        // hpc-exempt: per-plate coarse area records preserve source insertion order.
        let mut areas: Vec<(i32, f64)> = Vec::new();
        for cell in 0..self.mesh.len() {
            let plate = self.ocean_plate_at(cell)?;
            if plate == 0 {
                continue;
            }
            let area = self.mesh.content_area(cell);
            if let Some(held) = areas.iter_mut().find(|a| a.0 == plate) {
                held.1 += area;
            } else {
                areas.push((plate, area));
            }
        }
        let mut result = Vec::new();
        for (plate, area) in areas {
            let mut candidates = Vec::new();
            for source in ranked {
                let cell = self
                    .mesh
                    .cell_at(source.position[0], source.position[1])
                    .ok_or_else(|| io::Error::other("Plume source lies outside lattice"))?;
                if self.ocean_plate_at(cell)? == plate {
                    candidates.push(*source);
                }
            }
            result.extend(separated(
                self,
                candidates,
                area_budget(p.mantle_plume_count, area, reference),
                p.mantle_plume_minimum_spacing,
            ));
        }
        Ok(result)
    }
    pub fn mantle_plume_roots(settings: Settings) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "mantle-plume-roots",
            CommandKind::Initialize,
            vec![],
            move |scope, context| {
                scope
                    .state_mut()
                    .initialize_plumes(&settings, context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn initialize_plumes(&mut self, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            self.shared
                .scalar_mut(S::MantlePlumeRootStrength)
                .set(cell, 0.0)?;
        }
        let reference = self
            .scale
            .resolve(
                RelativeMeasure::new(0.75, 2, 1.0, LengthUnit::Metre).map_err(io::Error::other)?,
            )
            .map_err(io::Error::other)?
            .value();
        let world_count = area_budget(p.mantle_plume_count, medium_area(&self.mesh), reference);
        let ranked = self.plume_candidates(context.seed, world_count)?;
        let oceanic = self.ocean_plumes(p, &ranked, reference)?;
        let count = world_count.max(oceanic.len());
        let selected = separated(
            self,
            oceanic.into_iter().chain(ranked),
            count,
            p.mantle_plume_minimum_spacing,
        );
        for (rank, source) in selected.iter().enumerate() {
            let position = if selected.len() <= 1 {
                0.0
            } else {
                rank as f64 / (selected.len() - 1) as f64
            };
            let floor = p.mantle_plume_minimum_share / 1000.0;
            let falloff = (1.0 - position).powf(p.mantle_plume_strength_exponent / 1000.0);
            let variation = (floor + (1.0 - floor) * falloff)
                * (0.88 + hash_unit(context.seed ^ 0x54b1, source.id as f64, 0.0) * 0.12);
            let strength = (p.mantle_plume_strength * variation).round();
            let cell = self
                .mesh
                .cell_at(source.position[0], source.position[1])
                .ok_or_else(|| io::Error::other("Plume source lies outside lattice"))?;
            self.shared
                .scalar_mut(S::MantlePlumeRootStrength)
                .set(cell, strength)?;
            self.events.push(Event {
                id: format!("plume:{}:{}", context.seed, source.id),
                kind: EventKind::Plume,
                x: source.position[0],
                y: source.position[1],
                radius: p.mantle_plume_radius,
                epoch: -1,
                strength,
                caldera: None,
            });
        }
        Ok(())
    }
}
