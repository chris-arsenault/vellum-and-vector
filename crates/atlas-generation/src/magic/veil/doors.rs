use crate::{
    hpc::{radix_order, BitSet, Direction, NumericKey},
    magic::{
        channels::Channel as C,
        hallowed::WARD_SEALS,
        sources::{Context, Environment},
        state::{Door, LocatedSource, MagicField},
    },
    spatial::SpatialKernel,
    storage::ReadBand,
};
use atlas_map::{Geometry, Position};
use std::io;
pub struct Conditions {
    pub still: Option<ReadBand<f64>>,
    pub fire: Option<ReadBand<f64>>,
}
impl Conditions {
    pub fn for_field(fields: &[MagicField], field: &MagicField) -> Self {
        let others = || {
            fields
                .iter()
                .filter(|other| other.definition.enabled && !std::ptr::eq(*other, field))
        };
        Self {
            still: others()
                .find(|f| f.definition.effects.stillness > 0.0)
                .map(|f| f.channel(C::Stored)),
            fire: others()
                .find(|f| f.definition.effects.conduit_opening > 0.0)
                .map(|f| f.channel(C::Source)),
        }
    }
    pub fn holds_open(
        &self,
        env: &Environment<'_>,
        field: &MagicField,
        strength: &ReadBand<f64>,
        cell: usize,
        threshold: f64,
    ) -> io::Result<bool> {
        self.holds_with_ward(
            field,
            strength,
            cell,
            threshold,
            env.scalar(crate::field::shared::Scalar::Warding, cell)?,
        )
    }
    pub fn holds_with_ward(
        &self,
        field: &MagicField,
        strength: &ReadBand<f64>,
        cell: usize,
        threshold: f64,
        warding: f64,
    ) -> io::Result<bool> {
        Ok(strength.get(cell)? >= threshold
            && !self.ruptured(cell)?
            && field.channels.band(C::Wild).get(cell)? < 0.1
            && warding < WARD_SEALS
            && match &self.still {
                Some(still) => still.get(cell)? < 300.0,
                None => true,
            })
    }
    pub fn ruptured(&self, cell: usize) -> io::Result<bool> {
        Ok(match &self.fire {
            Some(fire) => fire.get(cell)? > 0.0,
            None => false,
        })
    }
    fn eligible(
        &self,
        env: &Environment<'_>,
        field: &mut MagicField,
        strength: &ReadBand<f64>,
        cell: usize,
        threshold: f64,
    ) -> io::Result<bool> {
        if strength.get(cell)? >= threshold && self.ruptured(cell)? {
            field.channels.band_mut(C::Wild).set(cell, 1.0)?;
        }
        self.holds_open(env, field, strength, cell, threshold)
    }
}
pub fn pair(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    conditions: &Conditions,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    let origin = field
        .definition
        .origins
        .iter()
        .position(|origin| origin.id == "tear");
    if origin.is_none() || context.activity <= 0.0 {
        field.doors.clear();
        return Ok(());
    }
    let strength = field.origins[origin.expect("Tear origin checked")]
        .source
        .read_only();
    let p = field.origin_parameters(context.origin);
    let mut used = BitSet::new(env.mesh.len());
    let mut doors = Vec::new();
    for door in std::mem::take(&mut field.doors) {
        if conditions.eligible(env, field, &strength, door.a, p.door_strain)?
            && conditions.eligible(env, field, &strength, door.b, p.door_strain)?
        {
            used.add(door.a);
            used.add(door.b);
            doors.push(door);
        }
    }
    let candidates = candidates(env, field, conditions, &strength, &used, p.door_strain)?;
    let selection = Partners {
        candidates: &candidates,
        strength: &strength,
        span: p.door_distance,
        matching: p.door_match,
        kernel,
    };
    for &a in &candidates {
        if used.has(a) {
            continue;
        }
        if let Some(b) = selection.find(env, &used, a)? {
            used.add(a);
            used.add(b);
            doors.push(Door { a, b });
        }
    }
    for door in &doors {
        for (end, cell) in [("a", door.a), ("b", door.b)] {
            let value = strength.get(cell)?;
            field.channels.band_mut(C::Source).set(cell, value)?;
            let [x, y] = env.mesh.position(cell);
            field.located.push(LocatedSource {
                origin: field.definition.origins[context.origin].id.clone(),
                id: format!(
                    "door:{}:{}:{end}",
                    env.mesh.identity(door.a),
                    env.mesh.identity(door.b)
                ),
                x,
                y,
                radius: env.mesh.area(cell).sqrt(),
                strength: value,
            });
        }
    }
    field.doors = doors;
    Ok(())
}
fn candidates(
    env: &Environment<'_>,
    field: &mut MagicField,
    conditions: &Conditions,
    strength: &ReadBand<f64>,
    used: &BitSet,
    threshold: f64,
) -> io::Result<Vec<usize>> {
    let mut cells = Vec::new();
    let mut scores = Vec::new();
    for cell in 0..env.mesh.len() {
        if !used.has(cell) && conditions.eligible(env, field, strength, cell, threshold)? {
            cells.push(cell);
            scores.push(strength.get(cell)?);
        }
    }
    let order = radix_order(&[NumericKey::Float(&scores)], Direction::Descending)
        .map_err(io::Error::other)?;
    Ok(order.into_iter().map(|index| cells[index]).collect())
}
struct Partners<'a> {
    candidates: &'a [usize],
    strength: &'a ReadBand<f64>,
    span: f64,
    matching: f64,
    kernel: &'a dyn SpatialKernel,
}
impl Partners<'_> {
    fn find(&self, env: &Environment<'_>, used: &BitSet, a: usize) -> io::Result<Option<usize>> {
        let mut best = None;
        let mut gap = self.matching + 1.0;
        let here = self.strength.get(a)?;
        let [x, y] = env.mesh.position(a);
        let point = Geometry::Point {
            coordinates: Position::xy(x, y),
        };
        for &b in self.candidates {
            if a == b || used.has(b) {
                continue;
            }
            let difference = (here - self.strength.get(b)?).abs();
            if difference > self.matching || difference >= gap {
                continue;
            }
            let target = env.mesh.position(b);
            let target = Geometry::Point {
                coordinates: Position::xy(x + env.mesh.delta_x(target[0] - x), target[1]),
            };
            if self
                .kernel
                .distance(&point, &target)
                .map_err(io::Error::other)?
                < self.span
            {
                continue;
            }
            best = Some(b);
            gap = difference;
        }
        Ok(best)
    }
}
