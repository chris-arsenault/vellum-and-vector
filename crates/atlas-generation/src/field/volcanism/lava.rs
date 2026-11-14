use super::{settings::Settings, Field, C, S};
use crate::{
    processes::runner::PhysicalContext,
    rock::{catalogue, ground::deposition::pond_level},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::{removal::Facet, stage::Pool},
    storage::Band,
};
use std::{collections::VecDeque, io};

pub(super) struct Eruption {
    pub source: usize,
    pub volume: f64,
    pub pending: f64,
    pub radius: f64,
}
pub(super) struct Lava {
    mobile: Band<f64>,
    heat: Band<f64>,
    queued: Band<u8>,
    queue: VecDeque<usize>,
}
struct Destinations {
    neighbors: [usize; 3],
    offers: [f64; 3],
    lengths: [f64; 3],
    count: usize,
    offered: f64,
    shortest: f64,
}
impl Lava {
    pub fn new(field: &mut Field) -> Self {
        let n = field.mesh.len();
        let coverage = field.coverage.get_mut();
        Self {
            mobile: coverage.scratch(n, 0.0),
            heat: coverage.scratch(n, 0.0),
            queued: coverage.scratch(n, 0),
            queue: VecDeque::new(),
        }
    }
    pub fn erupt(
        &mut self,
        field: &mut Field,
        p: &Settings,
        context: &PhysicalContext,
        source: usize,
        fresh: f64,
    ) -> io::Result<Eruption> {
        let mut result = Eruption {
            source,
            volume: 0.0,
            pending: 0.0,
            radius: 0.0,
        };
        if fresh <= 0.0 {
            return Ok(result);
        }
        let stored = MapScale::metres(
            field.shared.scalar(S::VolcanicMeltSupply).get(source)?,
            LengthUnit::Native,
        ) * field.mesh.area(source);
        field
            .shared
            .scalar_mut(S::VolcanicMeltSupply)
            .set(source, 0.0)?;
        self.solidify(field, context, source, stored, &mut result)?;
        self.add(source, fresh, p.lava_cooling_distance)?;
        while let Some(cell) = self.queue.pop_front() {
            self.queued.set(cell, 0)?;
            self.advance(field, p, context, cell, &mut result)?;
        }
        Ok(result)
    }
    fn add(&mut self, cell: usize, volume: f64, mobility: f64) -> io::Result<()> {
        if volume <= 0.0 {
            return Ok(());
        }
        self.mobile.set(cell, self.mobile.get(cell)? + volume)?;
        self.heat
            .set(cell, self.heat.get(cell)? + volume * mobility)?;
        if self.queued.get(cell)? == 0 {
            self.queued.set(cell, 1)?;
            self.queue.push_back(cell);
        }
        Ok(())
    }
    fn level(field: &Field, cell: usize, volume: f64) -> io::Result<f64> {
        let ground = field.ground();
        Ok(pond_level(
            MapScale::metres(ground.surface(cell, Facet::Land)?, LengthUnit::Native),
            ground.share(cell, Facet::Land)?,
            MapScale::metres(ground.surface(cell, Facet::Cut)?, LengthUnit::Native),
            ground.share(cell, Facet::Cut)?,
            volume / field.mesh.area(cell),
        ))
    }
    fn destinations(
        &self,
        field: &Field,
        p: &Settings,
        cell: usize,
        volume: f64,
        mobility: f64,
    ) -> io::Result<Destinations> {
        let mut result = Destinations {
            neighbors: [0; 3],
            offers: [0.0; 3],
            lengths: [0.0; 3],
            count: 0,
            offered: 0.0,
            shortest: f64::INFINITY,
        };
        let head = Self::level(field, cell, volume)?;
        let depth = volume / field.mesh.area(cell);
        let gradient = if depth > 0.0 {
            p.lava_yield_height.max(0.0) / depth
        } else {
            f64::INFINITY
        };
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            let distance = field.mesh.edge_length(cell, edge);
            if distance <= 0.0 || distance >= mobility {
                continue;
            }
            let excess = head
                - Self::level(field, next, self.mobile.get(next)?)?
                - gradient.max(0.0) * distance;
            let amount =
                excess.max(0.0) / (1.0 / field.mesh.area(cell) + 1.0 / field.mesh.area(next));
            if amount <= 0.0 {
                continue;
            }
            result.neighbors[result.count] = next;
            result.offers[result.count] = amount;
            result.lengths[result.count] = distance;
            result.count += 1;
            result.offered += amount;
            result.shortest = result.shortest.min(distance);
        }
        Ok(result)
    }
    fn advance(
        &mut self,
        field: &mut Field,
        p: &Settings,
        context: &PhysicalContext,
        cell: usize,
        result: &mut Eruption,
    ) -> io::Result<()> {
        let volume = self.mobile.get(cell)?;
        if volume <= 0.0 {
            return Ok(());
        }
        let mobility = self.heat.get(cell)? / volume;
        let d = self.destinations(field, p, cell, volume, mobility)?;
        let movable = if d.count > 0 && mobility > 0.0 {
            volume * (1.0 - d.shortest / mobility).max(0.0)
        } else {
            0.0
        };
        let scale = if d.offered > 0.0 {
            (movable / d.offered).min(1.0)
        } else {
            0.0
        };
        self.mobile.set(cell, 0.0)?;
        self.heat.set(cell, 0.0)?;
        let mut moved = 0.0;
        for n in 0..d.count {
            let amount = d.offers[n] * scale;
            moved += amount;
            self.add(d.neighbors[n], amount, mobility - d.lengths[n])?;
        }
        self.solidify(field, context, cell, (volume - moved).max(0.0), result)
    }
    fn solidify(
        &self,
        field: &mut Field,
        context: &PhysicalContext,
        cell: usize,
        volume: f64,
        result: &mut Eruption,
    ) -> io::Result<()> {
        if volume <= 0.0 {
            return Ok(());
        }
        let level = Self::level(field, cell, volume)?;
        let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
        let mut material = catalogue::material(catalogue::BASALT, 0.0, ground.completed_epochs());
        let mut accepted = 0.0;
        for facet in Facet::ALL {
            if ground.share(cell, facet)? <= 0.0 {
                continue;
            }
            material.depth = (MapScale::in_units(level, LengthUnit::Native)
                - ground.surface(cell, facet)?)
            .max(0.0);
            if material.depth > 0.0 {
                accepted += ground.construct_material(
                    cell,
                    &material,
                    "volcanoes",
                    Pool::Melt,
                    Some(facet),
                )?;
            }
        }
        drop(ground);
        let landed = MapScale::metres(accepted, LengthUnit::Native) * field.mesh.area(cell);
        let pending = (volume - landed).max(0.0);
        let supply = field.shared.scalar_mut(S::VolcanicMeltSupply);
        supply.set(
            cell,
            supply.get(cell)?
                + MapScale::in_units(pending / field.mesh.area(cell), LengthUnit::Native),
        )?;
        result.pending += pending;
        result.volume += landed;
        if landed > 0.0 {
            self.mark(field, context, cell, accepted, result)?;
        }
        Ok(())
    }
    fn mark(
        &self,
        field: &mut Field,
        context: &PhysicalContext,
        cell: usize,
        accepted: f64,
        result: &mut Eruption,
    ) -> io::Result<()> {
        let unit = field
            .scale
            .resolve(RelativeMeasure::length(0.00000025).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let activity = (MapScale::metres(accepted, LengthUnit::Native) / unit).clamp(0.0, 1000.0);
        let at = field.mesh.position(cell);
        let source = field.mesh.position(result.source);
        let distance = field
            .mesh
            .delta_x(at[0] - source[0])
            .hypot(at[1] - source[1]);
        result.radius = result.radius.max(distance + field.scale.cells(0.5));
        let history = field.shared.scalar_mut(S::VolcanicConstructionHistory);
        history.set(cell, history.get(cell)? + accepted)?;
        let band = field.shared.scalar_mut(S::VolcanicActivity);
        band.set(cell, band.get(cell)?.max(activity))?;
        field
            .shared
            .code_mut(C::VolcanicLastActiveEpoch)
            .set(cell, context.epoch_index.max(0))?;
        let band = field.shared.scalar_mut(S::FractureConductance);
        band.set(cell, band.get(cell)?.max(activity * 0.7))?;
        let flags = field.shared.code_mut(C::FeatureFlags);
        flags.set(
            cell,
            flags.get(cell)? | (1 << 10) | if cell == result.source { 1 << 8 } else { 0 },
        )?;
        Ok(())
    }
}
