use super::{
    catalogue::Landmark,
    placement::{place, Tracking},
    roster::{self, Entry, Identity, Taken, LANDSCAPE_MIX, MAGIC_MIX},
    terrain::Terrain,
};
use crate::{
    atlas::context::Epoch,
    field::Field,
    spatial::{Predicate, SpatialKernel},
    tectonics::controls::{plate_travel, DEFAULT_MYR},
};
use atlas_map::Geometry;
use std::io;
pub struct Scope<'a> {
    pub identity: Identity,
    pub footprint: &'a Geometry,
    pub epochs: usize,
    pub regional: bool,
}
pub struct Counts {
    pub landscape: f64,
    pub magic: f64,
}
pub fn drift_steps(drift_per_myr: f64, epochs: &[Epoch], enabled: bool) -> Vec<f64> {
    if !enabled {
        return vec![];
    }
    epochs
        .iter()
        .map(|e| {
            plate_travel(
                drift_per_myr,
                e.tectonic_duration_myr.unwrap_or(DEFAULT_MYR),
                e.plate_travel.unwrap_or(1.0),
            )
        })
        .collect()
}
pub fn selected(
    landmarks: &[Landmark],
    scope: &Scope<'_>,
    kernel: &dyn SpatialKernel,
) -> io::Result<Vec<usize>> {
    let mut selected = Vec::new();
    for (index, l) in landmarks.iter().enumerate() {
        if l.space_id.is_some_and(|id| id != scope.identity.space)
            || l.emplaced_at_epoch >= scope.epochs as i32
        {
            continue;
        }
        let footprint = kernel
            .buffer(&l.geometry, l.kind.reach(&l.parameters))
            .map_err(io::Error::other)?
            .unwrap_or_else(|| l.geometry.clone());
        if kernel
            .relation(&footprint, scope.footprint, Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            selected.push(index);
        }
    }
    Ok(selected)
}
pub fn roster(
    landmarks: &[Landmark],
    existing: &[usize],
    scope: &Scope<'_>,
    counts: Counts,
    enabled: &[&str],
    seed: i32,
) -> io::Result<Vec<Entry>> {
    let magic = existing
        .iter()
        .filter(|&&i| landmarks[i].kind.system().is_some())
        .count();
    let short = |count: f64, have: usize| ((count + 0.5).floor() - have as f64).max(0.0) as usize;
    let landscape = short(counts.landscape, existing.len() - magic);
    let mix = MAGIC_MIX
        .into_iter()
        .filter(|kind| enabled.contains(&kind.system().unwrap()))
        .collect::<Vec<_>>();
    let magic = if mix.is_empty() {
        0
    } else {
        short(counts.magic, magic)
    };
    let ordinals = roster::free_ordinals(
        scope.identity.world,
        scope.identity.area,
        landmarks,
        landscape + magic,
    );
    let mut entries = roster::roster(seed, &ordinals[..landscape], scope.epochs, &LANDSCAPE_MIX);
    entries.extend(roster::roster(
        seed ^ 0x5a5a,
        &ordinals[landscape..],
        scope.epochs,
        &mix,
    ));
    Ok(entries)
}
pub struct Forming<'a> {
    pub scope: Scope<'a>,
    pub tracking: Tracking<'a>,
    pub seed: i32,
}
pub fn site_forming(
    field: &Field,
    landmarks: &mut Vec<Landmark>,
    entries: &mut [Entry],
    input: &Forming<'_>,
) -> io::Result<Vec<atlas_map::Id>> {
    let epoch = input.tracking.epoch;
    if input.scope.regional || !entries.iter().any(|e| !e.sited && e.epoch <= epoch) {
        return Ok(vec![]);
    }
    let kernel = input.tracking.kernel;
    let terrain = Terrain::new(field, kernel)?;
    let mut standing = Vec::new();
    for i in selected(landmarks, &input.scope, kernel)? {
        if let Some(placed) = place(field, &landmarks[i], Some(&input.tracking))? {
            standing.push(Taken {
                point: placed.center,
                reach: placed.landmark.kind.reach(&placed.landmark.parameters),
            });
        }
    }
    let mut sited = Vec::new();
    for entry in entries.iter_mut().filter(|e| !e.sited && e.epoch <= epoch) {
        let Some((site, parameters)) = roster::site(&terrain, entry, input.seed, &standing)? else {
            entry.epoch = (epoch + 1).min(input.scope.epochs.saturating_sub(1));
            continue;
        };
        entry.epoch = epoch;
        let point = site.path[0];
        let reach = entry.kind.reach(&parameters);
        let landmark = roster::generated(
            field,
            &input.scope.identity,
            entry,
            site,
            parameters,
            &input.tracking,
        )?;
        if !kernel
            .relation(input.scope.footprint, &landmark.geometry, Predicate::Covers)
            .map_err(io::Error::other)?
        {
            entry.epoch = (epoch + 1).min(input.scope.epochs.saturating_sub(1));
            continue;
        }
        entry.sited = true;
        sited.push(landmark.id);
        landmarks.push(landmark);
        standing.push(Taken { point, reach });
    }
    Ok(sited)
}
