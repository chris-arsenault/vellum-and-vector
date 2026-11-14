use crate::{
    field::shared::Scalar as F,
    magic::{
        channels::Channel as C, configuration::Propagation, sources::Environment, state::MagicField,
    },
    metric::search::physical_distance,
    rock::{
        catalogue::{HARDEST_ROCK, SOFTEST_ROCK},
        ground::alteration::Alteration,
        material::MaterialLayer,
    },
    scale::{MapScale, RelativeMeasure},
    storage::{Band, Coverage},
};
use std::io;
pub struct Rims {
    pub(super) rim: Band<f64>,
    pub(super) ward_label: Band<i32>,
    pub(super) rim_label: Band<i32>,
}
impl Rims {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            rim: coverage.allocate(0.0),
            ward_label: coverage.allocate(-1),
            rim_label: coverage.allocate(-1),
        }
    }
    pub fn mark(&mut self, env: &Environment<'_>, coverage: &mut Coverage) -> io::Result<()> {
        for cell in 0..env.mesh.len() {
            self.rim.set(cell, 0.0)?;
            self.ward_label.set(cell, -1)?;
            self.rim_label.set(cell, -1)?;
        }
        let mut ring = 0;
        for start in 0..env.mesh.len() {
            if env.scalar(F::Warding, start)? <= 0.0 || self.ward_label.get(start)? >= 0 {
                continue;
            }
            self.label_ring(env, start, ring)?;
            ring += 1;
        }
        self.spread(env, coverage)
    }
    fn label_ring(&mut self, env: &Environment<'_>, start: usize, ring: i32) -> io::Result<()> {
        let mut queue = vec![start];
        self.ward_label.set(start, ring)?;
        let mut head = 0;
        while head < queue.len() {
            let cell = queue[head];
            head += 1;
            for edge in 0..3 {
                let Some(next) = env.mesh.neighbor(cell, edge) else {
                    continue;
                };
                if env.scalar(F::Warding, next)? > 0.0 && self.ward_label.get(next)? < 0 {
                    self.ward_label.set(next, ring)?;
                    queue.push(next);
                }
            }
        }
        Ok(())
    }
    fn spread(&mut self, env: &Environment<'_>, coverage: &mut Coverage) -> io::Result<()> {
        let mut distance = coverage.scratch(env.mesh.len(), f64::INFINITY);
        let width = env
            .scale
            .resolve(RelativeMeasure::length(0.00125).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let mut seeds = Vec::new();
        for cell in 0..env.mesh.len() {
            let ring = self.ward_label.get(cell)?;
            if ring >= 0 {
                distance.set(cell, 0.0)?;
                self.rim_label.set(cell, ring)?;
                seeds.push(cell);
            }
        }
        physical_distance(
            env.mesh,
            seeds,
            &mut distance,
            width + env.mesh.spacing(),
            |next, cell| self.rim_label.set(next, self.rim_label.get(cell)?),
        )?;
        for cell in 0..env.mesh.len() {
            let fraction = if env.scalar(F::Warding, cell)? > 0.0 {
                0.0
            } else {
                rim_fraction(distance.get(cell)?, width, env.mesh.area(cell).sqrt())
            };
            self.rim.set(cell, fraction)?;
            if fraction <= 0.0 {
                self.rim_label.set(cell, -1)?;
            }
        }
        Ok(())
    }
    fn amounts(
        &self,
        env: &Environment<'_>,
        coverage: &mut Coverage,
        removed: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<Band<f64>> {
        let mut amounts = coverage.scratch(env.mesh.len(), 0.0);
        for cell in 0..env.mesh.len() {
            let ring = self.ward_label.get(cell)?;
            if ring >= 0 {
                let ring = ring as usize;
                amounts.set(
                    ring,
                    amounts.get(ring)? + removed(cell)? * env.mesh.area(cell),
                )?;
            }
        }
        Ok(amounts)
    }
    fn receiving_area(
        &self,
        env: &Environment<'_>,
        coverage: &mut Coverage,
        accepts: impl Fn(usize) -> io::Result<bool>,
    ) -> io::Result<Band<f64>> {
        let mut area = coverage.scratch(env.mesh.len(), 0.0);
        for cell in 0..env.mesh.len() {
            let ring = self.rim_label.get(cell)?;
            if ring >= 0 && accepts(cell)? {
                let ring = ring as usize;
                area.set(
                    ring,
                    area.get(ring)? + env.mesh.area(cell) * self.rim.get(cell)?,
                )?;
            }
        }
        Ok(area)
    }
    pub fn apply(
        &self,
        env: &Environment<'_>,
        field: &mut MagicField,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if field.definition.enabled && field.definition.effects.warding > 0.0 {
            return Ok(());
        }
        let amounts = self.amounts(env, coverage, |cell| {
            Ok(field.channels.band(C::Intensity).get(cell)? * env.scalar(F::Warding, cell)?)
        })?;
        let area = self.receiving_area(env, coverage, |cell| accepts_rim(env, field, cell))?;
        for cell in 0..env.mesh.len() {
            let source = self.ward_label.get(cell)?;
            if source >= 0 {
                let value = field.channels.band(C::Intensity).get(cell)?;
                field.channels.band_mut(C::Intensity).set(
                    cell,
                    warded_intensity(
                        value,
                        env.scalar(F::Warding, cell)?,
                        area.get(source as usize)?,
                    ),
                )?;
            }
            let ring = self.rim_label.get(cell)?;
            if ring < 0 || !accepts_rim(env, field, cell)? {
                continue;
            }
            let amount = amounts.get(ring as usize)?;
            let area = area.get(ring as usize)?;
            if amount > 0.0 && area > 0.0 {
                let value = field.channels.band(C::Intensity).get(cell)?
                    + amount / area * self.rim.get(cell)?;
                field
                    .channels
                    .band_mut(C::Intensity)
                    .set(cell, (value + 0.5).floor().clamp(0.0, 1000.0))?;
            }
        }
        Ok(())
    }
    pub fn redirect_storm(
        &self,
        env: &mut Environment<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let amounts = self.amounts(env, coverage, |cell| {
            Ok(env.scalar(F::StormTrack, cell)? * env.scalar(F::Warding, cell)?)
        })?;
        let area = self.receiving_area(env, coverage, |_| Ok(true))?;
        for cell in 0..env.mesh.len() {
            let ring = self.rim_label.get(cell)?;
            if ring < 0 {
                continue;
            }
            let total = amounts.get(ring as usize)?;
            let area = area.get(ring as usize)?;
            if total > 0.0 && area > 0.0 {
                let value =
                    env.scalar(F::StormForcing, cell)? + total / area * self.rim.get(cell)?;
                env.fields
                    .scalar_mut(F::StormForcing)
                    .set(cell, (value + 0.5).floor().clamp(0.0, 1000.0))?;
            }
        }
        Ok(())
    }
}
pub fn rim_fraction(distance: f64, width: f64, sample_span: f64) -> f64 {
    ((width + sample_span - distance) / sample_span).clamp(0.0, (width / sample_span).min(1.0))
}
pub fn warded_intensity(value: f64, warding: f64, receiver_area: f64) -> f64 {
    if receiver_area > 0.0 {
        (value * (1.0 - warding) + 0.5).floor()
    } else {
        value
    }
}
fn accepts_rim(env: &Environment<'_>, field: &MagicField, cell: usize) -> io::Result<bool> {
    if field
        .definition
        .origins
        .iter()
        .any(|o| o.propagation == Propagation::OceanRays)
    {
        return Ok(env.water.column.kind.get(cell)? == 1);
    }
    if field
        .definition
        .origins
        .iter()
        .any(|o| o.propagation == Propagation::Roots)
    {
        return Ok(env.land_without_ice(cell)?
            && env.scalar(F::TreeCover, cell)?
                + env.scalar(F::GrassCover, cell)?
                + env.scalar(F::WetlandCover, cell)?
                > 0.0);
    }
    Ok(env.water.column.kind.get(cell)? != 1)
}
pub fn spill_below(env: &mut Environment<'_>, field: &MagicField) -> io::Result<()> {
    let depth = MapScale::native(
        env.scale
            .resolve(RelativeMeasure::length(0.000035).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value(),
    );
    let epoch = env.ground.completed_epochs();
    for cell in 0..env.mesh.len() {
        let warding = env.scalar(F::Warding, cell)?;
        let target = env.water.routing.targets.get(cell)?;
        if warding <= 0.0 || target < 0 {
            continue;
        }
        let target = target as usize;
        if env.scalar(F::Warding, target)? > 0.0 || env.water.column.kind.get(target)? != 0 {
            continue;
        }
        let change = -(field.definition.parameters.ward_spill * warding + 0.5).floor();
        if change == 0.0 {
            continue;
        }
        env.ground.alter(
            target,
            &Alteration {
                depth,
                offset: 0.0,
                from_rock: false,
                retained_only: false,
                facet: None,
                transform: &|layer| {
                    Some(MaterialLayer {
                        strength: (layer.strength + change).clamp(SOFTEST_ROCK, HARDEST_ROCK),
                        altered: epoch,
                        ..layer.clone()
                    })
                },
            },
        )?;
    }
    Ok(())
}
