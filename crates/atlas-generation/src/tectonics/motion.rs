//! Driven rigid plates, ductile province motion, subduction pull and buoyant resistance.
use super::{
    controls,
    state::{Plate, Site, State},
};
use crate::{lattice::TriangularLattice, scale::MapScale};

pub fn site_motion(mesh: &TriangularLattice, position: [f64; 2], plate: &Plate) -> [f64; 2] {
    let dx = mesh.delta_x(position[0] - plate.position[0]);
    let dy = position[1] - plate.position[1];
    [
        plate.motion[0] - plate.spin * dy,
        plate.motion[1] + plate.spin * dx,
    ]
}
pub fn move_point(
    mesh: &TriangularLattice,
    site: &Site,
    plate: &Plate,
    position: [f64; 2],
    distance: f64,
) -> [f64; 2] {
    let [x, y] = position;
    let dx = mesh.delta_x(x - plate.position[0]);
    let dy = y - plate.position[1];
    let (sin, cos) = (plate.spin * distance).sin_cos();
    let [vx, vy] = site_motion(mesh, position, plate);
    [
        x + plate.motion[0] * distance + dx * (cos - 1.0) - dy * sin
            + site.compliance * (site.drive[0] - vx) * distance,
        y + plate.motion[1] * distance
            + dx * sin
            + dy * (cos - 1.0)
            + site.compliance * (site.drive[1] - vy) * distance,
    ]
}
pub fn refresh_site_motion(mesh: &TriangularLattice, state: &mut State) {
    for site in &mut state.sites {
        let plate = state
            .plates
            .iter()
            .find(|p| p.id == site.plate)
            .expect("Site plate exists");
        let [x, y] = site_motion(mesh, site.province.position, plate);
        site.province.motion = [
            x + site.compliance * (site.drive[0] - x),
            y + site.compliance * (site.drive[1] - y),
        ];
    }
}
fn driving(mesh: &TriangularLattice, members: &[&Site], plate: &Plate) -> [f64; 3] {
    let mass: f64 = members.iter().map(|s| s.mass).sum();
    let mut x = 0.0;
    let mut y = 0.0;
    for site in members {
        x += site.drive[0] * site.mass / mass;
        y += site.drive[1] * site.mass / mass;
    }
    let mut torque = 0.0;
    let mut radius = 0.0;
    for site in members {
        let dx = mesh.delta_x(site.province.position[0] - plate.position[0]);
        let dy = site.province.position[1] - plate.position[1];
        torque += (dx * (site.drive[1] - y) - dy * (site.drive[0] - x)) * site.mass;
        radius += (dx * dx + dy * dy) * site.mass;
    }
    let area: f64 = members.iter().map(|s| s.area).sum();
    let inertia = radius.max(mass * area / (2.0 * std::f64::consts::PI));
    [x, y, torque / inertia.max(1.0) * controls::ROTATION_GAIN]
}
fn contact_resistance(mesh: &TriangularLattice, state: &mut State, myr: f64) {
    let masses: Vec<f64> = state
        .plates
        .iter()
        .map(|p| {
            state
                .sites
                .iter()
                .filter(|s| s.plate == p.id)
                .map(|s| s.mass)
                .sum()
        })
        .collect();
    let weight = 1.0 - (-myr / controls::CONTACT_MYR).exp();
    for bond in &state.bonds {
        let (a, b) = (&state.sites[bond.a], &state.sites[bond.b]);
        if !bond.active || a.plate == b.plate {
            continue;
        }
        let dx = mesh.delta_x(b.province.position[0] - a.province.position[0]);
        let dy = b.province.position[1] - a.province.position[1];
        let length = dx.hypot(dy).max(1.0);
        let first = state
            .plates
            .iter()
            .position(|p| p.id == a.plate)
            .expect("Site plate exists");
        let second = state
            .plates
            .iter()
            .position(|p| p.id == b.plate)
            .expect("Site plate exists");
        let [ax, ay] = site_motion(mesh, a.province.position, &state.plates[first]);
        let [bx, by] = site_motion(mesh, b.province.position, &state.plates[second]);
        let relative = ((bx - ax) * dx + (by - ay) * dy) / length;
        if relative >= 0.0 {
            continue;
        }
        let buoyant = a.province.assembly > 0 && b.province.assembly > 0;
        let impulse = -relative
            * weight
            * if buoyant {
                1.0
            } else {
                controls::SUBDUCTION_RESISTANCE
            };
        let first_share = masses[second] / (masses[first] + masses[second]);
        let second_share = 1.0 - first_share;
        state.plates[first].motion[0] -= impulse * first_share * dx / length;
        state.plates[first].motion[1] -= impulse * first_share * dy / length;
        state.plates[second].motion[0] += impulse * second_share * dx / length;
        state.plates[second].motion[1] += impulse * second_share * dy / length;
    }
}
pub fn edge_allowance(gap: f64, reach: f64) -> f64 {
    (gap / reach).clamp(0.0, 1.0)
}
fn edge_resistance(mesh: &TriangularLattice, members: &[&Site], plate: &mut Plate, reach: f64) {
    let continent: Vec<_> = members.iter().filter(|s| s.province.assembly > 0).collect();
    if continent.is_empty() {
        return;
    }
    // Lattice bounds are already in the local frame; source mesh.bounds subtracts its origin here.
    let bounds = mesh.bounds();
    let min = |axis| {
        continent
            .iter()
            .map(|s| s.province.position[axis])
            .fold(f64::INFINITY, f64::min)
    };
    let max = |axis| {
        continent
            .iter()
            .map(|s| s.province.position[axis])
            .fold(f64::NEG_INFINITY, f64::max)
    };
    if mesh.periodic_width().is_none() {
        plate.motion[0] *= edge_allowance(
            if plate.motion[0] > 0.0 {
                bounds.2 - max(0)
            } else {
                min(0) - bounds.0
            },
            reach,
        );
    }
    plate.motion[1] *= edge_allowance(
        if plate.motion[1] > 0.0 {
            bounds.3 - max(1)
        } else {
            min(1) - bounds.1
        },
        reach,
    );
}
#[derive(Clone, Copy, Default)]
struct Pull {
    x: f64,
    y: f64,
    contacts: usize,
}
fn add_contact(pull: &mut Pull, sinking: bool, dx: f64, dy: f64, length: f64) {
    pull.contacts += 1;
    if sinking {
        pull.x += dx / length;
        pull.y += dy / length;
    }
}
fn slab_pull(mesh: &TriangularLattice, state: &mut State) -> Vec<Pull> {
    let mut pulls = vec![Pull::default(); state.plates.len()];
    let mut own = vec![Pull::default(); state.sites.len()];
    for bond in &state.bonds {
        let (a, b) = (&state.sites[bond.a], &state.sites[bond.b]);
        if !bond.active || a.plate == b.plate {
            continue;
        }
        let dx = mesh.delta_x(b.province.position[0] - a.province.position[0]);
        let dy = b.province.position[1] - a.province.position[1];
        let length = dx.hypot(dy).max(1.0);
        let closing = (a.province.motion[0] - b.province.motion[0]) * dx
            + (a.province.motion[1] - b.province.motion[1]) * dy
            > 0.0;
        let first = state
            .plates
            .iter()
            .position(|p| p.id == a.plate)
            .expect("Site plate exists");
        let second = state
            .plates
            .iter()
            .position(|p| p.id == b.plate)
            .expect("Site plate exists");
        for pull in [&mut pulls[first], &mut own[bond.a]] {
            add_contact(pull, closing && a.province.assembly == 0, dx, dy, length);
        }
        for pull in [&mut pulls[second], &mut own[bond.b]] {
            add_contact(pull, closing && b.province.assembly == 0, -dx, -dy, length);
        }
    }
    for (site, pull) in state.sites.iter_mut().zip(own) {
        site.pull = [
            pull.x / pull.contacts.max(1) as f64,
            pull.y / pull.contacts.max(1) as f64,
        ];
    }
    pulls
}
fn drag(members: &[&Site]) -> f64 {
    let mass: f64 = members.iter().map(|s| s.mass).sum();
    let area: f64 = members.iter().map(|s| s.area).sum();
    if area > 0.0 {
        mass / area
    } else {
        1.0
    }
}
pub fn update_plate_motion(
    mesh: &TriangularLattice,
    scale: MapScale,
    state: &mut State,
    myr: f64,
) -> Result<(), &'static str> {
    let weight = 1.0 - (-myr / controls::RELAXATION_MYR).exp();
    let pulls = slab_pull(mesh, state);
    for (plate, pull) in state.plates.iter_mut().zip(pulls) {
        let members: Vec<_> = state.sites.iter().filter(|s| s.plate == plate.id).collect();
        let [x, y, spin] = driving(mesh, &members, plate);
        let strength = controls::SLAB_PULL / (pull.contacts.max(1) as f64 * drag(&members));
        plate.motion[0] += (x + pull.x * strength - plate.motion[0]) * weight;
        plate.motion[1] += (y + pull.y * strength - plate.motion[1]) * weight;
        plate.spin += (spin - plate.spin) * weight;
    }
    contact_resistance(mesh, state, myr);
    let reach = controls::edge_reach(scale)?;
    for plate in &mut state.plates {
        let members: Vec<_> = state.sites.iter().filter(|s| s.plate == plate.id).collect();
        edge_resistance(mesh, &members, plate, reach);
    }
    refresh_site_motion(mesh, state);
    Ok(())
}
