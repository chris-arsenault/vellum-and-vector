use super::faces::{Faces, Relaxation};
use crate::{
    hpc::RecordQueue,
    lattice::TriangularLattice,
    rock::{
        catalogue,
        ground::{
            query::{average, ground_fact, Fact, GroundQuery},
            Ground, GroundField,
        },
        CompiledMix, ModeId, ModeMix,
    },
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
    storage::{Band, Coverage},
};
use std::io;
fn angle_held() -> GroundQuery<'static, f64> {
    let mut query = GroundQuery::new(1.0);
    query.rock = Some(Box::new(|_, layer, here| {
        (0.55 + layer.strength / catalogue::kind_of_code(catalogue::STRATA).facts.resistance * 0.45)
            .clamp(0.55, 1.45)
            * (1.2 - 0.5 * ground_fact(layer, Fact::Jointing))
            * (1.0 + here.tree * 0.2 + here.grass * 0.1)
    }));
    average(query)
}
fn support_failures(
    ground: &Ground,
    mesh: &TriangularLattice,
    mix: &CompiledMix,
    fails_at: f64,
    failed: &mut Band<u8>,
) -> io::Result<RecordQueue<3>> {
    let mut routes = RecordQueue::default();
    let query = angle_held();
    let elevation = ground.view(GroundField::Elevation);
    for cell in 0..mesh.len() {
        let (mut target, mut volume, mut selected) = (0usize, 0.0, 0usize);
        for (part, facet) in Facet::ALL.into_iter().enumerate() {
            let share = ground.share(cell, facet)?;
            if share <= 0.0 {
                continue;
            }
            let stable = fails_at * ground.fold(cell, &query, Some(facet))?;
            let surface = ground.surface(cell, facet)?;
            let mut failure = None;
            for edge in 0..3 {
                let Some(next) = mesh.neighbor(cell, edge) else {
                    continue;
                };
                if surface <= elevation.get(next)? {
                    continue;
                }
                if failure.is_none() {
                    failure = Some(ground.failure_from(cell, facet, mix)?);
                }
                let depth =
                    failure
                        .as_ref()
                        .unwrap()
                        .at(next, mesh.edge_length(cell, edge), stable)?;
                let candidate =
                    MapScale::metres(depth, LengthUnit::Native) * share * mesh.area(cell);
                if candidate <= volume {
                    continue;
                }
                target = next;
                volume = candidate;
                selected = part;
            }
        }
        if volume > 0.0 {
            failed.set(cell, 1)?;
            routes.push(cell as u32, [target as f64, volume, selected as f64]);
        }
    }
    Ok(routes)
}
pub(super) fn hillslope(
    ground: &Ground,
    mesh: &TriangularLattice,
    coverage: &mut Coverage,
    fails_at: f64,
) -> io::Result<RecordQueue<3>> {
    let mut plan = Faces::new(mesh, coverage)?;
    let mut heights = coverage.scratch(mesh.len(), 0.0);
    let mut stable = coverage.scratch(mesh.len(), 0.0);
    let mut failed = coverage.scratch(mesh.len(), 0u8);
    let angle = angle_held();
    let elevation = ground.view(GroundField::Elevation);
    for cell in 0..mesh.len() {
        heights.set(
            cell,
            MapScale::metres(elevation.get(cell)?, LengthUnit::Native),
        )?;
        stable.set(cell, fails_at * ground.fold(cell, &angle, None)?)?;
    }
    let mix = catalogue::compile(ModeMix::default().with(ModeId::Shear, 1.0));
    plan.relax(
        Relaxation {
            ground,
            mesh,
            mix: &mix,
            stable: &stable,
        },
        &mut heights,
        coverage,
    )?;
    let mut routes = support_failures(ground, mesh, &mix, fails_at, &mut failed)?;
    for at in 0..plan.count {
        let (i, j, volume) = (
            plan.from.get(at)? as usize,
            plan.to.get(at)? as usize,
            plan.volume.get(at)?,
        );
        if volume >= 0.0 && failed.get(i)? == 0 {
            routes.push(i as u32, [j as f64, volume, -1.0]);
        } else if volume < 0.0 && failed.get(j)? == 0 {
            routes.push(j as u32, [i as f64, -volume, -1.0]);
        }
    }
    Ok(routes)
}
