use super::{
    canyon::length,
    catalogue::{Kind, Landmark, Measures},
    measurement::distance,
    placement::{track, Tracking},
    siting::{self, Site},
    terrain::Terrain,
};
pub use crate::identity::semantic_id;
use crate::{field::Field, hpc::TopK, lattice::Membership, noise::hash_unit, scale::MapScale};
use atlas_map::{Geometry, Position};
use std::io;
pub const LANDSCAPE_MIX: [Kind; 7] = [
    Kind::VolcanicMountain,
    Kind::Falls,
    Kind::Canyon,
    Kind::DomeRing,
    Kind::Escarpment,
    Kind::ResistantMountain,
    Kind::ImpactRing,
];
pub const MAGIC_MIX: [Kind; 5] = [
    Kind::FireWellspring,
    Kind::PressureLocus,
    Kind::GreenwoodHeart,
    Kind::AuroraVault,
    Kind::SaltPan,
];
pub struct Entry {
    pub ordinal: usize,
    pub kind: Kind,
    pub epoch: usize,
    pub sited: bool,
}
pub struct Taken {
    pub point: [f64; 2],
    pub reach: f64,
}
pub fn landmark_id(world: &str, area: &str, ordinal: usize) -> io::Result<String> {
    semantic_id(world, "landmark", &format!("{area}:{ordinal}"))
}
pub fn free_ordinals(
    world: &str,
    area: &str,
    held: &[Landmark],
    count: usize,
) -> io::Result<Vec<usize>> {
    let held = held
        .iter()
        .map(|l| l.id.as_str())
        // hpc-exempt: identity lookup among sparse named landmarks, never cell storage.
        .collect::<std::collections::HashSet<_>>();
    let mut free = Vec::new();
    let mut ordinal = 0;
    while free.len() < count {
        if !held.contains(landmark_id(world, area, ordinal)?.as_str()) {
            free.push(ordinal);
        }
        ordinal += 1;
    }
    Ok(free)
}
fn forming_epoch(kind: Kind, u: f64, epochs: usize) -> usize {
    let last = epochs.saturating_sub(1);
    let n = match kind {
        Kind::Falls | Kind::AuroraVault | Kind::GreenwoodHeart | Kind::SaltPan => {
            1 + (u * last.max(1) as f64).floor() as usize
        }
        Kind::Canyon => 1 + (u * last.saturating_sub(1).max(1) as f64).floor() as usize,
        _ if kind.system().is_some() => (u * epochs as f64).floor() as usize,
        _ => (u * last.max(1) as f64).floor() as usize,
    };
    n.min(last)
}
pub fn roster(seed: i32, ordinals: &[usize], epochs: usize, mix: &[Kind]) -> Vec<Entry> {
    if mix.is_empty() {
        return vec![];
    }
    let offset = (hash_unit(seed ^ 0x6c3d, 0.0, 0.0) * mix.len() as f64).floor() as usize;
    ordinals
        .iter()
        .enumerate()
        .map(|(n, &ordinal)| {
            let kind = mix[(offset + n) % mix.len()];
            Entry {
                ordinal,
                kind,
                epoch: forming_epoch(kind, hash_unit(seed ^ 0x51a7, ordinal as f64, 1.0), epochs),
                sited: false,
            }
        })
        .collect()
}
pub fn seeded(kind: Kind, seed: i32, ordinal: usize, scale: MapScale) -> io::Result<Measures> {
    let values = kind
        .generated(scale)?
        .into_iter()
        .enumerate()
        .map(|(n, p)| {
            (
                p.key.to_owned(),
                p.default * (0.75 + 0.5 * hash_unit(seed ^ 0x2e9b, ordinal as f64, n as f64)),
            )
        })
        .collect();
    kind.clamp(&values, scale)
}
fn candidates(t: &Terrain<'_>, entry: &Entry, seed: i32) -> io::Result<Vec<usize>> {
    if entry.kind == Kind::Falls {
        return Ok(t.rivers.clone());
    }
    let water = if entry.kind == Kind::PressureLocus {
        1
    } else {
        0
    };
    let mut selected = TopK::new(600);
    let mut all = Vec::new();
    for cell in 0..t.field.mesh.len() {
        if t.field.mesh.membership(cell) != Membership::Content
            || t.field.water().column.kind.get(cell)? != water
        {
            continue;
        }
        if entry.kind.system().is_some() {
            all.push(cell);
        } else {
            selected.consider(
                cell as u32,
                hash_unit(seed ^ 0x3b91, cell as f64, entry.ordinal as f64),
            );
        }
    }
    if entry.kind.system().is_some() {
        Ok(all)
    } else {
        Ok(selected.best().into_iter().map(|i| i as usize).collect())
    }
}
pub fn site(
    t: &Terrain<'_>,
    entry: &Entry,
    seed: i32,
    taken: &[Taken],
) -> io::Result<Option<(Site, Measures)>> {
    let p = seeded(entry.kind, seed, entry.ordinal, t.field.scale)?;
    let reach = entry.kind.reach(&p);
    let margin = length(t.field, 0.0125)?;
    let separation = length(t.field, 0.05)?;
    let mut best = None;
    let mut top = f64::NEG_INFINITY;
    for cell in candidates(t, entry, seed)? {
        if taken.iter().any(|other| {
            distance(t.field, cell, other.point) < (reach + other.reach + margin).max(separation)
        }) {
            continue;
        }
        let Some(score) = siting::assess(t, entry.kind, cell, &p)? else {
            continue;
        };
        let value = score + 0.05 * hash_unit(seed ^ 0x7c21, cell as f64, entry.ordinal as f64);
        if value > top {
            top = value;
            best = Some(cell);
        }
    }
    let Some(cell) = best else {
        return Ok(None);
    };
    let p = entry
        .kind
        .clamp(&siting::fit(t, entry.kind, cell, &p)?, t.field.scale)?;
    Ok(Some((siting::shape(t, entry.kind, cell, &p)?, p)))
}
pub struct Identity<'a> {
    pub world: &'a str,
    pub area: &'a str,
    pub space: &'a str,
}
pub fn generated(
    field: &Field,
    identity: &Identity<'_>,
    entry: &Entry,
    site: Site,
    parameters: Measures,
    tracking: &Tracking<'_>,
) -> io::Result<Landmark> {
    let mut path = site.path;
    track(field, &mut path, tracking, true)?;
    let origin = field.mesh.origin();
    let coordinates = path
        .into_iter()
        .map(|p| {
            Position::xy(
                (p[0] + origin[0] + 0.5).floor(),
                (p[1] + origin[1] + 0.5).floor(),
            )
        })
        .collect::<Vec<_>>();
    let geometry = if entry.kind.line() {
        Geometry::LineString { coordinates }
    } else {
        Geometry::Point {
            coordinates: coordinates[0],
        }
    };
    Ok(Landmark {
        id: landmark_id(identity.world, identity.area, entry.ordinal)?,
        name: String::new(),
        kind: entry.kind,
        geometry,
        parameters,
        emplaced_at_epoch: entry.epoch as i32,
        origin: Some("generated".into()),
        area_id: Some(identity.area.into()),
        space_id: Some(identity.space.into()),
    })
}
