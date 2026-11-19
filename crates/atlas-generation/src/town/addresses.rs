//! Number premises on the side and station at which their access meets a named street.
use super::{
    edits::line,
    fabric::{Holding, HoldingId, Town},
    geometry::{at, distance, dot, left, sub, Point},
    settings::JUNCTION_TOLERANCE,
};
use crate::spatial::SpatialKernel;
pub use atlas_map::town::{address, numbers};
use atlas_map::{town::Side, Position};
use std::io;

#[derive(Clone, Copy, Debug)]
pub struct Address {
    pub street: usize,
    pub number: u32,
    pub junction: Point,
    pub indirect: bool,
}
struct Connection {
    id: HoldingId,
    street: usize,
    mouth: Point,
    arrival: Option<Point>,
    routed: bool,
    side: Side,
    indirect: bool,
}
fn connection(town: &Town, holding: &Holding) -> Option<Connection> {
    let mut host = holding;
    loop {
        if let Some(street) = host.slot.street.filter(|_| host.access_via.is_none()) {
            return Some(Connection {
                id: holding.id,
                street,
                mouth: host.slot.front,
                arrival: None,
                routed: false,
                side: host.slot.side,
                indirect: host.id != holding.id,
            });
        }
        if let Some(route) = town.approach(host.id) {
            let &mouth = route.points.last()?;
            return Some(Connection {
                id: holding.id,
                street: route.street,
                mouth,
                arrival: route
                    .points
                    .iter()
                    .rev()
                    .copied()
                    .find(|&p| distance(p, mouth) > JUNCTION_TOLERANCE),
                side: host.slot.side,
                routed: true,
                indirect: true,
            });
        }
        if let Some(id) = host.access_via.filter(|id| *id < host.id) {
            host = town.holdings().get(id.0 as usize)?;
            continue;
        }
        return None;
    }
}
// owner-direction(2026-11-18): we do want nearly everything to have a street address.
pub fn assign(town: &Town, spatial: &dyn SpatialKernel) -> io::Result<Vec<Option<Address>>> {
    let mut assigned = vec![None; town.holdings().len()];
    let mut by_street: Vec<Vec<Connection>> = (0..town.streets().len()).map(|_| vec![]).collect();
    for access in town.holdings().iter().filter_map(|h| connection(town, h)) {
        if let Some(group) = by_street.get_mut(access.street) {
            group.push(access);
        }
    }
    for (street, members) in town.streets().iter().zip(by_street) {
        if members.is_empty() {
            continue;
        }
        let positions = members
            .iter()
            .map(|c| Position::xy(c.mouth[0], c.mouth[1]))
            .collect::<Vec<_>>();
        let road = line(&street.points);
        let fractions = spatial
            .line_fractions(&road, &positions)
            .map_err(io::Error::other)?;
        let length = street.length();
        let joined: Vec<_> = members
            .into_iter()
            .zip(fractions)
            .filter_map(|(c, f)| {
                let (junction, direction) = at(&street.points, f * length)?;
                if c.routed && distance(junction, c.mouth) > JUNCTION_TOLERANCE {
                    return None;
                }
                let side = c.arrival.map_or(c.side, |p| {
                    if dot(left(direction), sub(p, junction)) < 0. {
                        Side::Right
                    } else {
                        Side::Left
                    }
                });
                Some((c, junction, (f, side)))
            })
            .collect();
        let plots = joined.iter().map(|(_, _, plot)| *plot).collect::<Vec<_>>();
        for ((c, junction, _), number) in joined.into_iter().zip(numbers(&plots)) {
            assigned[c.id.0 as usize] = Some(Address {
                street: c.street,
                number,
                junction,
                indirect: c.indirect,
            });
        }
    }
    Ok(assigned)
}
