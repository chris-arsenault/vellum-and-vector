//! Discover and publish connected pools from priority-flood depressions and water supply.
use super::{
    column::{StandingKind, WaterColumn, NO_WATER_SURFACE},
    drainage::DrainageView,
    lake_stage::{
        contributing_water, qualifies, solve_stage, split_connected, Depression, LakeCriteria,
        StageInputs, SupportedLake,
    },
};
use crate::{
    chance::Chance,
    scale::{MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
};
use std::io;
pub struct LakeInputs<'a> {
    pub stage: StageInputs<'a>,
    pub drainage: &'a DrainageView,
    pub scale: &'a MapScale,
    pub surface_water: &'a ReadBand<f64>,
    pub incoming: Option<&'a ReadBand<f64>>,
    pub passage: &'a dyn Fn(usize, f64) -> io::Result<f64>,
    pub criteria: LakeCriteria<'a>,
    pub seed: i32,
}
impl WaterColumn {
    pub fn lake_basins(
        &mut self,
        input: LakeInputs<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.clear_lakes()?;
        let view = self.read_only();
        let water = contributing_water(
            input.stage.mesh,
            input.drainage,
            input.surface_water,
            input.incoming,
            input.passage,
            coverage,
        )?;
        let mut mask = coverage.scratch(input.stage.mesh.len(), 0u8);
        let mut marks = coverage.scratch(input.stage.mesh.len(), 0i32);
        let depth = input
            .scale
            .resolve(RelativeMeasure::length(2.5e-7).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        for cell in 0..mask.len() {
            mask.set(
                cell,
                u8::from(
                    view.kind.get(cell)? == 0
                        && input.drainage.elevations.get(cell)?
                            - input.stage.elevation.get(cell)?
                            - (input.stage.held_by_ice)(cell)?
                            >= MapScale::native(depth),
                ),
            )?;
        }
        let mut component = 0;
        let mut supported = Vec::new();
        for cell in 0..mask.len() {
            if mask.get(cell)? == 0 || marks.get(cell)? != 0 {
                continue;
            }
            component += 1;
            let basins = collect_depressions(&input, &mask, &mut marks, cell, component, coverage)?;
            for basin in basins {
                add_pools(&input, basin, &water.read_only(), &mut supported, coverage)?;
            }
        }
        // hpc-exempt: one record per retained lake, ordered by its first member.
        supported.sort_by_key(|lake| lake.members[0]);
        for (at, lake) in supported.iter().enumerate() {
            self.mark_lake(&input, lake, &marks, at as i32 + 2)?;
        }
        Ok(())
    }
    fn mark_lake(
        &mut self,
        input: &LakeInputs<'_>,
        lake: &SupportedLake,
        marks: &Band<i32>,
        id: i32,
    ) -> io::Result<()> {
        for &cell in &lake.members {
            self.stand(cell, StandingKind::Lake, lake.surface, Some(id))?;
        }
        if lake.overflow <= 0.0 || lake.surface < lake.component.spill {
            return Ok(());
        }
        if let Some(outlet) = find_outlet(input, lake, marks, &self.read_only().kind)? {
            self.set_lake_outlet(outlet.member, outlet.target as i32, lake.overflow)?;
        }
        Ok(())
    }
}
fn collect_depressions(
    input: &LakeInputs<'_>,
    mask: &Band<u8>,
    marks: &mut Band<i32>,
    start: usize,
    id: i32,
    coverage: &mut Coverage,
) -> io::Result<Vec<Depression>> {
    marks.set(start, id)?;
    let mut collected = vec![start];
    let mut spill = f64::MAX;
    let mut head = 0;
    while head < collected.len() {
        let cell = collected[head];
        head += 1;
        spill = spill.min(input.drainage.elevations.get(cell)?);
        for edge in 0..3 {
            let Some(next) = input.stage.mesh.neighbor(cell, edge) else {
                continue;
            };
            if mask.get(next)? == 0 || marks.get(next)? != 0 {
                continue;
            }
            marks.set(next, id)?;
            collected.push(next);
        }
    }
    let mut wet = Vec::new();
    for cell in collected {
        if spill > input.stage.elevation.get(cell)? {
            wet.push(cell);
        }
    }
    Ok(split_connected(input.stage.mesh, &wet, coverage)?
        .into_iter()
        .map(|members| Depression { id, members, spill })
        .collect())
}
fn add_pools(
    input: &LakeInputs<'_>,
    component: Depression,
    water: &ReadBand<f64>,
    supported: &mut Vec<SupportedLake>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let Some(lake) = solve_stage(&input.stage, component, water, coverage)? else {
        return Ok(());
    };
    for members in split_connected(input.stage.mesh, &lake.members, coverage)? {
        let mut depth = 0.0f64;
        for &cell in &members {
            depth = depth.max(lake.surface - input.stage.elevation.get(cell)?);
        }
        let overflow = if members.len() == lake.members.len() {
            lake.overflow
        } else {
            0.0
        };
        let pool = SupportedLake {
            component: lake.component.clone(),
            members,
            depth,
            overflow,
            surface: lake.surface,
        };
        if qualifies(input.stage.mesh, &input.criteria, &pool, coverage)? {
            supported.push(pool);
        }
    }
    Ok(())
}
struct Outlet {
    member: usize,
    target: usize,
    rank: i32,
    drainage: f64,
    geometry: f64,
}
impl Outlet {
    fn preferred(&self, best: &Self) -> bool {
        self.rank < best.rank
            || (self.rank == best.rank
                && (self.drainage < best.drainage
                    || (self.drainage == best.drainage && self.geometry > best.geometry)))
    }
}
fn find_outlet(
    input: &LakeInputs<'_>,
    lake: &SupportedLake,
    marks: &Band<i32>,
    kind: &ReadBand<u8>,
) -> io::Result<Option<Outlet>> {
    let mut best: Option<Outlet> = None;
    for &member in &lake.component.members {
        let Ok(target) = usize::try_from(input.drainage.parents.get(member)?) else {
            continue;
        };
        if marks.get(target)? == lake.component.id {
            continue;
        }
        let drainage = if kind.get(target)? == 1 {
            NO_WATER_SURFACE
        } else {
            input.drainage.elevations.get(target)?
        };
        if drainage > lake.component.spill {
            continue;
        }
        let [mx, my] = input.stage.mesh.position(member);
        let [tx, ty] = input.stage.mesh.position(target);
        let x = (((2.0 * mx + input.stage.mesh.delta_x(tx - mx)) as f32 as f64) * 512.0).round();
        let y = (((my + ty) as f32 as f64) * 512.0).round();
        let candidate = Outlet {
            member,
            target,
            rank: input.drainage.ranks.get(member)?,
            drainage,
            geometry: Chance::of(input.seed, 0x5b91).unit([x, y]),
        };
        if best.as_ref().is_none_or(|best| candidate.preferred(best)) {
            best = Some(candidate);
        }
    }
    Ok(best)
}
