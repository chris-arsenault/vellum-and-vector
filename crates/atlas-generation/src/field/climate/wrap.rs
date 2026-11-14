use super::{Field, Settings};
use crate::{lattice::Membership, storage::Band};
use std::io;
pub(super) fn edges(field: &Field, p: &Settings) -> Option<[f64; 2]> {
    if p.wrap_longitude == 0 {
        return None;
    }
    let [west, east] = p.world_extent_x?;
    let tolerance = (east - west) * 0.01;
    let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
    for cell in 0..field.mesh.len() {
        if field.mesh.membership(cell) != Membership::Content {
            continue;
        }
        let x = field.mesh.position(cell)[0] + field.mesh.origin()[0];
        low = low.min(x);
        high = high.max(x);
    }
    (low <= west + tolerance && high >= east - tolerance).then_some([west, east])
}
pub(super) fn links(
    field: &Field,
    p: &Settings,
    links: &mut Band<i32>,
    admissible: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<()> {
    let Some([west, east]) = edges(field, p) else {
        return Ok(());
    };
    for cell in 0..field.mesh.len() {
        let link = links.get(cell)?;
        let x = field.mesh.position(cell)[0] + field.mesh.origin()[0];
        if link < 0 || x < west || x > east {
            continue;
        }
        let [x, y] = field.mesh.position(link as usize);
        let world_x = x + field.mesh.origin()[0];
        let target = if world_x >= west && world_x <= east {
            Some(link as usize)
        } else {
            let wrapped = if world_x < west {
                world_x + east - west
            } else {
                world_x - east + west
            };
            field.mesh.cell_at(wrapped - field.mesh.origin()[0], y)
        };
        if let Some(target) = target {
            if target != cell && admissible(target)? {
                links.set(cell, target as i32)?;
            }
        }
    }
    Ok(())
}
pub(super) fn distance(field: &Field, edges: Option<[f64; 2]>, from: usize, to: usize) -> f64 {
    let Some([west, east]) = edges else {
        return field.mesh.physical_distance(from, to);
    };
    let a = field.mesh.position(from);
    let b = field.mesh.position(to);
    let mut dx = b[0] - a[0];
    let width = east - west;
    if dx.abs() > width / 2.0 {
        dx -= dx.signum() * width;
    }
    dx.hypot(b[1] - a[1])
}
