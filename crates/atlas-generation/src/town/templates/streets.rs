use crate::town::{
    fabric::Town,
    geometry::{add, angle, heading, length, scale, sub},
    network::{Class, StreetProposal},
};

/// Surveyed frontages can commission the occupied stretch of their circular
/// way. An empty sector has no residents to improve it.
pub(super) fn occupied_arcs(town: &Town, unit: f64, spacing: f64) -> Vec<StreetProposal> {
    let centre = town.seat.centre;
    // hpc-exempt: accumulate contributions by occupied survey arc, before proposing its corridor.
    let mut work = std::collections::BTreeMap::<(u32, u32), f64>::new();
    let divisions = |ring: u32| {
        ((std::f64::consts::TAU * spacing * ring as f64 / (2. * unit)).ceil() as u32).max(4)
    };
    for h in town.holdings().iter().filter(|h| h.occupation > 0.) {
        let offset = sub(h.slot.front, centre);
        let ring = (length(offset) / spacing).round().max(1.) as u32;
        let fraction = angle(offset).rem_euclid(std::f64::consts::TAU) / std::f64::consts::TAU;
        let sector = (fraction * divisions(ring) as f64) as u32;
        *work.entry((ring, sector)).or_default() += h.occupation * (1. + h.means);
    }
    work.into_iter()
        .map(|((ring, sector), benefit)| {
            let step = std::f64::consts::TAU / divisions(ring) as f64;
            let points = (0..=4)
                .map(|j| {
                    add(
                        centre,
                        scale(
                            heading(step * (sector as f64 + j as f64 / 4.)),
                            spacing * ring as f64,
                        ),
                    )
                })
                .collect();
            StreetProposal {
                points,
                benefit,
                class: Class::Street,
                demand: "occupied charter arc",
            }
        })
        .collect()
}
