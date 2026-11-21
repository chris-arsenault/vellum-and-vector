//! Survivors of a strike or a siege flee along the going to ground with room for them, as the
//! old society cycle moved six tenths of a disaster's severity in survivors to where there was
//! room. The owner's move operation carries them.
use super::{
    country,
    places::Place,
    travel::{self, Travel},
    work::{habitable, km2, working},
};
use crate::{
    execution::{CommandContext, ExecutionResult},
    field::Field,
    human::{
        catalogue::LayerId,
        operations::{self, Move},
    },
    links::Offers,
    storage::{Band, ReadBand},
};
use std::io;

/// The share of a struck place's survivors who flee, at full severity.
const FLEEING: f64 = 0.6;
/// How far survivors go looking for room, as a share of the map's span over open ground.
const FLIGHT: f64 = 0.02;

/// Where a strike's survivors went: how many, and the cell they fled to.
pub struct Fled {
    pub people: f64,
    pub refuge: Option<usize>,
}
/// The cost of each step between neighbouring cells, read once from the going before the
/// era's strikes change the people it depends on.
pub struct Going {
    cost: Band<f64>,
}
impl Going {
    pub fn new(field: &Field, travel: &Travel<'_>) -> io::Result<Self> {
        let mut cost = field
            .coverage
            .borrow_mut()
            .scratch(field.mesh.len() * 3, f64::INFINITY);
        for cell in 0..field.mesh.len() {
            for edge in 0..3 {
                if let Some(next) = field.mesh.neighbor(cell, edge) {
                    cost.set(cell * 3 + edge, travel.step(cell, next)?)?;
                }
            }
        }
        Ok(Self { cost })
    }
    fn step(&self, field: &Field, from: usize, to: usize) -> io::Result<f64> {
        for edge in 0..3 {
            if field.mesh.neighbor(from, edge) == Some(to) {
                return self.cost.get(from * 3 + edge);
            }
        }
        Ok(f64::INFINITY)
    }
}
/// What survivors flee through: the going, its links, and each cell's room for people per km².
pub struct Flight<'a> {
    pub going: &'a Going,
    pub links: &'a Offers<Field>,
    pub room: &'a ReadBand<f64>,
    pub owner: &'a operations::Operations<Field>,
}
/// The share of those who would flee that the refuge can take: all of them while it has room,
/// otherwise the same part of every struck cell's movers.
pub fn admitted(room: f64, movers: f64) -> f64 {
    if movers <= 0.0 {
        return 0.0;
    }
    (room.max(0.0) / movers).min(1.0)
}
impl Flight<'_> {
    /// The cell within the survivors' reach along the going, off the struck ground, with the
    /// most spare room, and that room in people.
    fn refuge(
        &self,
        field: &Field,
        place: &Place,
        struck: &[usize],
    ) -> ExecutionResult<Option<(usize, f64)>> {
        let reach = travel::length(field, FLIGHT)?;
        let going = country::spread(
            field,
            &[place.anchor],
            &|a, b| self.going.step(field, a, b),
            reach,
            None,
            self.links,
        )?;
        let mut hit = crate::hpc::BitSet::new(field.mesh.len());
        for &cell in struck {
            hit.add(cell);
        }
        let mut best = None;
        for cell in 0..field.mesh.len() {
            if !going.cost.get(cell)?.is_finite() || hit.has(cell) || !habitable(field, cell)? {
                continue;
            }
            let spare = (self.room.get(cell)? - field.people.people(cell)?).max(0.0) * km2(field, cell);
            if spare > best.map_or(0.0, |(_, most)| most) {
                best = Some((cell, spare));
            }
        }
        Ok(best)
    }
    /// Survivors leave the struck ground by the share the strike's severity drives out, as far
    /// as the refuge has room.
    pub fn flee(
        &self,
        context: &mut CommandContext<'_, Field>,
        place: &Place,
        struck: &[usize],
        severity: f64,
    ) -> ExecutionResult<Fled> {
        let share = (FLEEING * severity).clamp(0.0, 1.0);
        let none = Fled { people: 0.0, refuge: None };
        if share <= 0.0 || struck.is_empty() {
            return Ok(none);
        }
        let field = context.state();
        let Some((refuge, room)) = self.refuge(field, place, struck)? else {
            return Ok(none);
        };
        let mut movers = 0.0;
        for &cell in struck {
            movers += field.people.people(cell)? * km2(field, cell) * share;
        }
        let taken = admitted(room, movers);
        let mut targets = field.coverage.borrow_mut().scratch(field.mesh.len(), -1i32);
        let mut leaving = working(field);
        for &cell in struck {
            targets.set(cell, refuge as i32)?;
            leaving.set(cell, share * taken)?;
        }
        context.run(
            &self.owner.move_layer,
            &Move {
                kind: LayerId::Population,
                targets: targets.read_only(),
                share: leaving.read_only(),
                years: 1.0,
            },
        )?;
        Ok(Fled {
            people: movers * taken,
            refuge: Some(refuge),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::admitted;

    #[test]
    fn a_refuge_takes_everyone_while_it_has_room_and_an_even_part_after() {
        assert_eq!(admitted(500.0, 200.0), 1.0);
        assert_eq!(admitted(100.0, 400.0), 0.25);
        assert_eq!(admitted(0.0, 400.0), 0.0);
        assert_eq!(admitted(100.0, 0.0), 0.0);
    }
}
