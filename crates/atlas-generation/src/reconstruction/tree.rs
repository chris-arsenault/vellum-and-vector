//! Paged quadtree decisions and exact adjoining-face traversal from adaptiveTree*.ts.
use crate::storage::{Band, BandList, Coverage, ReadBand};
use std::io;

pub(super) struct Tree {
    pub bounds: [f64; 4],
    pub boxes: Band<f64>,
    pub children: Band<i32>,
    pub levels: Band<u32>,
    pub leaves: Band<u32>,
    pub leaf_index: Band<i32>,
}
impl Tree {
    pub fn node(&self, node: usize) -> io::Result<[f64; 4]> {
        let at = node * 4;
        Ok([
            self.boxes.get(at)?,
            self.boxes.get(at + 1)?,
            self.boxes.get(at + 2)?,
            self.boxes.get(at + 3)?,
        ])
    }
    pub fn source_node(&self, bounds: [f64; 4], level: u32) -> io::Result<usize> {
        let x = (bounds[0] + bounds[2]) / 2.0;
        let y = (bounds[1] + bounds[3]) / 2.0;
        let mut node = 0;
        while self.children.get(node)? >= 0 && self.levels.get(node)? < level {
            let b = self.node(node)?;
            node = self.children.get(node)? as usize
                + usize::from(x >= (b[0] + b[2]) / 2.0)
                + 2 * usize::from(y >= (b[1] + b[3]) / 2.0);
        }
        Ok(node)
    }
    pub fn neighbors(
        &self,
        leaf: usize,
        mut visit: impl FnMut(usize, f64, i8, i8) -> io::Result<()>,
    ) -> io::Result<()> {
        for (axis, side) in [(0, -1), (0, 1), (1, -1), (1, 1)] {
            self.face(leaf, axis, side, &mut visit)?;
        }
        Ok(())
    }
    fn face(
        &self,
        leaf: usize,
        axis: usize,
        side: i8,
        visit: &mut impl FnMut(usize, f64, i8, i8) -> io::Result<()>,
    ) -> io::Result<()> {
        let b = self.node(self.leaves.get(leaf)? as usize)?;
        let line = b[axis + if side > 0 { 2 } else { 0 }];
        let (low, high) = (b[1 - axis], b[3 - axis]);
        // Only depth-first traversal state stays resident; numerical arrays are paged bands.
        let mut pending = vec![0];
        while let Some(node) = pending.pop() {
            let b = self.node(node)?;
            let adjoining = adjoins(b[axis], b[axis + 2], line, side);
            if !adjoining || b[1 - axis] >= high || b[3 - axis] <= low {
                continue;
            }
            let child = self.children.get(node)?;
            if child >= 0 {
                for offset in (0..4).rev() {
                    pending.push(child as usize + offset);
                }
                continue;
            }
            if b[axis + if side > 0 { 0 } else { 2 }] != line {
                continue;
            }
            let length = high.min(b[3 - axis]) - low.max(b[1 - axis]);
            visit(
                self.leaf_index.get(node)? as usize,
                length,
                if axis == 0 { side } else { 0 },
                if axis == 1 { side } else { 0 },
            )?;
        }
        Ok(())
    }
}
fn adjoins(low: f64, high: f64, line: f64, side: i8) -> bool {
    if side > 0 {
        low <= line && high > line
    } else {
        low < line && high >= line
    }
}
fn split(b: [f64; 4]) -> io::Result<[[f64; 4]; 4]> {
    let [x0, y0, x1, y1] = b;
    let (x, y) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    if !(x > x0 && x < x1 && y > y0 && y < y1) {
        return Err(io::Error::other(
            "Adaptive cells must remain distinguishable in world coordinates",
        ));
    }
    Ok([
        [x0, y0, x, y],
        [x, y0, x1, y],
        [x0, y, x, y1],
        [x, y, x1, y1],
    ])
}
pub(super) fn build(
    bounds: [f64; 4],
    refine: &mut impl FnMut([f64; 4], u32) -> io::Result<bool>,
    coverage: &mut Coverage,
) -> io::Result<Tree> {
    let mut decisions = BandList::default();
    let leaves = plan(bounds, 0, refine, &mut decisions, coverage)?;
    let nodes = decisions.len();
    // These are the representation limits of the shared signed child/leaf indices.
    i32::try_from(nodes).map_err(io::Error::other)?;
    i32::try_from(leaves).map_err(io::Error::other)?;
    let decisions = decisions.finish(coverage)?;
    let mut tree = Tree {
        bounds,
        boxes: coverage.scratch(nodes * 4, 0.0),
        children: coverage.scratch(nodes, -1),
        levels: coverage.scratch(nodes, 0),
        leaves: coverage.scratch(leaves, 0),
        leaf_index: coverage.scratch(nodes, -1),
    };
    Writer {
        decisions: decisions.read_only(),
        next_node: 1,
        next_decision: 0,
        leaf: 0,
    }
    .write(&mut tree, 0, bounds, 0)?;
    Ok(tree)
}
fn plan(
    bounds: [f64; 4],
    level: u32,
    refine: &mut impl FnMut([f64; 4], u32) -> io::Result<bool>,
    decisions: &mut BandList<u8>,
    coverage: &mut Coverage,
) -> io::Result<usize> {
    let divide = refine(bounds, level)?;
    decisions.push(u8::from(divide), coverage)?;
    if !divide {
        return Ok(1);
    }
    let mut leaves = 0;
    for child in split(bounds)? {
        leaves += plan(child, level + 1, refine, decisions, coverage)?;
    }
    Ok(leaves)
}
struct Writer {
    decisions: ReadBand<u8>,
    next_node: usize,
    next_decision: usize,
    leaf: usize,
}
impl Writer {
    fn write(
        &mut self,
        tree: &mut Tree,
        node: usize,
        bounds: [f64; 4],
        level: u32,
    ) -> io::Result<()> {
        for (i, value) in bounds.into_iter().enumerate() {
            tree.boxes.set(node * 4 + i, value)?;
        }
        tree.levels.set(node, level)?;
        let divide = self.decisions.get(self.next_decision)? != 0;
        self.next_decision += 1;
        if divide {
            let child = self.next_node;
            self.next_node += 4;
            tree.children.set(node, child as i32)?;
            for (i, bounds) in split(bounds)?.into_iter().enumerate() {
                self.write(tree, child + i, bounds, level + 1)?;
            }
        } else {
            tree.leaves.set(self.leaf, node as u32)?;
            tree.leaf_index.set(node, self.leaf as i32)?;
            self.leaf += 1;
        }
        Ok(())
    }
}
pub(super) fn balance(mut tree: Tree, coverage: &mut Coverage) -> io::Result<Tree> {
    loop {
        let mut marked = coverage.scratch(tree.children.len(), 0u8);
        let mut count = 0;
        for leaf in 0..tree.leaves.len() {
            let node = tree.leaves.get(leaf)? as usize;
            let level = tree.levels.get(node)?;
            tree.neighbors(leaf, |target, _, _, _| {
                if marked.get(node)? == 0
                    && tree.levels.get(tree.leaves.get(target)? as usize)? > level + 1
                {
                    marked.set(node, 1)?;
                    count += 1;
                }
                Ok(())
            })?;
        }
        if count == 0 {
            return Ok(tree);
        }
        tree = build(
            tree.bounds,
            &mut |bounds, level| {
                let node = tree.source_node(bounds, level)?;
                Ok(tree.children.get(node)? >= 0
                    || (tree.levels.get(node)? == level && marked.get(node)? != 0))
            },
            coverage,
        )?;
    }
}
