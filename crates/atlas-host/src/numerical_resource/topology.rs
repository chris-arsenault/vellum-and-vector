use super::{Descriptor, ResourceLayout, WorkingSet};
use atlas_generation::{
    field::schema::NumericBand,
    lattice::BLOCK_CELLS,
    reconstruction::{topology::Topology, Layout},
    storage::{Band, Coverage, ReadBand},
};
use std::{io, rc::Rc};

impl WorkingSet {
    pub(super) fn f64(&mut self, resource: &Descriptor, name: &str) -> io::Result<ReadBand<f64>> {
        match self.open(resource, name)? {
            NumericBand::F64(values) => Ok(values),
            _ => Err(io::Error::other(format!("{name} requires float64 samples"))),
        }
    }
    pub(super) fn u8(&mut self, resource: &Descriptor, name: &str) -> io::Result<ReadBand<u8>> {
        match self.open(resource, name)? {
            NumericBand::U8(values) => Ok(values),
            _ => Err(io::Error::other(format!("{name} requires uint8 samples"))),
        }
    }
    fn i8(&mut self, resource: &Descriptor, name: &str) -> io::Result<ReadBand<i8>> {
        match self.open(resource, name)? {
            NumericBand::I8(values) => Ok(values),
            _ => Err(io::Error::other(format!("{name} requires int8 samples"))),
        }
    }
    fn i32(&mut self, resource: &Descriptor, name: &str) -> io::Result<ReadBand<i32>> {
        match self.open(resource, name)? {
            NumericBand::I32(values) => Ok(values),
            _ => Err(io::Error::other(format!("{name} requires int32 samples"))),
        }
    }
    pub(super) fn u32(&mut self, resource: &Descriptor, name: &str) -> io::Result<ReadBand<u32>> {
        let source = self.open(resource, name)?;
        if let NumericBand::U32(values) = source {
            return Ok(values);
        }
        if !matches!(source, NumericBand::I32(_) | NumericBand::U8(_)) {
            return Err(io::Error::other(format!(
                "{name} requires unsigned indices"
            )));
        }
        // Current TS topology stores indices in int32 and levels in uint8. The shared Rust
        // topology uses u32; adapt their representation lazily without rebuilding the tree.
        Ok(Band::from_source(
            source.len(),
            0,
            self.cache.clone(),
            Rc::new(move |block, into| {
                for (offset, into) in into.iter_mut().enumerate() {
                    let cell = block * BLOCK_CELLS + offset;
                    *into = match &source {
                        NumericBand::I32(values) => {
                            u32::try_from(values.get(cell)?).map_err(io::Error::other)?
                        }
                        NumericBand::U8(values) => u32::from(values.get(cell)?),
                        _ => unreachable!("Checked integer input"),
                    };
                }
                Ok(())
            }),
        )
        .read_only())
    }
    pub(super) fn layout(&mut self, resource: &Descriptor, samples: usize) -> io::Result<Layout> {
        match resource.layout {
            ResourceLayout::Regular => {
                let dimensions = resource
                    .sampling
                    .as_ref()
                    .ok_or_else(|| io::Error::other("Regular fields declare their dimensions"))?;
                if dimensions.width < 2
                    || dimensions.height < 2
                    || dimensions.width.checked_mul(dimensions.height) != Some(samples)
                {
                    return Err(io::Error::other(
                        "Regular field dimensions must match its samples",
                    ));
                }
                Ok(Layout::Raster {
                    width: dimensions.width,
                    height: dimensions.height,
                })
            }
            ResourceLayout::Adaptive => Ok(Layout::Adaptive(self.topology(resource, samples)?)),
            ResourceLayout::Mesh => Err(io::Error::other(
                "Captured surfaces require a regular or adaptive sampled field",
            )),
        }
    }
    fn topology(&mut self, resource: &Descriptor, samples: usize) -> io::Result<Topology> {
        let id = resource
            .field
            .as_ref()
            .and_then(|field| field.tree_resource_id.as_ref())
            .ok_or_else(|| io::Error::other("Adaptive fields declare their tree resource"))?;
        let tree = self.describe(id)?;
        if tree.scope.world_id != resource.scope.world_id
            || tree.scope.space_id != resource.scope.space_id
            || tree.crs_id != resource.crs_id
        {
            return Err(io::Error::other(
                "Adaptive topology retains the field's located context",
            ));
        }
        let mut coverage = Coverage::samples(samples, self.cache.clone());
        let topology = Topology {
            vertices: Rc::new(atlas_generation::reconstruction::vertices::Vertices::new(
                samples,
                &mut coverage,
            )?),
            bounds: tree.bounds,
            boxes: self.f64(&tree, "boxes")?,
            children: self.i32(&tree, "children")?,
            levels: self.u32(&tree, "levels")?,
            leaf_index: self.i32(&tree, "leafIndex")?,
            leaves: self.u32(resource, "leaves")?,
            offsets: self.u32(resource, "offsets")?,
            neighbors: self.u32(resource, "neighbors")?,
            face_lengths: self.f64(resource, "faceLengths")?,
            distances: self.f64(resource, "distances")?,
            direction_x: self.f64(resource, "directionX")?,
            direction_y: self.f64(resource, "directionY")?,
            normal_x: self.i8(resource, "normalX")?,
            normal_y: self.i8(resource, "normalY")?,
            coverage: Rc::new(coverage),
        };
        validate(&topology, samples)?;
        Ok(topology)
    }
}
fn validate(t: &Topology, samples: usize) -> io::Result<()> {
    let nodes = t.children.len();
    let faces = t.neighbors.len();
    let nodes_valid = nodes.checked_mul(4) == Some(t.boxes.len())
        && nodes == t.levels.len()
        && nodes == t.leaf_index.len();
    let samples_valid =
        samples == t.leaves.len() && samples.checked_add(1) == Some(t.offsets.len());
    let faces_valid = [
        t.face_lengths.len(),
        t.distances.len(),
        t.direction_x.len(),
        t.direction_y.len(),
        t.normal_x.len(),
        t.normal_y.len(),
    ]
    .into_iter()
    .all(|length| length == faces);
    if !nodes_valid || !samples_valid || !faces_valid {
        return Err(io::Error::other(
            "Adaptive topology bands must match their node, sample and face dimensions",
        ));
    }
    Ok(())
}
