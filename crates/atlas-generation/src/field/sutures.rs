use super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    hpc::{Direction, KeyedHeap},
    processes::runner::PhysicalContext,
    rock::ground::{Ground, GroundField as G},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    storage::Band,
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "ContinentalSutureDetectionReach":{"kind":"relative-measure","fraction":0.015,"dimension":1,"exponent":1},
        "ContinentalSutureMinimumFraction":420,
        "ContinentalSutureStrengthGain":620
    }})).expect("Declared suture settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    continental_suture_detection_reach: f64,
    continental_suture_minimum_fraction: f64,
    continental_suture_strength_gain: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
struct Contact {
    pair: i32,
    proximity: f64,
}
struct MaterialSearch {
    first: i32,
    second: i32,
    first_distance: f64,
    second_distance: f64,
}
impl MaterialSearch {
    fn new() -> Self {
        Self {
            first: 0,
            second: 0,
            first_distance: f64::INFINITY,
            second_distance: f64::INFINITY,
        }
    }
    fn observe(&mut self, assembly: i32, distance: f64) {
        if self.first == 0 || (assembly == self.first && distance < self.first_distance) {
            self.first = assembly;
            self.first_distance = self.first_distance.min(distance);
        } else if assembly != self.first
            && (self.second == 0 || (assembly == self.second && distance < self.second_distance))
        {
            self.second = assembly;
            self.second_distance = self.second_distance.min(distance);
        }
    }
    fn contact(&self, reach: f64) -> Option<Contact> {
        (self.first > 0 && self.second > 0).then(|| Contact {
            pair: (self.first.min(self.second) << 16) | self.first.max(self.second),
            proximity: (1.0
                - self.first_distance.max(self.second_distance) / (reach + 1.0).max(1.0))
            .clamp(0.0, 1.0),
        })
    }
}
struct SearchWork {
    visited: Band<u32>,
    distance: Band<f64>,
    visit: u32,
}
fn find_contact(
    field: &Field,
    p: &Settings,
    start: usize,
    work: &mut SearchWork,
) -> io::Result<Option<Contact>> {
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    let mut search = MaterialSearch::new();
    let fractions = field.ground().view(G::CrustContinentalFraction);
    let assemblies = field.shared.code(C::CrustAssemblyIds);
    work.visited.set(start, work.visit)?;
    work.distance.set(start, 0.0)?;
    queue.push(start as u32, [0.0]);
    while let Some((cell, [distance])) = queue.pop() {
        let cell = cell as usize;
        if distance != work.distance.get(cell)? {
            continue;
        }
        let assembly = assemblies.get(cell)?;
        if assembly > 0 && fractions.get(cell)? >= p.continental_suture_minimum_fraction {
            search.observe(assembly, distance);
        }
        if let Some(contact) = search.contact(p.continental_suture_detection_reach) {
            return Ok(Some(contact));
        }
        if distance >= p.continental_suture_detection_reach {
            continue;
        }
        expand(
            field,
            cell,
            distance,
            p.continental_suture_detection_reach,
            work,
            &mut queue,
        )?;
    }
    Ok(None)
}
fn expand(
    field: &Field,
    cell: usize,
    distance: f64,
    reach: f64,
    work: &mut SearchWork,
    queue: &mut KeyedHeap,
) -> io::Result<()> {
    for edge in 0..3 {
        let Some(next) = field.mesh.neighbor(cell, edge) else {
            continue;
        };
        let d = distance + field.mesh.edge_length(cell, edge);
        if d > reach || (work.visited.get(next)? == work.visit && work.distance.get(next)? <= d) {
            continue;
        }
        work.visited.set(next, work.visit)?;
        work.distance.set(next, d)?;
        queue.push(next as u32, [d]);
    }
    Ok(())
}
fn record(
    ground: &mut Ground,
    p: &Settings,
    c: &PhysicalContext,
    cell: usize,
    contact: Contact,
    strain: f64,
) -> io::Result<f64> {
    let collision = (strain * (0.55 + contact.proximity * 0.45))
        .round()
        .clamp(0.0, 1000.0);
    let pair = ground.view(G::CrustSuturePairIds).get(cell)? as i32;
    let strength = ground.view(G::CrustSutureStrength).get(cell)?;
    let matches = pair == contact.pair;
    if pair == 0 || matches || collision >= strength {
        let retained = if matches { strength } else { 0.0 };
        let rate = (p.continental_suture_strength_gain * collision * c.tectonic_strength
            / 1_000_000_000.0)
            .clamp(0.0, 1.0);
        let gain = (1000.0 - retained) * (1.0 - (1.0 - rate).powf(c.span));
        ground.record_suture(cell, contact.pair, (retained + gain).clamp(0.0, 1000.0))?;
    }
    let inherited = if ground.view(G::CrustSuturePairIds).get(cell)? as i32 == contact.pair {
        (ground.view(G::CrustSutureStrength).get(cell)? * strain / 1000.0).trunc()
    } else {
        0.0
    };
    Ok(collision.max(inherited))
}
impl Field {
    pub fn continental_sutures(settings: Settings) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "continental-sutures",
            CommandKind::Work,
            vec![],
            move |scope, context| {
                scope
                    .state_mut()
                    .update_sutures(&settings, context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn update_sutures(&mut self, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
        let mut work = SearchWork {
            visited: self.coverage.get_mut().allocate(0u32),
            distance: self.coverage.get_mut().allocate(0.0),
            visit: 0,
        };
        for cell in 0..self.mesh.len() {
            self.shared
                .scalar_mut(S::CrustCollisionIntensity)
                .set(cell, 0.0)?;
            let strain = self.shared.scalar(S::TectonicStrain).get(cell)?;
            if self.shared.code(C::TectonicBoundaryCodes).get(cell)? != 1 || strain <= 0.0 {
                continue;
            }
            work.visit = work
                .visit
                .checked_add(1)
                .ok_or_else(|| io::Error::other("Suture visits exceed numeric representation"))?;
            if let Some(contact) = find_contact(self, p, cell, &mut work)? {
                let intensity = record(
                    &mut self.ground.borrow_mut(),
                    p,
                    context,
                    cell,
                    contact,
                    strain,
                )?;
                self.shared
                    .scalar_mut(S::CrustCollisionIntensity)
                    .set(cell, intensity)?;
            }
        }
        Ok(())
    }
}
