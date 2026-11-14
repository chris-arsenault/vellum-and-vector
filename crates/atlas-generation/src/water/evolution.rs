//! Retained network evolution from water/reachEvolution.ts, before any raster projection.
use super::{
    balance::{flow_through_year, MONTHS},
    reaches::{FormerCourse, Reach, ReachStore},
};
use std::io;

/// Explicit routed water and terrain inputs; no cell river classification enters this contract.
pub trait RiverEnvironment {
    fn count(&self) -> usize;
    fn ordered(&self, at: usize) -> io::Result<usize>;
    fn next(&self, cell: usize) -> io::Result<Option<usize>>;
    fn land(&self, cell: usize) -> io::Result<bool>;
    fn resolved(&self, cell: usize) -> io::Result<bool>;
    fn flow(&self, cell: usize, month: usize) -> io::Result<f64>;
    fn bed(&self, cell: usize) -> io::Result<f64>;
    fn catchment(&self, cell: usize) -> io::Result<f64>;
    fn discharge(&self) -> f64;
    fn epoch(&self) -> f64;
    fn new_head(&self, _cell: usize) -> io::Result<bool> {
        Ok(true)
    }
}
fn course(
    from: usize,
    owner: &[usize],
    env: &impl RiverEnvironment,
    own: usize,
) -> io::Result<Vec<usize>> {
    let mut cells = Vec::new();
    let mut next = Some(from);
    while let Some(cell) = next {
        if !env.land(cell)? || !env.resolved(cell)? || (owner[cell] != 0 && owner[cell] != own) {
            break;
        }
        cells.push(cell);
        next = env.next(cell)?;
    }
    Ok(cells)
}
fn copy_upper(reach: &mut Reach, upper: &mut Reach, at: usize) {
    upper.drawn = reach.drawn;
    upper.dry = reach.dry;
    upper.order = reach.order;
    upper.river.clone_from(&reach.river);
    upper.record.clone_from(&reach.record);
    upper.name.clone_from(&reach.name);
    upper.dried_in = reach.dried_in;
    upper.monthly = take_prefix(&mut reach.monthly, at * MONTHS);
    upper.catchment = take_prefix(&mut reach.catchment, at);
    upper.bed = take_prefix(&mut reach.bed, at);
    upper.width = take_prefix(&mut reach.width, at);
    upper.depth = take_prefix(&mut reach.depth, at);
    upper.leakage = take_prefix(&mut reach.leakage, at);
    let water = flow_through_year(
        &upper.monthly[upper.monthly.len().saturating_sub(MONTHS)..],
        0.0,
    );
    upper.flow = water.mean;
    upper.least = water.perennial;
    upper.flood = water.flood;
    upper.months = upper.months_at(upper.cells.len() - 1);
    upper.downstream = Some(reach.id);
    reach.cells.drain(..at);
}
// Course changes precede profile refresh. Like typed-array slice, split only the profile present.
fn take_prefix(values: &mut Vec<f64>, length: usize) -> Vec<f64> {
    values.drain(..length.min(values.len())).collect()
}
impl ReachStore {
    /// At a new junction, the named lower reach retains its identity.
    pub fn split_at(&mut self, id: usize, cell: usize) -> Option<usize> {
        self.split_owned(id, cell, None)
    }
    fn split_owned(
        &mut self,
        id: usize,
        cell: usize,
        owner: Option<&mut [usize]>,
    ) -> Option<usize> {
        let at = self
            .get(id)?
            .cells
            .iter()
            .position(|&member| member == cell)?;
        if at == 0 {
            return None;
        }
        let mut reach = self.records_mut()[id].take()?;
        let upper_id = self.next();
        let mut upper = Reach::new(upper_id, reach.cells[..at].to_vec());
        copy_upper(&mut reach, &mut upper, at);
        for other in self.records_mut().iter_mut().flatten() {
            if other.downstream == Some(id) {
                other.downstream = Some(upper_id);
            }
        }
        if let Some(owner) = owner {
            for &member in &upper.cells {
                owner[member] = upper_id;
            }
        }
        self.records_mut()[id] = Some(reach);
        self.records_mut().push(Some(upper));
        Some(upper_id)
    }
}
fn split_receiving(
    store: &mut ReachStore,
    cells: &[usize],
    owner: &mut [usize],
    env: &impl RiverEnvironment,
    own: usize,
) -> io::Result<()> {
    let Some(&last) = cells.last() else {
        return Ok(());
    };
    let Some(next) = env.next(last)? else {
        return Ok(());
    };
    let receiving = owner[next];
    if receiving != own && store.get(receiving).is_some() {
        store.split_owned(receiving, next, Some(owner));
    }
    Ok(())
}
fn has_water(cell: usize, env: &impl RiverEnvironment) -> io::Result<bool> {
    for month in 0..MONTHS {
        if env.flow(cell, month)? > 0.0 {
            return Ok(true);
        }
    }
    Ok(false)
}
fn left_courses(before: &[usize], running: &[bool]) -> Vec<Vec<usize>> {
    let mut courses = Vec::new();
    let mut part = Vec::new();
    for edge in before.windows(2) {
        if running[edge[0]] && running[edge[1]] {
            if !part.is_empty() {
                courses.push(std::mem::take(&mut part));
            }
        } else {
            if part.is_empty() {
                part.push(edge[0]);
            }
            part.push(edge[1]);
        }
    }
    if !part.is_empty() {
        courses.push(part);
    }
    courses
}
fn refresh(
    store: &mut ReachStore,
    id: usize,
    owner: &mut [usize],
    env: &impl RiverEnvironment,
) -> io::Result<()> {
    let head = flowing_head(store.get(id).unwrap(), env)?;
    let cells = match head {
        Some(head) => course(head, owner, env, id)?,
        None => Vec::new(),
    };
    if cells.is_empty() {
        let reach = store.get_mut(id).unwrap();
        reach.dry = true;
        reach.dried_in.get_or_insert(env.epoch());
        for &cell in &reach.cells {
            if owner[cell] == id {
                owner[cell] = 0;
            }
        }
        return Ok(());
    }
    split_receiving(store, &cells, owner, env, id)?;
    let reach = store.get_mut(id).unwrap();
    let mut running = vec![false; env.count()];
    for &cell in &cells {
        running[cell] = true;
    }
    reach.former = reach
        .former
        .iter()
        .flat_map(|old| {
            left_courses(&old.cells, &running)
                .into_iter()
                .map(|cells| FormerCourse {
                    cells,
                    left_in: old.left_in,
                })
        })
        .collect();
    reach.former.extend(
        left_courses(&reach.cells, &running)
            .into_iter()
            .map(|cells| FormerCourse {
                cells,
                left_in: env.epoch(),
            }),
    );
    for &cell in &reach.cells {
        if owner[cell] == id {
            owner[cell] = 0;
        }
    }
    reach.cells = cells;
    reach.dry = false;
    reach.dried_in = None;
    for &cell in &reach.cells {
        owner[cell] = id;
    }
    Ok(())
}
pub(super) fn refresh_reach_water(
    reach: &mut Reach,
    env: &impl RiverEnvironment,
) -> io::Result<()> {
    reach.monthly = vec![0.0; reach.cells.len() * MONTHS];
    reach.bed = reach
        .cells
        .iter()
        .map(|&cell| env.bed(cell))
        .collect::<io::Result<_>>()?;
    reach.catchment = reach
        .cells
        .iter()
        .map(|&cell| env.catchment(cell))
        .collect::<io::Result<_>>()?;
    if reach.width.len() != reach.cells.len() {
        reach.width = vec![0.0; reach.cells.len()];
        reach.depth = vec![0.0; reach.cells.len()];
    }
    if !reach.dry {
        for (at, &cell) in reach.cells.iter().enumerate() {
            for month in 0..MONTHS {
                reach.monthly[at * MONTHS + month] = env.flow(cell, month)?;
            }
        }
    }
    let end = reach.monthly.len().saturating_sub(MONTHS);
    let water = flow_through_year(&reach.monthly[end..], env.discharge());
    reach.flow = water.mean;
    reach.least = water.perennial;
    reach.flood = water.flood;
    reach.months = if reach.cells.is_empty() {
        0
    } else {
        reach.months_at(reach.cells.len() - 1)
    };
    Ok(())
}
impl ReachStore {
    // owner-direction(2026-11-12): rivers are kept things that processes change; cells hold quantities and are never rivers.
    pub fn advance(&mut self, env: &impl RiverEnvironment) -> io::Result<()> {
        let mut owner = vec![0; env.count()];
        for reach in self.reaches().filter(|reach| !reach.dry) {
            // Keep newly dry beds without reserving their obsolete route against running water.
            if flowing_head(reach, env)?.is_none() {
                continue;
            }
            for &cell in &reach.cells {
                owner[cell] = reach.id;
            }
        }
        // Map iteration in the source also visits newly inserted upper reaches.
        let mut id = 1;
        while id < self.next() {
            if self.get(id).is_some() {
                refresh(self, id, &mut owner, env)?;
            }
            id += 1;
        }
        discover(self, &mut owner, env)?;
        for reach in self
            .records_mut()
            .iter_mut()
            .flatten()
            .filter(|reach| !reach.dry)
        {
            reach.downstream = match reach.cells.last() {
                Some(&cell) => env.next(cell)?,
                None => None,
            }
            .map(|cell| owner[cell])
            .filter(|id| *id != 0);
            reach.order = 1;
        }
        join_continuations(self, &mut owner, env)?;
        for reach in self.records_mut().iter_mut().flatten() {
            refresh_reach_water(reach, env)?;
            if !reach.monthly.iter().any(|flow| *flow > 0.0) {
                reach.dry = true;
                reach.dried_in.get_or_insert(env.epoch());
            }
        }
        assign_orders(self, &owner, env)
    }
}
fn flowing_head(reach: &Reach, env: &impl RiverEnvironment) -> io::Result<Option<usize>> {
    for &cell in &reach.cells {
        if env.land(cell)? && env.resolved(cell)? && has_water(cell, env)? {
            return Ok(Some(cell));
        }
    }
    Ok(None)
}
fn discover(
    store: &mut ReachStore,
    owner: &mut [usize],
    env: &impl RiverEnvironment,
) -> io::Result<()> {
    for at in 0..env.count() {
        let cell = env.ordered(at)?;
        if owner[cell] != 0
            || !env.land(cell)?
            || !env.resolved(cell)?
            || !env.new_head(cell)?
            || !has_water(cell, env)?
        {
            continue;
        }
        let cells = course(cell, owner, env, 0)?;
        if cells.is_empty() {
            continue;
        }
        split_receiving(store, &cells, owner, env, 0)?;
        let id = store.add(cells);
        for &member in store.get(id).unwrap().cells() {
            owner[member] = id;
        }
    }
    Ok(())
}
fn incoming_reaches(store: &ReachStore) -> Vec<usize> {
    let mut incoming = vec![0; store.next()];
    for reach in store.reaches().filter(|reach| !reach.dry) {
        if let Some(next) = reach.downstream {
            incoming[next] += 1;
        }
    }
    incoming
}
fn join_continuations(
    store: &mut ReachStore,
    owner: &mut [usize],
    env: &impl RiverEnvironment,
) -> io::Result<()> {
    let mut incoming = incoming_reaches(store);
    for at in 0..env.count() {
        let cell = env.ordered(at)?;
        let Some(upper) = store.get(owner[cell]).filter(|reach| !reach.dry) else {
            continue;
        };
        let Some(lower) = upper.downstream.and_then(|id| store.get(id)) else {
            continue;
        };
        if incoming[lower.id] != 1 {
            continue;
        }
        if upper.river.is_some() && lower.river.is_some() && upper.river != lower.river {
            continue;
        }
        let (upper, lower) = (upper.id, lower.id);
        merge_into(store, upper, lower, owner);
        incoming[lower] = incoming[upper];
    }
    Ok(())
}
fn merge_into(store: &mut ReachStore, upper: usize, lower: usize, owner: &mut [usize]) {
    let upper = store.records_mut()[upper].take().unwrap();
    let lower = store.get_mut(lower).unwrap();
    for &cell in &upper.cells {
        owner[cell] = lower.id;
    }
    let mut cells = upper.cells;
    cells.append(&mut lower.cells);
    lower.cells = cells;
    lower.former.extend(upper.former);
    lower.river = lower.river.take().or(upper.river);
    lower.record = lower.record.take().or(upper.record);
    lower.name = lower.name.take().or(upper.name);
    let lower_id = lower.id;
    for reach in store.records_mut().iter_mut().flatten() {
        if reach.downstream == Some(upper.id) {
            reach.downstream = Some(lower_id);
        }
    }
}
fn assign_orders(
    store: &mut ReachStore,
    owner: &[usize],
    env: &impl RiverEnvironment,
) -> io::Result<()> {
    let mut largest = vec![0u16; env.count()];
    let mut count = vec![0u16; env.count()];
    for at in 0..env.count() {
        let cell = env.ordered(at)?;
        let Some(reach) = store.get_mut(owner[cell]) else {
            continue;
        };
        if reach.cells.last() != Some(&cell) {
            continue;
        }
        let head = reach.cells[0];
        reach.order = if largest[head] == 0 {
            1
        } else {
            largest[head].wrapping_add(u16::from(count[head] > 1))
        };
        let order = reach.order;
        let next = reach.downstream;
        let Some(next) = next.and_then(|id| store.get(id)) else {
            continue;
        };
        let target = next.cells[0];
        if order > largest[target] {
            largest[target] = order;
            count[target] = 1;
        } else if order == largest[target] {
            count[target] = count[target].wrapping_add(1);
        }
    }
    Ok(())
}
