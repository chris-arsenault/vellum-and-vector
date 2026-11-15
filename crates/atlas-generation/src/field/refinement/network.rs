//! A captured drainage proposal; the Water owner determines later active rivers.
use super::{
    basins,
    evolution::{drainage_tree, Tree},
    topology::{distance, frame_edge, within},
};
use crate::lattice::{Membership, TriangularLattice};
use std::io;
pub const SECONDS_PER_YEAR: f64 = 365.25 * 24.0 * 3600.0;
/// Drainage costs around a captured peak or cone, in the source breadth-first order.
pub fn repulsion(mesh: &TriangularLattice, center: usize, reach: f64) -> Vec<(usize, f64)> {
    within(mesh, center, reach * 2.5)
        .into_iter()
        .map(|cell| {
            let d = distance(mesh, center, cell) / reach;
            (
                cell,
                (1.0 + 12.0 * (-d * d).exp()) * if cell == center { 50.0 } else { 1.0 },
            )
        })
        .collect()
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Lake {
    pub cells: Vec<usize>,
    pub level: f64,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Entry {
    pub cell: usize,
    pub discharge: f64,
    pub catchment: f64,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Network {
    pub tree: Tree,
    pub area: Vec<f64>,
    pub flow: Vec<f64>,
    pub inflow: Vec<f64>,
    pub inflow_catchment: Vec<f64>,
    pub level: Vec<f64>,
    pub sea: Vec<u8>,
    pub base: Vec<f64>,
    pub lake: Vec<i32>,
    pub sink: Vec<u8>,
    pub bowl: Vec<u8>,
}
pub struct Captured<'a> {
    pub ocean: &'a [u8],
    pub lakes: &'a [Lake],
    pub entries: &'a [Entry],
    pub inherited: &'a [f64],
    pub retained_river: &'a [u8],
    pub span: f64,
    pub basin_depth: f64,
}
pub struct Forcing<'a> {
    pub closed_basin: &'a dyn Fn(usize) -> io::Result<bool>,
    pub influence: &'a dyn Fn(&mut [f64]) -> io::Result<()>,
    pub cones: &'a [super::character::Cone],
    /// The actual exposed material response in the direction of travel.
    pub resistance: &'a dyn Fn(usize, usize) -> io::Result<f64>,
    pub runoff_mm: &'a dyn Fn(usize) -> io::Result<f64>,
    pub passage: &'a dyn Fn(usize, f64) -> io::Result<f64>,
}
impl Network {
    pub fn grow(
        mesh: &TriangularLattice,
        base: Vec<f64>,
        captured: Captured<'_>,
        forcing: Forcing<'_>,
    ) -> io::Result<Self> {
        let n = mesh.len();
        let sea = basins::connected_sea(mesh, &base, captured.ocean);
        let mut lake = vec![-1; n];
        for (index, held) in captured.lakes.iter().enumerate() {
            for &cell in &held.cells {
                if sea[cell] == 0 {
                    lake[cell] = index as i32;
                }
            }
        }
        let basins::Sinks { sink, bowl } = basins::captured_sinks(
            mesh,
            &base,
            &sea,
            &lake,
            captured.basin_depth,
            captured.span,
        );
        let mut result = Self {
            tree: Tree {
                receiver: vec![-1; n],
                order: Vec::new(),
                cost: vec![0.0; n],
            },
            area: vec![0.0; n],
            flow: vec![0.0; n],
            inflow: vec![0.0; n],
            inflow_catchment: vec![0.0; n],
            level: vec![0.0; n],
            sea,
            base,
            lake,
            sink,
            bowl,
        };
        for entry in captured.entries {
            result.inflow[entry.cell] = entry.discharge;
            result.inflow_catchment[entry.cell] = entry.catchment;
        }
        let roots = result.roots(mesh, &captured, forcing.closed_basin)?;
        let mut resistance = result
            .sea
            .iter()
            .map(|&sea| if sea != 0 { 0.0 } else { 1.0 })
            .collect::<Vec<_>>();
        (forcing.influence)(&mut resistance)?;
        for cone in forcing.cones {
            repel(mesh, &mut resistance, cone.cell, cone.radius);
        }
        result.tree = drainage_tree(
            mesh,
            &result.base,
            |from, to| {
                Ok((forcing.resistance)(from, to)? * (resistance[from] + resistance[to]) / 2.0)
            },
            &roots,
            &result.level,
            &result.sea,
        )?;
        result.gather(mesh, forcing.runoff_mm, forcing.passage)?;
        for &cell in &result.tree.order {
            let receiver = result.tree.receiver[cell];
            if receiver >= 0 {
                result.level[cell] = result.level[receiver as usize];
            }
        }
        Ok(result)
    }
    fn roots(
        &mut self,
        mesh: &TriangularLattice,
        captured: &Captured<'_>,
        closed: &dyn Fn(usize) -> io::Result<bool>,
    ) -> io::Result<Vec<u8>> {
        let mut guarded = vec![0; mesh.len()];
        for entry in captured.entries {
            for cell in within(mesh, entry.cell, 2.0 * captured.span) {
                guarded[cell] = 1;
            }
        }
        let exits = edge_exits(mesh, captured.inherited, captured.retained_river);
        let mut roots = vec![0; mesh.len()];
        for cell in 0..mesh.len() {
            if self.sink[cell] != 0 && !closed(cell)? {
                self.sink[cell] = 0;
            }
            if self.sea[cell] != 0 || mesh.membership(cell) != Membership::Content {
                continue;
            }
            if let Some(level) = self.root_level(
                mesh,
                cell,
                captured.lakes,
                exits[cell] != 0 && guarded[cell] == 0,
            ) {
                self.level[cell] = level;
                roots[cell] = 1;
            }
        }
        Ok(roots)
    }
    fn root_level(
        &self,
        mesh: &TriangularLattice,
        cell: usize,
        lakes: &[Lake],
        exit: bool,
    ) -> Option<f64> {
        if self.lake[cell] >= 0 {
            return Some(lakes[self.lake[cell] as usize].level);
        }
        if self.sink[cell] != 0 {
            return Some(self.base[cell]);
        }
        if exit {
            return Some(self.base[cell].max(1.0));
        }
        (0..3)
            .any(|edge| {
                mesh.neighbor(cell, edge)
                    .is_some_and(|next| self.sea[next] != 0)
            })
            .then_some(0.0)
    }
    pub fn gather(
        &mut self,
        mesh: &TriangularLattice,
        runoff_mm: &dyn Fn(usize) -> io::Result<f64>,
        pass: &dyn Fn(usize, f64) -> io::Result<f64>,
    ) -> io::Result<()> {
        self.area.fill(0.0);
        self.flow.fill(0.0);
        for &cell in &self.tree.order {
            let content = mesh.content_area(cell);
            self.area[cell] = content + self.inflow_catchment[cell];
            self.flow[cell] = (runoff_mm(cell)? / 1000.0).max(0.0) * content / SECONDS_PER_YEAR
                + self.inflow[cell];
        }
        for &cell in self.tree.order.iter().rev() {
            self.flow[cell] = pass(cell, self.flow[cell])?;
            let next = self.tree.receiver[cell];
            if next < 0 {
                continue;
            }
            self.area[next as usize] += self.area[cell];
            self.flow[next as usize] += self.flow[cell];
        }
        Ok(())
    }
    pub fn basin_mask(&self) -> Vec<u8> {
        (0..self.lake.len())
            .map(|i| u8::from(self.lake[i] >= 0 || self.bowl[i] != 0))
            .collect()
    }
}
fn edge_exits(mesh: &TriangularLattice, inherited: &[f64], retained: &[u8]) -> Vec<u8> {
    (0..mesh.len())
        .map(|cell| {
            u8::from(
                frame_edge(mesh, cell) && (retained[cell] != 0 || descends(mesh, inherited, cell)),
            )
        })
        .collect()
}
fn descends(mesh: &TriangularLattice, inherited: &[f64], cell: usize) -> bool {
    let mut exterior = false;
    for edge in 0..3 {
        let Some(next) = mesh.neighbor(cell, edge) else {
            continue;
        };
        if mesh.membership(next) == Membership::Content {
            continue;
        }
        exterior = true;
        if inherited[next] <= inherited[cell] {
            return true;
        }
    }
    !exterior && mesh.boundary(cell)
}
pub fn repel(mesh: &TriangularLattice, cost: &mut [f64], center: usize, reach: f64) {
    for cell in within(mesh, center, reach * 2.5) {
        let d = distance(mesh, center, cell) / reach;
        cost[cell] *= (1.0 + 12.0 * (-d * d).exp()) * if cell == center { 50.0 } else { 1.0 };
    }
}
pub fn scale_around(
    mesh: &TriangularLattice,
    cost: &mut [f64],
    center: usize,
    reach: f64,
    by: f64,
) {
    for cell in within(mesh, center, reach) {
        cost[cell] *= by;
    }
}
