//! Locate a coarse census among reachable homes on fine ground.
use crate::{
    field::{
        people::{
            growth::Guidance,
            work::{habitable, km2, Work},
        },
        refinement::people::CensusCell,
        Field,
    },
    hpc::{Direction, KeyedHeap},
    human::operations::HouseholdTransfers,
    storage::{Band, ReadBand},
    town::geometry::distance,
};
use std::io;

pub(super) struct Site {
    pub position: [f64; 2],
    pub census: CensusCell,
    pub inherited: f64,
    pub residents: f64,
    pub room: f64,
    pub dry: bool,
    pub ways: smallvec::SmallVec<[(usize, f64); 4]>,
}

pub(super) fn sites(
    field: &Field,
    work: &Work,
    city: &Guidance,
    residents: &ReadBand<f64>,
    opportunity: &Band<f64>,
) -> io::Result<Vec<Site>> {
    let mesh = field.mesh();
    let [ox, oy] = mesh.origin();
    let mut sites = Vec::with_capacity(mesh.len());
    for c in 0..mesh.len() {
        let area = km2(field, c);
        let people = residents.get(c)?;
        let inherited = city.census[c].density;
        let mut ways = smallvec::SmallVec::new();
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(c, edge) {
                let passage = super::step_passed(work, c, edge)?;
                if passage > 0. {
                    ways.push((next, mesh.edge_length(c, edge) / passage));
                }
            }
        }
        let [x, y] = mesh.position(c);
        sites.push(Site {
            position: [ox + x, oy + y],
            census: city.census[c],
            inherited: inherited * area,
            residents: people * area,
            room: if city.weight[c] > 0. {
                // Opportunity already includes access to jobs along the road network.
                area * opportunity.get(c)?.max(0.).sqrt()
            } else {
                0.
            },
            dry: habitable(field, c)?,
            ways,
        });
    }
    for link in &work.going.linked {
        if link.passed > 0. {
            let cost = mesh.physical_distance(link.a, link.b) / link.passed;
            sites[link.a].ways.push((link.b, cost));
            sites[link.b].ways.push((link.a, cost));
        }
    }
    Ok(sites)
}

// owner-direction(2026-11-25): distribute census households across overlapping catchments according to usable ground and access to livelihoods.
pub(super) fn placement(
    sites: &[Site],
    settings: super::PlacementSettings,
) -> Vec<HouseholdTransfers> {
    let mut target = vec![0.; sites.len()];
    let mut seen = vec![false; sites.len()];
    let mut dist = vec![f64::INFINITY; sites.len()];
    let mut catchments = Vec::new();
    for (i, site) in sites.iter().enumerate() {
        if !seen[i] && site.dry {
            let source = connected_donor(sites, i, &mut seen);
            catchments.push(locate_census(
                sites,
                &source,
                &mut dist,
                &mut target,
                settings,
            ));
        }
    }
    let mut present: Vec<_> = sites.iter().map(|s| s.residents).collect();
    catchments
        .into_iter()
        .filter_map(|members| place_available(members, &target, &mut present))
        .collect()
}

/// Separate disconnected parts of one parent cell before offering its households places.
fn connected_donor(sites: &[Site], i: usize, seen: &mut [bool]) -> Vec<usize> {
    let site = &sites[i];
    let mut source = vec![i];
    seen[i] = true;
    let mut at = 0;
    while at < source.len() {
        for &(b, _) in &sites[source[at]].ways {
            if !seen[b] && sites[b].dry && sites[b].census.id == site.census.id {
                seen[b] = true;
                source.push(b);
            }
        }
        at += 1;
    }
    source
}

fn locate_census(
    sites: &[Site],
    source: &[usize],
    dist: &mut [f64],
    target: &mut [f64],
    settings: super::PlacementSettings,
) -> Vec<usize> {
    let site = &sites[source[0]];
    let census = source.iter().map(|&c| sites[c].inherited).sum::<f64>();
    let reach = settings.catchment_spans * site.census.span.max(1.);
    let members = accessible(sites, source, dist, reach);
    let weight = |c: usize| {
        sites[c].room
            * (1. - (dist[c] / reach).powi(2))
                .max(0.)
                .powf(settings.catchment_falloff)
    };
    let room = members.iter().map(|&c| weight(c)).sum::<f64>();
    if room > 0. {
        for &c in &members {
            target[c] += census * weight(c) / room;
        }
    } else {
        for &c in source {
            target[c] += sites[c].inherited;
        }
    }
    for &c in &members {
        dist[c] = f64::INFINITY;
    }
    members
}

fn accessible(sites: &[Site], source: &[usize], dist: &mut [f64], reach: f64) -> Vec<usize> {
    let centre = sites[source[0]].census.centre;
    let mut members = Vec::new();
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for &c in source {
        dist[c] = distance(sites[c].position, centre);
        members.push(c);
        queue.push(c as u32, [dist[c]]);
    }
    while let Some((c, [d])) = queue.pop() {
        let c = c as usize;
        if d != dist[c] {
            continue;
        }
        for &(b, cost) in &sites[c].ways {
            let offer = d + cost;
            if !(sites[b].dry && offer < reach && offer < dist[b]) {
                continue;
            }
            if !dist[b].is_finite() {
                members.push(b);
            }
            dist[b] = offer;
            queue.push(b as u32, [offer]);
        }
    }
    members
}

/// Only reassign surplus households. Repeated rounds can respond to a new road
/// while keeping the inherited census as the supply behind each catchment.
fn place_available(
    members: Vec<usize>,
    target: &[f64],
    present: &mut [f64],
) -> Option<HouseholdTransfers> {
    let mut sources = Vec::new();
    let mut receivers = Vec::new();
    for c in members {
        let difference = present[c] - target[c];
        if difference > 1e-9 {
            sources.push((c, difference));
        }
        if difference < -1e-9 {
            receivers.push((c, -difference));
        }
    }
    let supply = sources.iter().map(|(_, q)| q).sum::<f64>();
    let demand = receivers.iter().map(|(_, q)| q).sum::<f64>();
    let placed = supply.min(demand);
    if placed <= 0. {
        return None;
    }
    for (c, q) in &mut sources {
        let give = *q * placed / supply;
        *q = (give / present[*c]).min(1.);
        present[*c] -= give;
    }
    for (c, q) in &mut receivers {
        *q /= demand;
        present[*c] += placed * *q;
    }
    Some(HouseholdTransfers { sources, receivers })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_accessible_destination_draws_from_both_census_areas_but_not_across_open_water() {
        let sites = catchment_sites();
        let mut after: Vec<_> = sites.iter().map(|s| s.residents).collect();
        for p in placement(&sites, super::super::DEFAULT_PLACEMENT) {
            let mut pool = 0.;
            for (c, share) in p.sources {
                let offer = share * after[c];
                after[c] -= offer;
                pool += offer;
            }
            for (c, share) in p.receivers {
                after[c] += share * pool;
            }
        }
        assert!(after[2] > after[1] && after[2] > after[3]);
        assert!(after[0] < sites[0].residents);
        assert_eq!(after[4..], [0., 200.]);
    }

    fn catchment_sites() -> Vec<Site> {
        let mut sites = Vec::new();
        for (i, inherited) in [90., 90., 10., 10., 0., 200.].into_iter().enumerate() {
            let id = usize::from(i >= 2);
            let mut ways = smallvec::SmallVec::new();
            if i > 0 {
                ways.push((i - 1, 1.));
            }
            if i < 5 {
                ways.push((i + 1, 1.));
            }
            sites.push(Site {
                position: [i as f64, 0.],
                census: CensusCell {
                    id,
                    centre: [if id == 0 { 0.5 } else { 2.5 }, 0.],
                    span: 2.,
                    density: inherited,
                },
                inherited,
                residents: inherited,
                room: if i == 2 { 6. } else { 2. },
                dry: i != 4,
                ways,
            });
        }
        sites
    }
}
