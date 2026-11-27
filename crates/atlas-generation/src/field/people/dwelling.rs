//! How tightly households live: the people a built square kilometre holds where its
//! households take the ground they can afford.
//!
//! Ground is dear where many people live within a short walk, as a farmstead's plot is
//! many times a townsman's. A household's purse is what its quarter's trade gives it beside
//! the settlement's ordinary means. Where ground is dear for the purse, households take
//! less of it and built ground holds more people; where it is cheap for the purse they
//! spread. A district's character adds how its own households live. Settling reads the
//! result as the room built ground offers, and building as the ground people lack.
use super::{
    gather::PlacementSettings,
    work::{habitable, km2, working, Work},
};
use crate::{
    field::Field,
    storage::{Band, ReadBand},
    town::settings::DAILY_REACH,
};
use std::io;

/// The farthest neighbours whose number makes ground dear: half the daily walk, about ten
/// minutes on foot.
const WALK: f64 = DAILY_REACH / 2.;
/// The neighbours within that walk for whom the `room` question is answered: a large
/// village.
const NEIGHBOURS: f64 = 300.;

/// How good a location is to a household. Worth follows the order of magnitude of the
/// opportunity there, raised to the location draw, so the one busiest market does not
/// outweigh a whole quarter; each wall standing round the ground adds to it. Ground that
/// offers nothing is worth nothing.
pub(super) fn worth(opportunity: f64, enclosed: f64, settings: &PlacementSettings) -> f64 {
    if opportunity <= 0. {
        return 0.;
    }
    opportunity.ln_1p().powf(settings.location_draw)
        * (1. + settings.wall_premium * enclosed.max(0.))
}

/// The people a built square kilometre holds. `room` is what it holds for households of
/// ordinary means with a village's neighbours. `neighbours` are the people living within a
/// short walk, `purse` what the households here can pay beside ordinary means, and
/// `character` how the district's households live beside ordinary ones. `thrift` is how
/// strongly neighbours thin, and a full purse widens, the ground a household takes.
pub(super) fn held(room: f64, neighbours: f64, purse: f64, character: f64, thrift: f64) -> f64 {
    // A first household has itself for a neighbour.
    let dearness = (neighbours.max(1.) / NEIGHBOURS).powf(thrift);
    let means = if purse > 0. { purse.powf(thrift) } else { 1. };
    room * dearness / means * character
}

/// The people living within a short walk of a point where `density` people per square
/// kilometre live round it.
pub(super) fn neighbours(density: f64) -> f64 {
    density.max(0.) * std::f64::consts::PI * (WALK / 1000.).powi(2)
}

/// What settling and building read of the ground: each cell's worth to households, and the
/// people a built square kilometre holds there.
pub(super) struct Ground {
    pub worth: Band<f64>,
    pub held: Band<f64>,
}

/// What the ground is asked for each cell.
pub(super) struct Reads<'a> {
    /// People per square kilometre living on each cell.
    pub residents: &'a ReadBand<f64>,
    /// Access to livelihoods, food and jobs along the road network.
    pub opportunity: &'a Band<f64>,
    /// The people a built square kilometre houses for ordinary households in a village.
    pub room: &'a ReadBand<f64>,
    /// How many times the works its built ground alone would gather a cell gathers toward.
    pub wealth: &'a ReadBand<f64>,
}

/// The people per square kilometre living within a short walk of each cell: its own, and
/// its neighbours' where the cells are finer than the walk.
fn crowd(field: &Field, residents: &ReadBand<f64>) -> io::Result<Vec<f64>> {
    let mesh = &field.mesh;
    let mut living = Vec::with_capacity(mesh.len());
    for cell in 0..mesh.len() {
        living.push(residents.get(cell)?.max(0.) * km2(field, cell));
    }
    let mut crowd = Vec::with_capacity(mesh.len());
    for cell in 0..mesh.len() {
        let (mut people, mut land) = (living[cell], km2(field, cell));
        for neighbour in mesh.cells_within(mesh.position(cell), WALK) {
            if neighbour == cell {
                continue;
            }
            let near = (1. - (mesh.physical_distance(cell, neighbour) / WALK).powi(2)).max(0.);
            people += near * living[neighbour];
            land += near * km2(field, neighbour);
        }
        crowd.push(if land > 0. { people / land } else { 0. });
    }
    Ok(crowd)
}

pub(super) fn ground(
    field: &Field,
    work: &Work,
    reads: &Reads<'_>,
    settings: &PlacementSettings,
) -> io::Result<Ground> {
    let mut ground = Ground {
        worth: working(field),
        held: working(field),
    };
    let crowd = crowd(field, reads.residents)?;
    // Ordinary means: what the settlement's people can pay, one with another.
    let (mut people, mut means) = (0., 0.);
    for cell in 0..field.mesh.len() {
        let living = reads.residents.get(cell)?.max(0.) * km2(field, cell);
        people += living;
        means += living * reads.wealth.get(cell)?.max(0.);
    }
    let ordinary = if people > 0. && means > 0. {
        means / people
    } else {
        1.
    };
    for (cell, &density) in crowd.iter().enumerate() {
        if !habitable(field, cell)? {
            continue;
        }
        ground.worth.set(
            cell,
            worth(reads.opportunity.get(cell)?, work.enclosed(cell), settings),
        )?;
        ground.held.set(
            cell,
            held(
                reads.room.get(cell)?,
                neighbours(density),
                reads.wealth.get(cell)? / ordinary,
                work.dwelling(cell),
                settings.ground_thrift,
            ),
        )?;
    }
    Ok(ground)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn many_neighbours_put_more_people_on_built_ground_and_a_full_purse_fewer() {
        let village = held(8_000., NEIGHBOURS, 1., 1., 0.5);
        assert_eq!(village, 8_000.);
        // Four times the neighbours hold twice the people; a purse four times fuller, half.
        assert_eq!(held(8_000., 4. * NEIGHBOURS, 1., 1., 0.5), 16_000.);
        assert_eq!(held(8_000., NEIGHBOURS, 4., 1., 0.5), 4_000.);
        // A full purse among many neighbours lives as a villager does.
        assert_eq!(held(8_000., 4. * NEIGHBOURS, 4., 1., 0.5), village);
        // A lone farmstead spreads; character acts on top; without thrift nothing changes.
        assert!(held(8_000., 5., 1., 1., 0.5) < 0.2 * village);
        assert_eq!(held(8_000., NEIGHBOURS, 1., 2.5, 0.5), 20_000.);
        assert_eq!(held(8_000., 4. * NEIGHBOURS, 4., 1., 0.), village);
        assert!(held(8_000., 0., 1., 1., 0.5) > 0.);
    }

    #[test]
    fn a_walk_reaches_about_two_square_kilometres() {
        assert!((neighbours(1_000.) - 2_010.6).abs() < 1.);
        assert_eq!(neighbours(-5.), 0.);
    }
}
