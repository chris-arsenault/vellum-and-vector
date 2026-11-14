//! Construction of the existing adaptive sampled surface, not a generation lattice.
use super::{topology::Topology, tree};
use crate::storage::{Band, BandList, Coverage, ReadBand, Sample, SharedCache};
use std::{io, rc::Rc};

pub struct Sampling {
    pub maximum_size: f64,
    pub minimum_size: f64,
}
pub fn adaptive(
    bounds: [f64; 4],
    sampling: Sampling,
    mut refine: impl FnMut([f64; 4], u32) -> io::Result<bool>,
    cache: SharedCache,
) -> io::Result<Topology> {
    let mut coverage = Coverage::samples(0, cache);
    if !bounds.iter().all(|n| n.is_finite()) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1] {
        return Err(io::Error::other(
            "Adaptive fields require a finite positive extent",
        ));
    }
    if !sampling.maximum_size.is_finite()
        || sampling.minimum_size <= 0.0
        || !sampling.minimum_size.is_finite()
        || sampling.minimum_size > sampling.maximum_size
    {
        return Err(io::Error::other(
            "Adaptive sampling requires positive physical resolutions",
        ));
    }
    let tree = tree::build(
        bounds,
        &mut |b, level| {
            let size = (b[2] - b[0]).max(b[3] - b[1]);
            Ok(size > sampling.maximum_size || (size > sampling.minimum_size && refine(b, level)?))
        },
        &mut coverage,
    )?;
    faces(tree::balance(tree, &mut coverage)?, coverage)
}
fn retained<T: Sample>(mut band: Band<T>) -> ReadBand<T> {
    band.retain();
    band.read_only()
}
fn faces(tree: tree::Tree, mut owned: Coverage) -> io::Result<Topology> {
    let coverage = &mut owned;
    let mut offsets = coverage.scratch(tree.leaves.len() + 1, 0u32);
    let mut neighbors = BandList::default();
    let mut lengths = BandList::default();
    let mut distances = BandList::default();
    let mut dxs = BandList::default();
    let mut dys = BandList::default();
    let mut nxs = BandList::default();
    let mut nys = BandList::default();
    for leaf in 0..tree.leaves.len() {
        offsets.set(
            leaf,
            u32::try_from(neighbors.len()).map_err(io::Error::other)?,
        )?;
        let from = tree.node(tree.leaves.get(leaf)? as usize)?;
        tree.neighbors(leaf, |to, length, nx, ny| {
            let target = tree.node(tree.leaves.get(to)? as usize)?;
            let dx = (target[0] + target[2] - from[0] - from[2]) / 2.0;
            let dy = (target[1] + target[3] - from[1] - from[3]) / 2.0;
            let distance = dx.hypot(dy);
            neighbors.push(to as u32, coverage)?;
            lengths.push(length, coverage)?;
            distances.push(distance, coverage)?;
            dxs.push(dx / distance, coverage)?;
            dys.push(dy / distance, coverage)?;
            nxs.push(nx, coverage)?;
            nys.push(ny, coverage)
        })?;
    }
    offsets.set(
        tree.leaves.len(),
        u32::try_from(neighbors.len()).map_err(io::Error::other)?,
    )?;
    Ok(Topology {
        vertices: Rc::new(super::vertices::Vertices::new(tree.leaves.len(), coverage)?),
        bounds: tree.bounds,
        boxes: retained(tree.boxes),
        children: retained(tree.children),
        levels: retained(tree.levels),
        leaves: retained(tree.leaves),
        leaf_index: retained(tree.leaf_index),
        offsets: retained(offsets),
        neighbors: retained(neighbors.finish(coverage)?),
        face_lengths: retained(lengths.finish(coverage)?),
        distances: retained(distances.finish(coverage)?),
        direction_x: retained(dxs.finish(coverage)?),
        direction_y: retained(dys.finish(coverage)?),
        normal_x: retained(nxs.finish(coverage)?),
        normal_y: retained(nys.finish(coverage)?),
        coverage: Rc::new(owned),
    })
}
