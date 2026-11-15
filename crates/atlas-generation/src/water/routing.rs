//! Land follows drainage guidance; each lake routes to one physically connected outlet.
use super::{
    drainage::DrainageView,
    guidance::select_by_outlet_alignment,
    network::{retain_routes, RiverTerrain},
    reaches::ReachStore,
};
use crate::{
    flow_graph::target_order,
    hpc::CellQueue,
    lattice::TriangularLattice,
    noise::hash_unit,
    scale::MapScale,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct FlowRouting {
    targets: Band<i32>,
    edges: Band<i32>,
    basins: Band<i32>,
}
pub struct FlowRoutingView {
    pub targets: ReadBand<i32>,
    pub edges: ReadBand<i32>,
    pub basins: ReadBand<i32>,
}
impl FlowRouting {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("routing-targets", &mut self.targets)?;
        archive.band("routing-edges", &mut self.edges)?;
        archive.band("routing-basins", &mut self.basins)
    }
    pub(super) fn inherit_basin(&mut self, cell: usize, basin: i32) -> io::Result<()> {
        self.basins.set(cell, basin)
    }
}
pub struct RoutingInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub water_kind: &'a ReadBand<u8>,
    pub water_body: &'a ReadBand<i32>,
    pub lake_outlets: &'a ReadBand<i32>,
    pub drainage: &'a DrainageView,
    pub open_outlet: &'a dyn Fn(usize) -> bool,
    pub seed: i32,
}
pub struct LakeMembership {
    offsets: Vec<usize>,
    members: Vec<usize>,
}
impl LakeMembership {
    pub fn read(kind: &ReadBand<u8>, bodies: &ReadBand<i32>) -> io::Result<Self> {
        let (mut labels, mut count) = (0, 0);
        for cell in 0..kind.len() {
            if kind.get(cell)? == 2 {
                let body = usize::try_from(bodies.get(cell)?).map_err(io::Error::other)?;
                labels = labels.max(body + 1);
                count += 1;
            }
        }
        let mut offsets = vec![0; labels + 1];
        for cell in 0..kind.len() {
            if kind.get(cell)? == 2 {
                offsets[bodies.get(cell)? as usize + 1] += 1;
            }
        }
        for body in 0..labels {
            offsets[body + 1] += offsets[body];
        }
        let mut members = vec![0; count];
        let mut cursor = offsets[..labels].to_vec();
        for cell in 0..kind.len() {
            if kind.get(cell)? == 2 {
                let body = bodies.get(cell)? as usize;
                members[cursor[body]] = cell;
                cursor[body] += 1;
            }
        }
        Ok(Self { offsets, members })
    }
    pub fn bodies(&self) -> impl Iterator<Item = &[usize]> {
        self.offsets
            .windows(2)
            .filter(|pair| pair[0] < pair[1])
            .map(|pair| &self.members[pair[0]..pair[1]])
    }
}
impl FlowRouting {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            targets: coverage.allocate(-1),
            edges: coverage.allocate(-1),
            basins: coverage.allocate(0),
        }
    }
    pub fn read_only(&self) -> FlowRoutingView {
        FlowRoutingView {
            targets: self.targets.read_only(),
            edges: self.edges.read_only(),
            basins: self.basins.read_only(),
        }
    }
    pub fn route(
        &mut self,
        input: RoutingInputs<'_>,
        rivers: &ReachStore,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        for cell in 0..input.mesh.len() {
            self.targets.set(
                cell,
                if input.water_kind.get(cell)? == 0 {
                    input.drainage.guidance.get(cell)?
                } else {
                    -1
                },
            )?;
            self.edges.set(cell, -1)?;
            self.basins.set(cell, 0)?;
        }
        let lakes = LakeMembership::read(input.water_kind, input.water_body)?;
        let mut ranks = coverage.scratch(input.mesh.len(), -1);
        for members in lakes.bodies() {
            self.route_lake(&input, members, &mut ranks)?;
        }
        retain_routes(
            rivers,
            &RiverTerrain {
                mesh: input.mesh,
                water_kind: input.water_kind,
                targets: &self.targets.read_only(),
            },
            &input.drainage.elevations,
            &input.drainage.ranks,
            &mut self.targets,
        )?;
        for cell in 0..input.mesh.len() {
            if let Ok(target) = usize::try_from(self.targets.get(cell)?) {
                let edge = (0..3).find(|&edge| input.mesh.neighbor(cell, edge) == Some(target));
                self.edges.set(cell, edge.map_or(-1, |edge| edge as i32))?;
            }
        }
        let order = target_order(coverage, &self.targets.read_only())?;
        let mut basin = 0;
        for at in (0..order.len()).rev() {
            let cell = order.get(at)? as usize;
            if input.water_kind.get(cell)? == 1 {
                continue;
            }
            let target = usize::try_from(self.targets.get(cell)?).ok();
            let value = match target {
                Some(target) if input.water_kind.get(target)? != 1 => self.basins.get(target)?,
                _ => {
                    basin += 1;
                    basin
                }
            };
            self.basins.set(cell, value)?;
        }
        Ok(())
    }
    fn route_lake(
        &mut self,
        input: &RoutingInputs<'_>,
        members: &[usize],
        ranks: &mut Band<i32>,
    ) -> io::Result<()> {
        let mut root = None;
        for &cell in members {
            if input.lake_outlets.get(cell)? >= 0 {
                root = Some(cell);
                break;
            }
        }
        let outlet = match root {
            Some(root) => input.lake_outlets.get(root)?,
            None => -1,
        };
        let root = root.unwrap_or_else(|| stable_root(input, members));
        lake_ranks(input, root, ranks)?;
        self.targets.set(root, outlet)?;
        self.outlet_escape(input, outlet)?;
        for &cell in members {
            if cell == root {
                continue;
            }
            let rank = ranks.get(cell)?;
            let body = input.water_body.get(root)?;
            let mut candidates = Vec::with_capacity(3);
            for edge in 0..3 {
                let Some(next) = input.mesh.neighbor(cell, edge) else {
                    continue;
                };
                let other = ranks.get(next)?;
                if input.water_body.get(next)? == body && other >= 0 && other < rank {
                    candidates.push(next);
                }
            }
            self.targets.set(
                cell,
                select_by_outlet_alignment(input.mesh, &candidates, cell, root, root as i32)?
                    as i32,
            )?;
        }
        Ok(())
    }
    fn outlet_escape(&mut self, input: &RoutingInputs<'_>, mut target: i32) -> io::Result<()> {
        while let Ok(cell) = usize::try_from(target) {
            if input.water_kind.get(cell)? != 0 {
                break;
            }
            let parent = input.drainage.parents.get(cell)?;
            if parent < 0 && !(input.open_outlet)(cell) {
                return Err(io::Error::other("Lake spill route does not reach water"));
            }
            self.targets.set(cell, parent)?;
            target = parent;
        }
        Ok(())
    }
}
fn stable_root(input: &RoutingInputs<'_>, members: &[usize]) -> usize {
    let (mut selected, mut best) = (members[0], -f64::MAX);
    for &cell in members {
        let [x, y] = input.mesh.position(cell);
        let score = hash_unit(
            input.seed ^ 0x6c53,
            MapScale::native(x),
            MapScale::native(y),
        );
        if score > best {
            selected = cell;
            best = score;
        }
    }
    selected
}
fn lake_ranks(input: &RoutingInputs<'_>, root: usize, ranks: &mut Band<i32>) -> io::Result<()> {
    let mut queue = CellQueue::new();
    let body = input.water_body.get(root)?;
    ranks.set(root, 0)?;
    queue.push_back(root as u32);
    while let Some(cell) = queue.pop_front() {
        let cell = cell as usize;
        for edge in 0..3 {
            let Some(next) = input.mesh.neighbor(cell, edge) else {
                continue;
            };
            if input.water_kind.get(next)? != 2
                || input.water_body.get(next)? != body
                || ranks.get(next)? >= 0
            {
                continue;
            }
            ranks.set(next, ranks.get(cell)? + 1)?;
            queue.push_back(next as u32);
        }
    }
    Ok(())
}
