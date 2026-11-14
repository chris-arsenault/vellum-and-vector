//! Standalone source fields and their signed elapsed histories on the private GIS surface.
use super::{Quantity, Surface, Values};
use crate::{
    atlas::history::{Cause, FieldSummary},
    field::{landmarks::magic::Source, schema::NumericBand},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    spatial::SpatialKernel,
    storage::Band,
};
use atlas_map::Position;
use std::io;

pub struct Activity {
    pub source: f64,
    pub heat: f64,
    pub cold: f64,
    pub epoch: usize,
}
impl Activity {
    fn multiplier(&self, source: &Source) -> f64 {
        if (self.epoch as i64) < i64::from(source.starts_at_epoch) {
            0.0
        } else {
            self.source
                * if source.effect == "cold" {
                    self.cold
                } else {
                    self.heat
                }
        }
    }
}
pub fn sources<'a>(
    sources: &'a [Source],
    space: &'a str,
    thermal: bool,
) -> impl Iterator<Item = &'a Source> {
    sources.iter().filter(move |source| {
        source.system_id.is_none()
            && ["heat", "cold"].contains(&source.effect.as_str()) == thermal
            && source.space_id.as_deref().is_none_or(|id| id == space)
    })
}
impl Surface {
    pub fn require_channel(&self, name: &str, unit: &str) -> io::Result<NumericBand> {
        let channel = self
            .channels
            .get(name)
            .filter(|channel| channel.unit == unit)
            .ok_or_else(|| {
                io::Error::other(format!(
                    "{name} requires {unit} samples on the working grid"
                ))
            })?;
        let values = channel.values();
        if values.len() != self.active.len() {
            return Err(io::Error::other("Surface channel length differs from grid"));
        }
        for cell in 0..values.len() {
            if !values.get(cell)?.is_finite() {
                return Err(io::Error::other(format!("{name} requires finite samples")));
            }
        }
        Ok(values)
    }
    pub fn summarize_channel(&self, name: &str) -> io::Result<FieldSummary> {
        let unit = self
            .channels
            .get(name)
            .ok_or_else(|| io::Error::other("Missing summary channel"))?
            .unit
            .clone();
        let values = self.require_channel(name, &unit)?;
        let (mut minimum, mut maximum, mut total, mut area) =
            (f64::INFINITY, f64::NEG_INFINITY, 0.0, 0.0);
        for cell in 0..values.len() {
            let measure = self.grid.measures.get(cell)?;
            if measure == 0.0 {
                continue;
            }
            let value = values.get(cell)?;
            minimum = minimum.min(value);
            maximum = maximum.max(value);
            total += value * measure;
            area += measure;
        }
        if area <= 0.0 {
            return Err(io::Error::other(
                "Physical summaries need a positive mapped area",
            ));
        }
        Ok(FieldSummary {
            unit,
            minimum,
            maximum,
            mean: total / area,
        })
    }
    fn value_or(&self, name: &str, cell: usize, default: f64) -> io::Result<f64> {
        self.channels
            .get(name)
            .map(|channel| channel.values().get(cell))
            .transpose()
            .map(|v| v.unwrap_or(default))
    }
    fn weight(&self, source: &Source, cell: usize, lapse: f64) -> io::Result<f64> {
        Ok(match source.propagation.as_str() {
            "fracture" => 0.1 + 0.0009 * self.value_or("FractureConductance", cell, 0.0)?,
            "ocean" => f64::from(
                self.value_or("Elevation", cell, 0.0)?
                    < self.value_or("EffectiveSeaLevel", cell, 0.0)?,
            ),
            "cold" => {
                let temperature = self.value_or(
                    "Temperature",
                    cell,
                    450.0
                        - 10.0
                            * MapScale::metres(
                                self.value_or("Elevation", cell, 0.0)?,
                                LengthUnit::Native,
                            )
                            * lapse,
                )?;
                ((20.0 - (temperature / 10.0 - 30.0)) / 30.0).clamp(0.0, 1.0)
            }
            _ => 1.0,
        })
    }
    pub fn local_forcing(
        &mut self,
        source: &Source,
        activity: &Activity,
        spatial: &dyn SpatialKernel,
        active_only: bool,
    ) -> io::Result<Band<f64>> {
        let scale = MapScale::from_cells(self.grid.bounds, self.active.len() as f64)
            .map_err(io::Error::other)?;
        let lapse = scale
            .resolve(
                RelativeMeasure::new(26000.0, -1.0, 1.0, LengthUnit::Metre)
                    .map_err(io::Error::other)?,
            )
            .map_err(io::Error::other)?
            .value();
        let positions = (0..self.active.len())
            .map(|cell| self.grid.position(cell).map(|p| Position::xy(p[0], p[1])))
            .collect::<io::Result<Vec<_>>>()?;
        let covered = source
            .scope
            .as_ref()
            .map(|shape| {
                spatial
                    .covers_points(shape, &positions)
                    .map_err(io::Error::other)
            })
            .transpose()?;
        let mut values = self.coverage.allocate(0.0);
        let multiplier = activity.multiplier(source);
        for (cell, position) in positions.iter().enumerate() {
            if covered.as_ref().is_some_and(|mask| !mask[cell])
                || (active_only && self.active.get(cell)? == 0)
            {
                continue;
            }
            let [x, y, _] = position.coordinates();
            let distance = (x - source.source.x).hypot(y - source.source.y);
            let forcing = source.strength
                * (1.0 - distance / source.radius).max(0.0)
                * multiplier
                * self.weight(source, cell, lapse)?;
            values.set(
                cell,
                if source.effect == "cold" {
                    -forcing
                } else {
                    forcing
                },
            )?;
        }
        Ok(values)
    }
    fn stored(&mut self, name: &str) -> io::Result<Band<f64>> {
        let previous = if self.channels.contains_key(name) {
            Some(self.require_channel(name, "celsius")?)
        } else {
            None
        };
        let mut values = self.coverage.allocate(0.0);
        if let Some(previous) = previous {
            for cell in 0..values.len() {
                values.set(cell, previous.get(cell)?)?;
            }
        }
        Ok(values)
    }
    pub fn thermal_sources(
        &mut self,
        sources: &[Source],
        space: &str,
        activity: &Activity,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<Cause>> {
        let mut heat = self.coverage.allocate(0.0);
        let mut stored = self.coverage.allocate(0.0);
        let mut causes = Vec::new();
        for source in self::sources(sources, space, true) {
            let key = format!("magic:{}:stored", source.id);
            let memory = self.stored(&key)?;
            let forcing = self.local_forcing(source, activity, spatial, false)?;
            let mut total = self.coverage.allocate(0.0);
            for cell in 0..heat.len() {
                total.set(cell, forcing.get(cell)? + memory.get(cell)?)?;
                heat.set(cell, heat.get(cell)? + total.get(cell)?)?;
                stored.set(cell, stored.get(cell)? + memory.get(cell)?)?;
            }
            let forcing_key = format!("magic:{}:forcing", source.id);
            self.put(
                &forcing_key,
                "celsius",
                Quantity::Intensive,
                Values::F64(forcing),
            );
            self.put(&key, "celsius", Quantity::Intensive, Values::F64(memory));
            self.put(
                &format!("magic:{}", source.id),
                "celsius",
                Quantity::Intensive,
                Values::F64(total),
            );
            causes.push(Cause::Magic {
                process: "magic.thermal".into(),
                source_id: source.id.clone(),
                activity: activity.multiplier(source),
                forcing: self.summarize_channel(&forcing_key)?,
                stored: self.summarize_channel(&key)?,
            });
        }
        self.put("Heat", "celsius", Quantity::Intensive, Values::F64(heat));
        self.put(
            "StoredHeat",
            "celsius",
            Quantity::Intensive,
            Values::F64(stored),
        );
        self.require_channel("Heat", "celsius")?;
        self.require_channel("StoredHeat", "celsius")?;
        Ok(causes)
    }
    pub fn advance_local_storage(
        &mut self,
        sources: &[Source],
        space: &str,
        years: f64,
        current: &[Cause],
    ) -> io::Result<Vec<Cause>> {
        let mut causes = Vec::new();
        for source in self::sources(sources, space, true) {
            if current.iter().chain(&causes).any(|cause| matches!(cause, Cause::Magic {process, source_id, ..} if process == "magic.advanceStorage" && source_id == &source.id)) {
                return Err(io::Error::other("A source's storage advances once per epoch; thermal refresh does not advance time"));
            }
            if !(0.0..=1.0).contains(&source.decay) || source.storage < 0.0 {
                return Err(io::Error::other(
                    "Magic storage and annual decay have valid nonnegative values",
                ));
            }
            let key = format!("magic:{}:stored", source.id);
            let forcing_key = format!("magic:{}:forcing", source.id);
            let mut memory = self.stored(&key)?;
            let forcing = self.require_channel(&forcing_key, "celsius")?;
            let retention = (1.0 - source.decay).powf(years);
            let rate = -(-source.decay).ln_1p();
            let loading = if years == 0.0 {
                0.0
            } else if source.decay == 0.0 {
                years
            } else {
                -(-rate * years).exp_m1() / rate
            };
            for cell in 0..memory.len() {
                memory.set(
                    cell,
                    memory.get(cell)? * retention + forcing.get(cell)? * source.storage * loading,
                )?;
            }
            self.put(&key, "celsius", Quantity::Intensive, Values::F64(memory));
            let activity = current
                .iter()
                .rev()
                .find_map(|cause| match cause {
                    Cause::Magic {
                        process,
                        source_id,
                        activity,
                        ..
                    } if process == "magic.thermal" && source_id == &source.id => Some(*activity),
                    _ => None,
                })
                .unwrap_or(0.0);
            causes.push(Cause::Magic {
                process: "magic.advanceStorage".into(),
                source_id: source.id.clone(),
                activity,
                forcing: self.summarize_channel(&forcing_key)?,
                stored: self.summarize_channel(&key)?,
            });
        }
        Ok(causes)
    }
}
