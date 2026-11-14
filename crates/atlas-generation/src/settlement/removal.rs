//! Facet/pool splitting and deferred removal from coupling/stageRemoval.ts.
use super::{allocate, Demand, Sharing};
use crate::{
    rock::material::MaterialLayer,
    scale::{MapScale, RelativeMeasure},
    storage::{Band, Coverage},
};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroundSource {
    Surface,
    Loose,
    Rock,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaterialPool {
    Loose,
    Rock,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Facet {
    Land,
    Cut,
}
impl Facet {
    pub const ALL: [Self; 2] = [Self::Land, Self::Cut];
}
pub struct Incision {
    pub share: Band<f64>,
    pub deepened: Band<f64>,
}
pub struct RemovalRequest {
    pub from: GroundSource,
    pub cause: String,
    pub amount: Band<f64>,
    pub past_base_level: bool,
    pub facet: Option<Facet>,
    pub incision: Option<Incision>,
}
pub struct FacetState {
    pub share: f64,
    pub cover: f64,
    pub surface: f64,
}
pub struct Withdrawal<'a> {
    pub cell: usize,
    pub facet: Facet,
    pub pool: MaterialPool,
    pub amount: f64,
    pub cause: &'a str,
    pub soil: f64,
}
pub struct Cut<'a> {
    pub cell: usize,
    pub depth: f64,
    pub share: f64,
    pub cause: &'a str,
    pub floor: f64,
}
pub struct CutReceipt {
    pub amount: f64,
    pub depth: f64,
}

/// The ground owner supplies actual substrate operations. Allocation cannot replace them with scalar subtraction.
pub trait RemovalGround {
    fn count(&self) -> usize;
    fn scale(&self) -> &MapScale;
    fn sea_level(&self) -> f64;
    fn marine(&self, cell: usize) -> io::Result<bool>;
    fn facet(&self, cell: usize, facet: Facet) -> io::Result<FacetState>;
    fn sediment(&self, cell: usize) -> io::Result<f64>;
    fn soil(&self, cell: usize) -> io::Result<f64>;
    /// Returned lowering and emitted material already include this facet's whole-cell share.
    fn withdraw(
        &mut self,
        action: Withdrawal<'_>,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<f64>;
    fn cut(
        &mut self,
        action: Cut<'_>,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<CutReceipt>;
}
struct Removal {
    request: usize,
    pool: MaterialPool,
    facet: Facet,
    amount: Band<f64>,
    available: Band<f64>,
    granted: Band<f64>,
}
fn base_level(
    ground: &impl RemovalGround,
    request: &RemovalRequest,
    cell: usize,
) -> io::Result<f64> {
    if request.past_base_level || ground.marine(cell)? {
        return Ok(f64::NEG_INFINITY);
    }
    let clearance = ground
        .scale()
        .resolve(RelativeMeasure::length(2.5e-7).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    Ok(ground.sea_level() + MapScale::native(clearance))
}
#[derive(Clone, Copy, Default)]
pub struct PoolDemand {
    pub loose: f64,
    pub rock: f64,
}
pub struct IncisionDemand {
    pub land: PoolDemand,
    pub cut: PoolDemand,
}
/// Widening consumes the new footprint before deepening the combined floor.
pub fn incision_demand(
    land: &FacetState,
    cut: &FacetState,
    budget: f64,
    requested_share: f64,
    floor: f64,
) -> IncisionDemand {
    let old = cut.share;
    let wanted = requested_share.clamp(0.0, 1.0);
    let old_surface = if old > 0.0 { cut.surface } else { land.surface };
    let gap = (land.surface - old_surface.max(floor)).max(0.0);
    let added = (wanted - old).max(0.0);
    let widening = budget.min(added * gap);
    let reached = old
        + if gap > 0.0 {
            added.min(budget / gap)
        } else {
            added
        };
    let deepening = if reached > 0.0 {
        (budget - widening).max(0.0) / reached
    } else {
        0.0
    };
    let slice = |depth: f64, share: f64, cover: f64| PoolDemand {
        loose: depth.min(cover) * share,
        rock: (depth - cover).max(0.0) * share,
    };
    IncisionDemand {
        land: slice(gap + deepening, reached - old, land.cover),
        cut: slice(deepening, old, cut.cover),
    }
}
fn requested(
    ground: &impl RemovalGround,
    request: &RemovalRequest,
    cell: usize,
    facet: Facet,
    pool: MaterialPool,
) -> io::Result<f64> {
    let state = ground.facet(cell, facet)?;
    if state.share <= 0.0 || request.facet.is_some_and(|only| only != facet) {
        return Ok(0.0);
    }
    let amount = request.amount.get(cell)?;
    if let Some(incision) = &request.incision {
        let demand = incision_demand(
            &ground.facet(cell, Facet::Land)?,
            &ground.facet(cell, Facet::Cut)?,
            amount,
            incision.share.get(cell)?,
            base_level(ground, request, cell)?,
        );
        let split = match facet {
            Facet::Land => demand.land,
            Facet::Cut => demand.cut,
        };
        return Ok(match pool {
            MaterialPool::Loose => split.loose,
            MaterialPool::Rock => split.rock,
        } / state.share);
    }
    let wanted = amount
        / if request.facet.is_some() {
            state.share
        } else {
            1.0
        };
    if request.from == GroundSource::Surface {
        return Ok(match pool {
            MaterialPool::Loose => wanted.min(state.cover),
            MaterialPool::Rock => (wanted - state.cover).max(0.0),
        });
    }
    let sediment = ground.sediment(cell)?;
    let loose_share = if sediment > 0.0 {
        state.cover / sediment
    } else {
        0.0
    };
    Ok(wanted
        * if pool == MaterialPool::Loose {
            loose_share
        } else {
            1.0
        })
}
fn supply(
    ground: &impl RemovalGround,
    request: &RemovalRequest,
    cell: usize,
    facet: Facet,
    pool: MaterialPool,
) -> io::Result<f64> {
    let state = ground.facet(cell, facet)?;
    let floor = base_level(ground, request, cell)?;
    let above = (state.surface - floor).max(0.0);
    Ok(match pool {
        MaterialPool::Loose => state.cover.min(above),
        MaterialPool::Rock => (above - state.cover).max(0.0),
    })
}
fn split(
    ground: &impl RemovalGround,
    requests: &[RemovalRequest],
    coverage: &mut Coverage,
) -> io::Result<Vec<Removal>> {
    let mut removals = Vec::new();
    for (index, request) in requests.iter().enumerate() {
        for facet in Facet::ALL {
            for pool in [MaterialPool::Loose, MaterialPool::Rock] {
                if matches!(
                    (request.from, pool),
                    (GroundSource::Loose, MaterialPool::Rock)
                        | (GroundSource::Rock, MaterialPool::Loose)
                ) {
                    continue;
                }
                removals.push(split_pool(ground, request, (index, facet, pool), coverage)?);
            }
        }
    }
    Ok(removals)
}
fn split_pool(
    ground: &impl RemovalGround,
    request: &RemovalRequest,
    key: (usize, Facet, MaterialPool),
    coverage: &mut Coverage,
) -> io::Result<Removal> {
    let (index, facet, pool) = key;
    let mut amount = coverage.scratch(ground.count(), 0.0);
    let mut available = coverage.scratch(ground.count(), 0.0);
    for cell in 0..ground.count() {
        amount.set(cell, requested(ground, request, cell, facet, pool)?)?;
        available.set(cell, supply(ground, request, cell, facet, pool)?)?;
    }
    Ok(Removal {
        request: index,
        pool,
        facet,
        amount,
        available,
        granted: coverage.scratch(ground.count(), 0.0),
    })
}
fn allocate_pools(
    removals: &mut [Removal],
    sharing: Sharing,
    coverage: &mut Coverage,
) -> io::Result<()> {
    for facet in Facet::ALL {
        for pool in [MaterialPool::Loose, MaterialPool::Rock] {
            let indices: Vec<_> = removals
                .iter()
                .enumerate()
                .filter(|(_, removal)| removal.facet == facet && removal.pool == pool)
                .map(|(i, _)| i)
                .collect();
            let demands: Vec<_> = indices
                .iter()
                .map(|&i| Demand {
                    amount: removals[i].amount.read_only(),
                    available: removals[i].available.read_only(),
                })
                .collect();
            let grants = allocate(&demands, sharing, coverage)?;
            for (i, grant) in indices.into_iter().zip(grants) {
                removals[i].granted = grant;
            }
        }
    }
    Ok(())
}
pub fn settle_removals(
    ground: &mut impl RemovalGround,
    requests: &mut [RemovalRequest],
    sharing: Sharing,
    coverage: &mut Coverage,
    receive: &mut dyn FnMut(usize, usize, MaterialLayer) -> io::Result<()>,
) -> io::Result<Vec<Band<f64>>> {
    let mut removals = split(ground, requests, coverage)?;
    let mut soil = coverage.scratch(ground.count(), 0.0);
    for cell in 0..ground.count() {
        soil.set(cell, ground.soil(cell)?)?;
    }
    let mut landed: Vec<_> = requests
        .iter()
        .map(|_| coverage.scratch(ground.count(), 0.0))
        .collect();
    allocate_pools(&mut removals, sharing, coverage)?;
    for pool in [MaterialPool::Loose, MaterialPool::Rock] {
        for removal in removals.iter().filter(|removal| removal.pool == pool) {
            remove_pool(
                ground,
                &requests[removal.request],
                removal,
                &soil,
                &mut landed[removal.request],
                receive,
            )?;
        }
    }
    settle_incisions(ground, requests, &mut landed, receive)?;
    Ok(landed)
}
fn remove_pool(
    ground: &mut impl RemovalGround,
    request: &RemovalRequest,
    removal: &Removal,
    soil: &Band<f64>,
    actual: &mut Band<f64>,
    receive: &mut dyn FnMut(usize, usize, MaterialLayer) -> io::Result<()>,
) -> io::Result<()> {
    for cell in 0..ground.count() {
        let amount = removal.granted.get(cell)?.round();
        let taken = if request.incision.is_some() {
            amount * ground.facet(cell, removal.facet)?.share
        } else if amount > 0.0 {
            ground.withdraw(
                Withdrawal {
                    cell,
                    facet: removal.facet,
                    pool: removal.pool,
                    amount,
                    cause: &request.cause,
                    soil: soil.get(cell)?,
                },
                &mut |material| receive(removal.request, cell, material),
            )?
        } else {
            0.0
        };
        actual.set(cell, actual.get(cell)? + taken)?;
    }
    Ok(())
}
fn settle_incisions(
    ground: &mut impl RemovalGround,
    requests: &mut [RemovalRequest],
    landed: &mut [Band<f64>],
    receive: &mut dyn FnMut(usize, usize, MaterialLayer) -> io::Result<()>,
) -> io::Result<()> {
    for (index, request) in requests.iter_mut().enumerate() {
        if request.incision.is_none() {
            continue;
        }
        for cell in 0..ground.count() {
            let budget = landed[index].get(cell)?;
            let share = request.incision.as_ref().unwrap().share.get(cell)?;
            if budget <= 0.0 || share <= 0.0 {
                continue;
            }
            let floor = base_level(ground, request, cell)?;
            let cut = ground.cut(
                Cut {
                    cell,
                    depth: budget / share,
                    share,
                    cause: &request.cause,
                    floor,
                },
                &mut |material| receive(index, cell, material),
            )?;
            landed[index].set(cell, cut.amount)?;
            request
                .incision
                .as_mut()
                .unwrap()
                .deepened
                .set(cell, cut.depth)?;
        }
    }
    Ok(())
}
