//! Persistent bond loading, rupture, welded seams, sinking provinces and thermal driving.
use super::{
    controls,
    motion::{refresh_site_motion, site_motion},
    state::{plate_of, Bond, Site, State, Transition, TransitionKind},
};
use crate::{hpc::BitSet, lattice::TriangularLattice, scale::MapScale};

#[derive(Clone, Copy)]
pub struct Plume {
    pub position: [f64; 2],
    pub radius: f64,
    pub strength: f64,
}
fn load_bond(mesh: &TriangularLattice, sites: &mut [Site], bond: &mut Bond, distance: f64) {
    let (a, b) = (&sites[bond.a], &sites[bond.b]);
    let dx = mesh.delta_x(b.province.position[0] - a.province.position[0]);
    let dy = b.province.position[1] - a.province.position[1];
    let length = dx.hypot(dy).max(mesh.spacing());
    let shared = a.plate == b.plate;
    if !shared && !bond.active {
        return;
    }
    let velocity = if shared {
        [
            b.drive[0] - a.drive[0] + b.pull[0] - a.pull[0],
            b.drive[1] - a.drive[1] + b.pull[1] - a.pull[1],
        ]
    } else {
        [
            b.province.motion[0] - a.province.motion[0],
            b.province.motion[1] - a.province.motion[1],
        ]
    };
    let relative = (velocity[0] * dx + velocity[1] * dy) / length;
    bond.extension += relative.max(0.0) * distance / (length * bond.strength);
    bond.shortening += (-relative).max(0.0) * distance / length;
    if shared && relative < 0.0 && bond.shortening > bond.extension + controls::WELD_STRAIN {
        bond.broken = false;
    }
    let damage = (bond.extension - bond.shortening).max(0.0);
    if shared && damage >= controls::RIFT_FAILURE {
        bond.broken = true;
    }
    if !shared {
        return;
    }
    let compliance =
        (damage / controls::RIFT_FAILURE).clamp(0.0, 1.0) * controls::DUCTILE_COMPLIANCE;
    sites[bond.a].compliance = sites[bond.a].compliance.max(compliance);
    sites[bond.b].compliance = sites[bond.b].compliance.max(compliance);
}
pub fn components(sites: &[Site], bonds: &[Bond], id: usize) -> Vec<Vec<usize>> {
    let mut remaining = BitSet::new(sites.len());
    for (i, site) in sites.iter().enumerate() {
        if site.plate == id {
            remaining.add(i);
        }
    }
    let edges: Vec<_> = bonds
        .iter()
        .filter(|b| !b.broken && remaining.has(b.a) && remaining.has(b.b))
        .collect();
    let mut result = Vec::new();
    for first in 0..sites.len() {
        if !remaining.has(first) {
            continue;
        }
        remaining.clear(first);
        let mut group = vec![first];
        let mut head = 0;
        while head < group.len() {
            for bond in &edges {
                let next = if bond.a == group[head] {
                    Some(bond.b)
                } else if bond.b == group[head] {
                    Some(bond.a)
                } else {
                    None
                };
                if let Some(next) = next.filter(|&next| remaining.has(next)) {
                    remaining.clear(next);
                    group.push(next);
                }
            }
            head += 1;
        }
        result.push(group);
    }
    // hpc-exempt: coarse mechanical province groups, largest fragment retains its plate identity.
    result.sort_by(|a, b| b.len().cmp(&a.len()).then(a[0].cmp(&b[0])));
    result
}
fn split_plates(mesh: &TriangularLattice, state: &mut State, myr: f64) {
    let parents = state.plates.clone();
    for parent in parents {
        let groups = components(&state.sites, &state.bonds, parent.id);
        if groups.len() <= 1 {
            continue;
        }
        let mut children = vec![parent.id];
        for &i in groups.iter().flatten() {
            let site = &mut state.sites[i];
            site.drive[0] += site.pull[0];
            site.drive[1] += site.pull[1];
        }
        for group in &groups[1..] {
            let id = state.next_plate_id;
            state.next_plate_id += 1;
            for &i in group {
                state.sites[i].plate = id;
            }
            let mut daughter = plate_of(mesh, &state.sites, id);
            daughter.motion = site_motion(mesh, daughter.position, &parent);
            daughter.spin = parent.spin;
            state.plates.push(daughter);
            children.push(id);
        }
        let center = plate_of(mesh, &state.sites, parent.id).position;
        let current = state.plates.iter_mut().find(|p| p.id == parent.id).unwrap();
        current.motion = site_motion(mesh, center, &parent);
        current.position = center;
        state.splits += groups.len() - 1;
        state.transitions.push(Transition {
            kind: TransitionKind::Split,
            at_myr: state.elapsed_myr + myr,
            plates: children,
            sites: groups.into_iter().flatten().collect(),
        });
    }
}
pub fn can_weld(bond: &Bond, relative: f64) -> bool {
    if bond.shortening - bond.extension >= controls::COLLISION_LOCK {
        return relative <= 0.0;
    }
    if bond.shortening < bond.extension + controls::WELD_STRAIN {
        return false;
    }
    (-controls::WELD_SPEED..=0.0).contains(&relative)
}
fn join_blocks(state: &mut State, keep: usize, removed: usize) -> Vec<usize> {
    let members: Vec<_> = state
        .sites
        .iter()
        .enumerate()
        .filter(|(_, s)| s.plate == keep || s.plate == removed)
        .map(|(i, _)| i)
        .collect();
    for bond in &mut state.bonds {
        if state.sites[bond.a].plate == state.sites[bond.b].plate
            || !members.contains(&bond.a)
            || !members.contains(&bond.b)
        {
            continue;
        }
        bond.broken = false;
        bond.suture = true;
        bond.strength *= controls::SUTURE_STRENGTH;
        bond.extension = 0.0;
        bond.shortening = 0.0;
    }
    members
}
fn weld(mesh: &TriangularLattice, state: &mut State, index: usize, myr: f64) {
    let bond = &state.bonds[index];
    let (a, b) = (&state.sites[bond.a], &state.sites[bond.b]);
    if !bond.active || a.plate == b.plate || a.province.assembly == 0 || b.province.assembly == 0 {
        return;
    }
    let dx = mesh.delta_x(b.province.position[0] - a.province.position[0]);
    let dy = b.province.position[1] - a.province.position[1];
    let relative = ((b.province.motion[0] - a.province.motion[0]) * dx
        + (b.province.motion[1] - a.province.motion[1]) * dy)
        / dx.hypot(dy).max(1.0);
    if !can_weld(bond, relative) {
        return;
    }
    let keep = a.plate.min(b.plate);
    let removed = a.plate.max(b.plate);
    let members = join_blocks(state, keep, removed);
    for &i in &members {
        state.sites[i].plate = keep;
    }
    state.plates.retain(|p| p.id != keep && p.id != removed);
    let merged = plate_of(mesh, &state.sites, keep);
    for &i in &members {
        state.sites[i].drive = merged.motion;
    }
    state.plates.push(merged);
    state.welds += 1;
    state.transitions.push(Transition {
        kind: TransitionKind::Weld,
        at_myr: state.elapsed_myr + myr,
        plates: vec![keep, removed],
        sites: members.iter().map(|&i| state.sites[i].id - 1).collect(),
    });
}
fn sinking_site(state: &State, a: usize, b: usize) -> Option<usize> {
    let first = &state.sites[a];
    let second = &state.sites[b];
    if first.province.assembly > 0 && second.province.assembly > 0 {
        return None;
    }
    if first.province.assembly > 0 {
        return Some(b);
    }
    if second.province.assembly > 0 {
        return Some(a);
    }
    let count = |plate| state.sites.iter().filter(|s| s.plate == plate).count();
    Some(if count(first.plate) >= count(second.plate) {
        a
    } else {
        b
    })
}
fn sink_provinces(mesh: &TriangularLattice, state: &mut State) {
    for bond in &state.bonds {
        let (a, b) = (&state.sites[bond.a], &state.sites[bond.b]);
        if !bond.active || a.plate == b.plate {
            continue;
        }
        let dx = mesh.delta_x(b.province.position[0] - a.province.position[0]);
        let dy = b.province.position[1] - a.province.position[1];
        if (b.province.motion[0] - a.province.motion[0]) * dx
            + (b.province.motion[1] - a.province.motion[1]) * dy
            >= 0.0
        {
            continue;
        }
        let Some(index) = sinking_site(state, bond.a, bond.b) else {
            continue;
        };
        let sinking = &state.sites[index];
        if dx.hypot(dy) > sinking.area.sqrt() * controls::SINKING_REACH
            || state
                .sites
                .iter()
                .filter(|s| s.plate == sinking.plate)
                .count()
                < 2
        {
            continue;
        }
        let plate = plate_of(mesh, &state.sites, sinking.plate);
        let position = mesh.point(
            plate.position[0] - mesh.delta_x(sinking.province.position[0] - plate.position[0]),
            plate.position[1] - (sinking.province.position[1] - plate.position[1]),
        );
        state.sites[index].province.position = position;
        state.sunk += 1;
    }
}
fn push_away(mesh: &TriangularLattice, site: &mut Site, [x, y]: [f64; 2], gained: f64) {
    let dx = mesh.delta_x(site.province.position[0] - x);
    let dy = site.province.position[1] - y;
    let away = dx.hypot(dy).max(1.0);
    site.drive[0] += dx / away * gained;
    site.drive[1] += dy / away * gained;
}
fn warm_under_continents(mesh: &TriangularLattice, state: &mut State, myr: f64, lid_radius: f64) {
    for plate in &state.plates {
        let members: Vec<_> = state
            .sites
            .iter()
            .enumerate()
            .filter(|(_, s)| s.plate == plate.id && s.province.assembly > 0)
            .map(|(i, _)| i)
            .collect();
        if members.len() < 2 {
            continue;
        }
        let area: f64 = members.iter().map(|&i| state.sites[i].area).sum();
        let x = members
            .iter()
            .map(|&i| state.sites[i].province.position[0])
            .sum::<f64>()
            / members.len() as f64;
        let y = members
            .iter()
            .map(|&i| state.sites[i].province.position[1])
            .sum::<f64>()
            / members.len() as f64;
        let gained =
            (area / std::f64::consts::PI).sqrt() / lid_radius * myr / controls::INSULATION_MYR;
        for i in members {
            push_away(mesh, &mut state.sites[i], [x, y], gained);
        }
    }
}
fn spread_over_plumes(mesh: &TriangularLattice, state: &mut State, myr: f64, plumes: &[Plume]) {
    for plume in plumes {
        let reach = plume.radius * controls::PLUME_HEAD_REACH;
        let gained = plume.strength / 1000.0 * myr / controls::INSULATION_MYR;
        for site in &mut state.sites {
            if mesh
                .delta_x(site.province.position[0] - plume.position[0])
                .hypot(site.province.position[1] - plume.position[1])
                <= reach
            {
                push_away(mesh, site, plume.position, gained);
            }
        }
    }
}
pub fn deform_bonds(
    mesh: &TriangularLattice,
    scale: MapScale,
    state: &mut State,
    myr: f64,
    plumes: &[Plume],
) -> Result<(), &'static str> {
    warm_under_continents(mesh, state, myr, controls::lid_radius(scale)?);
    spread_over_plumes(mesh, state, myr, plumes);
    for site in &mut state.sites {
        site.compliance = 0.0;
    }
    for bond in &mut state.bonds {
        load_bond(mesh, &mut state.sites, bond, state.rate * myr);
    }
    split_plates(mesh, state, myr);
    refresh_site_motion(mesh, state);
    for i in 0..state.bonds.len() {
        weld(mesh, state, i, myr);
    }
    sink_provinces(mesh, state);
    refresh_site_motion(mesh, state);
    Ok(())
}
