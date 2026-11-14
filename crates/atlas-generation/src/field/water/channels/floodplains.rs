use super::Settings;
use crate::{
    field::{shared::Scalar as S, Field},
    hpc::RecordQueue,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, ReadBand},
    water::channel_geometry::{dominant_upstream, longitudinal_alignment, ChannelInputs},
};
use std::io;
pub fn living_support(verdure: f64, order: u16, water: u8) -> f64 {
    let green = verdure.clamp(0.0, 1.0);
    if green > 0.3 && order >= 1 && water == 0 {
        (600.0 * green).round()
    } else {
        0.0
    }
}
struct Work<'a, 'b> {
    input: &'a ChannelInputs<'b>,
    settings: &'a Settings,
    upstream: ReadBand<i32>,
    channel: ReadBand<f64>,
    deposition: ReadBand<f64>,
    relief_scale: f64,
    decay_length: f64,
}
impl Work<'_, '_> {
    fn can_flood(&self, source: usize, target: usize) -> io::Result<bool> {
        let p = self.settings;
        let i = self.input;
        Ok(i.kind.get(target)? == 0
            && self.channel.get(target)? == 0.0
            && i.basins.get(target)? == i.basins.get(source)?
            && i.slope.get(target)? <= p.floodplain_maximum_slope
            && (i.elevation.get(source)? - i.elevation.get(target)?).abs()
                <= MapScale::native(p.floodplain_maximum_relief)
            && longitudinal_alignment(i, &self.upstream, source, target)?
                <= p.floodplain_maximum_longitudinal_alignment / 1000.0)
    }
    fn seed(
        &self,
        source: usize,
        intensity: &mut Band<f64>,
        queue: &mut RecordQueue<1>,
    ) -> io::Result<()> {
        for edge in 0..3 {
            let Some(next) = self.input.mesh.neighbor(source, edge) else {
                continue;
            };
            if !self.can_flood(source, next)? {
                continue;
            }
            let value = (self.channel.get(source)?
                + MapScale::metres(self.deposition.get(next)?, LengthUnit::Native).round()
                    / self.relief_scale
                - self.input.slope.get(next)? * 60000.0)
                .clamp(1.0, 1000.0);
            if value <= intensity.get(next)? {
                continue;
            }
            intensity.set(next, value)?;
            queue.push(next as u32, [self.input.mesh.edge_length(source, edge)]);
        }
        Ok(())
    }
    fn expand(&self, intensity: &mut Band<f64>, queue: &mut RecordQueue<1>) -> io::Result<()> {
        while let Some((cell, [distance])) = queue.pop() {
            let cell = cell as usize;
            for edge in 0..3 {
                let Some(next) = self.input.mesh.neighbor(cell, edge) else {
                    continue;
                };
                if !self.can_flood(cell, next)? {
                    continue;
                }
                let length = self.input.mesh.edge_length(cell, edge);
                let relief = MapScale::metres(
                    (self.input.elevation.get(cell)? - self.input.elevation.get(next)?).abs(),
                    LengthUnit::Native,
                )
                .round();
                let value = intensity.get(cell)?
                    - self.settings.floodplain_intensity_decay * length / self.decay_length
                    - relief / self.relief_scale;
                if value <= intensity.get(next)? {
                    continue;
                }
                intensity.set(next, value)?;
                queue.push(next as u32, [distance + length]);
            }
        }
        Ok(())
    }
}
pub(super) fn run(field: &Field, p: &Settings, input: &ChannelInputs<'_>) -> io::Result<()> {
    let upstream = dominant_upstream(
        input,
        |cell| Ok(input.orders.get(cell)? > 0),
        &mut field.coverage.borrow_mut(),
    )?;
    let length = |fraction| -> io::Result<f64> {
        Ok(field
            .scale
            .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value())
    };
    let work = Work {
        input,
        settings: p,
        upstream: upstream.read_only(),
        channel: field.water().channels.strength,
        deposition: field.ground().view(GroundField::CumulativeDeposition),
        relief_scale: length(2.5e-7)?,
        decay_length: length(0.0025)?,
    };
    let mut intensity = field.shared.derive_scalar(S::FloodplainIntensity);
    for cell in 0..field.mesh.len() {
        intensity.set(cell, 0.0)?;
    }
    let mut queue = RecordQueue::default();
    let water = field.water.borrow();
    for reach in water.rivers().reaches() {
        if reach.dry() || reach.order() < p.floodplain_minimum_river_order {
            continue;
        }
        for (at, &cell) in reach.cells().iter().enumerate() {
            if input.kind.get(cell)? == 0 && reach.months_at(at) > 0 {
                work.seed(cell, &mut intensity, &mut queue)?;
            }
        }
    }
    work.expand(&mut intensity, &mut queue)?;
    let reader = water.river_reader();
    for cell in 0..field.mesh.len() {
        let kind = input.kind.get(cell)?;
        let living = living_support(
            field.shared.scalar(S::Verdure).get(cell)?,
            reader.order_at(cell, kind),
            kind,
        );
        let value = intensity.get(cell)?.max(living);
        intensity.set(cell, value)?;
    }
    Ok(())
}
