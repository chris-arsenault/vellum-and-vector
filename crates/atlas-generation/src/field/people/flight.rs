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
/// How far survivors go looking for room, as a share of the map's span over open ground: a
/// few days' walk, beyond their own town to the country and towns beside it, as the old
/// society cycle moved them to a neighbouring community.
const FLIGHT: f64 = 0.05;

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
            let spare =
                (self.room.get(cell)? - field.people.people(cell)?).max(0.0) * km2(field, cell);
            if spare > best.map_or(0.0, |(_, most)| most) {
                best = Some((cell, spare));
            }
        }
        Ok(best)
    }
    /// Where a strike's survivors go and what share of each struck cell's people leaves: the
    /// share the strike's severity drives out, as far as the refuge has room.
    pub fn plan(
        &self,
        field: &Field,
        place: &Place,
        struck: &[usize],
        severity: f64,
    ) -> ExecutionResult<Option<Plan>> {
        let share = (FLEEING * severity).clamp(0.0, 1.0);
        if share <= 0.0 || struck.is_empty() {
            return Ok(None);
        }
        let Some((refuge, room)) = self.refuge(field, place, struck)? else {
            return Ok(None);
        };
        let mut movers = 0.0;
        for &cell in struck {
            movers += field.people.people(cell)? * km2(field, cell) * share;
        }
        let taken = admitted(room, movers);
        Ok(Some(Plan {
            refuge,
            leaving: share * taken,
            people: movers * taken,
        }))
    }
    /// Survivors leave the struck ground as `plan` says.
    pub fn flee(
        &self,
        context: &mut CommandContext<'_, Field>,
        place: &Place,
        struck: &[usize],
        severity: f64,
    ) -> ExecutionResult<Fled> {
        let field = context.state();
        let Some(plan) = self.plan(field, place, struck, severity)? else {
            return Ok(Fled {
                people: 0.0,
                refuge: None,
            });
        };
        let mut targets = field.coverage.borrow_mut().scratch(field.mesh.len(), -1i32);
        let mut leaving = working(field);
        for &cell in struck {
            targets.set(cell, plan.refuge as i32)?;
            leaving.set(cell, plan.leaving)?;
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
            people: plan.people,
            refuge: Some(plan.refuge),
        })
    }
}
/// A strike's flight: the refuge, the share of each struck cell's people who leave for it,
/// and how many people that is.
#[derive(Debug)]
pub struct Plan {
    pub refuge: usize,
    pub leaving: f64,
    pub people: f64,
}
#[cfg(test)]
mod tests {
    use super::{admitted, Flight, Going, FLEEING};
    use crate::{
        field::people::{fixture::*, work::km2},
        links::Offers,
    };

    #[test]
    fn a_refuge_takes_everyone_while_it_has_room_and_an_even_part_after() {
        assert_eq!(admitted(500.0, 200.0), 1.0);
        assert_eq!(admitted(100.0, 400.0), 0.25);
        assert_eq!(admitted(0.0, 400.0), 0.0);
        assert_eq!(admitted(100.0, 0.0), 0.0);
    }
    /// A town struck at the middle of the land, a dry neighbour with some room, a watery
    /// neighbour and a far cell with endless room.
    struct Strike {
        field: crate::field::Field,
        town: usize,
        dry: usize,
        wet: usize,
        far: usize,
    }
    fn strike(room_beside: f64) -> (Strike, crate::storage::ReadBand<f64>) {
        let mut town = 0;
        let field = land(|seed, mesh| {
            town = point(mesh, SIDE / 2.0, SIDE / 2.0);
            people(seed, town, &[layer(1000.0, 1, 0, 0, 0)]);
        });
        let around = neighbours(&field, town);
        let (dry, wet) = (around[0], around[1]);
        water(&field, wet);
        let far = at(&field, SIDE / 2.0 + 20.0 * field.mesh.spacing(), SIDE / 2.0);
        let room = band(&field, |cell| {
            if cell == dry {
                room_beside
            } else if cell == wet || cell == far {
                1.0e9
            } else {
                0.0
            }
        });
        (
            Strike {
                field,
                town,
                dry,
                wet,
                far,
            },
            room,
        )
    }
    fn plan(
        s: &Strike,
        room: &crate::storage::ReadBand<f64>,
        severity: f64,
    ) -> Option<super::Plan> {
        let going = Going::new(&s.field, &plain_travel(&s.field)).unwrap();
        let owner = crate::field::Field::human_operations();
        let links = Offers::default();
        let flight = Flight {
            going: &going,
            links: &links,
            room,
            owner: &owner,
        };
        let town = place("town", s.town, vec![s.town], 1000.0);
        flight.plan(&s.field, &town, &[s.town], severity).unwrap()
    }

    #[test]
    fn survivors_flee_to_the_dry_ground_beside_them_not_across_water_or_out_of_reach() {
        let (s, room) = strike(10_000.0);
        let fled = plan(&s, &room, 1.0).expect("the dry neighbour has room");
        assert_eq!(fled.refuge, s.dry);
        assert_ne!(fled.refuge, s.wet);
        assert_ne!(fled.refuge, s.far);
        // All the strike drives out fit: six tenths of the town at full severity.
        assert!((fled.leaving - FLEEING).abs() < 1e-12);
        let movers = 1000.0 * km2(&s.field, s.town) * FLEEING;
        assert!((fled.people - movers).abs() < 1e-6 * movers);
    }
    #[test]
    fn a_refuge_with_little_room_takes_only_what_fits() {
        let (s, _) = strike(0.0);
        let movers = 1000.0 * km2(&s.field, s.town) * FLEEING * 0.5;
        // Room for a quarter of the movers, in people per km² of the refuge.
        let room = band(&s.field, |cell| {
            if cell == s.dry {
                0.25 * movers / km2(&s.field, s.dry)
            } else {
                0.0
            }
        });
        let fled = plan(&s, &room, 0.5).unwrap();
        assert!((fled.leaving - FLEEING * 0.5 * 0.25).abs() < 1e-9);
        assert!((fled.people - 0.25 * movers).abs() < 1e-6 * movers);
    }
    #[test]
    fn no_one_flees_a_harmless_strike_or_to_ground_without_room() {
        let (s, room) = strike(10_000.0);
        assert!(plan(&s, &room, 0.0).is_none());
        let (s, room) = strike(0.0);
        assert!(plan(&s, &room, 1.0).is_none());
    }
}
