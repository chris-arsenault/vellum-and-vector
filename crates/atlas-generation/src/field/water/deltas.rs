use super::failure;
use crate::{
    execution::{Query, QueryDependency},
    field::{
        shared::{CellCode as C, Scalar as S},
        Field,
    },
    flow_graph,
    hpc::RecordQueue,
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    storage::{Band, ReadBand},
    water::{
        network::{RiverReader, RiverTerrain},
        WaterView,
    },
};
use serde::Deserialize;
use std::{io, rc::Rc};
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "DeltaMinimumRiverOrder":2,"DeltaDischargeMultiplier":3,
        "DeltaMinimumSedimentDelivery":{"kind":"relative-measure","fraction":1.5625e-12,"dimension":3,"exponent":1},
        "RiverAccumulationThreshold":{"kind":"relative-measure","fraction":6.25e-19,"dimension":3,"exponent":1},
        "DeltaMaximumWaveEnergy":760,"DeltaMaximumCurrentStrength":900,"DeltaIntensityDecay":240,"DeltaMinimumForwardAlignment":80
    }})).expect("Declared delta settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    delta_minimum_river_order: u16,
    delta_discharge_multiplier: f64,
    delta_minimum_sediment_delivery: f64,
    river_accumulation_threshold: f64,
    delta_maximum_wave_energy: f64,
    delta_maximum_current_strength: f64,
    delta_intensity_decay: f64,
    delta_minimum_forward_alignment: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
fn step(mesh: &TriangularLattice, source: usize, target: usize) -> [f32; 3] {
    let from = mesh.position(source);
    let to = mesh.position(target);
    let x = mesh.delta_x(to[0] - from[0]) as f32;
    let y = (to[1] - from[1]) as f32;
    let length = (x * x + y * y).sqrt();
    [x, y, if length == 0.0 { 1.0 } else { length }]
}
fn forward(
    mesh: &TriangularLattice,
    source: usize,
    target: usize,
    direction: [f32; 2],
    minimum: f64,
) -> bool {
    let [x, y, length] = step(mesh, source, target);
    (x * direction[0] + y * direction[1]) / length >= (minimum / 1000.0) as f32
}
fn delivery(field: &Field, water: &WaterView, reader: &RiverReader<'_>) -> io::Result<Band<f64>> {
    let mut targets = field.coverage.borrow_mut().scratch(field.mesh.len(), -1i32);
    let terrain = RiverTerrain {
        mesh: &field.mesh,
        water_kind: &water.column.kind,
        targets: &water.routing.targets,
    };
    for cell in 0..field.mesh.len() {
        let reach = reader.at(cell).filter(|reach| !reach.dry());
        let target = if reach.is_some() && water.column.kind.get(cell)? == 0 {
            reader
                .successor(cell, reach, &terrain)?
                .map_or(-1, |cell| cell as i32)
        } else {
            water.routing.targets.get(cell)?
        };
        targets.set(cell, target)?;
    }
    flow_graph::gathered(
        &mut field.coverage.borrow_mut(),
        &targets.read_only(),
        |cell| {
            Ok(MapScale::metres(
                field.shared.scalar(S::CumulativeFluvialErosion).get(cell)?
                    + field.shared.scalar(S::CumulativeGlacialErosion).get(cell)?,
                LengthUnit::Native,
            ) * field.mesh.area(cell))
        },
        |_, amount| Ok(amount),
    )
}
struct Work<'a> {
    field: &'a Field,
    water: WaterView,
    settings: &'a Settings,
    zones: ReadBand<i32>,
    decay_length: f64,
}
impl Work<'_> {
    fn qualifies(
        &self,
        delivery: &Band<f64>,
        reader: &RiverReader<'_>,
        mouth: usize,
        ocean: usize,
    ) -> io::Result<bool> {
        let p = self.settings;
        let order = reader.order_at(mouth, self.water.column.kind.get(mouth)?);
        let amount = reader.water_at(mouth, false, self.water.flow.mean.get(mouth)?);
        Ok((order >= p.delta_minimum_river_order
            || amount >= p.river_accumulation_threshold * p.delta_discharge_multiplier)
            && delivery.get(mouth)? >= p.delta_minimum_sediment_delivery
            && self.field.shared.scalar(S::WaveExposure).get(ocean)? <= p.delta_maximum_wave_energy
            && self
                .field
                .shared
                .scalar(S::OceanCurrentStrength)
                .get(ocean)?
                <= p.delta_maximum_current_strength
            && self.zones.get(ocean)? != 4)
    }
    fn receives(&self, mouth: usize, cell: usize) -> io::Result<bool> {
        Ok(match self.water.column.kind.get(cell)? {
            2 => false,
            1 => self.zones.get(cell)? != 4,
            _ => self.water.routing.basins.get(cell)? == self.water.routing.basins.get(mouth)?,
        })
    }
    fn fan(&self, mouth: usize, ocean: usize, intensity: &mut Band<f64>) -> io::Result<()> {
        let mesh = &self.field.mesh;
        let [x, y, length] = step(mesh, mouth, ocean);
        let direction = [x / length, y / length];
        let mut queue = RecordQueue::<2>::default();
        queue.push(
            ocean as u32,
            [mesh.physical_distance(mouth, ocean), mouth as f64],
        );
        intensity.set(mouth, 1000.0)?;
        while let Some((cell, [depth, previous])) = queue.pop() {
            let cell = cell as usize;
            if !self.receives(mouth, cell)? {
                continue;
            }
            let value = 1000.0 - depth / self.decay_length * self.settings.delta_intensity_decay;
            if value <= intensity.get(cell)? {
                continue;
            }
            intensity.set(cell, value.clamp(1.0, 1000.0))?;
            for edge in 0..3 {
                let Some(next) = mesh.neighbor(cell, edge) else {
                    continue;
                };
                if next == previous as usize
                    || !forward(
                        mesh,
                        cell,
                        next,
                        direction,
                        self.settings.delta_minimum_forward_alignment,
                    )
                {
                    continue;
                }
                queue.push(
                    next as u32,
                    [depth + mesh.physical_distance(cell, next), cell as f64],
                );
            }
        }
        Ok(())
    }
}
impl Field {
    pub fn delta_formation(
        p: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "river-delta-formation",
            dependencies,
            move |field: &Field, _| run(field, &p).map_err(failure),
        )
    }
}
fn run(field: &Field, p: &Settings) -> io::Result<()> {
    let water = field.water();
    let owner = field.water.borrow();
    let reader = owner.river_reader();
    let delivery = delivery(field, &water, &reader)?;
    let work = Work {
        field,
        water,
        settings: p,
        zones: field.shared.code(C::BathymetricZoneCodes),
        decay_length: field
            .scale
            .resolve(RelativeMeasure::length(0.0025).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value(),
    };
    let terrain = RiverTerrain {
        mesh: &field.mesh,
        water_kind: &work.water.column.kind,
        targets: &work.water.routing.targets,
    };
    let mut intensity = field.shared.derive_scalar(S::DeltaIntensity);
    for cell in 0..field.mesh.len() {
        intensity.set(cell, 0.0)?;
    }
    for cell in 0..field.mesh.len() {
        if reader.order_at(cell, work.water.column.kind.get(cell)?) == 0 {
            continue;
        }
        let Some(ocean) = reader.successor(cell, None, &terrain)? else {
            continue;
        };
        if work.water.column.kind.get(ocean)? == 1
            && work.qualifies(&delivery, &reader, cell, ocean)?
        {
            work.fan(cell, ocean, &mut intensity)?;
        }
    }
    Ok(())
}
