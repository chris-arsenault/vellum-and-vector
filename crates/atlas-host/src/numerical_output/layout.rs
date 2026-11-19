use super::{
    partitions,
    vectors::{Group, Values, Vector},
    Definition, Resource,
};
use atlas_generation::{
    field::projection::Surface,
    reconstruction::{topology::Topology, Layout},
};
use std::io;

pub fn layout(surface: &Surface, mut definition: Definition) -> io::Result<Resource> {
    let mut vectors = vec![
        Vector::linear("active", surface.active().into(), Group::Cells, 1),
        Vector::linear(
            "measures",
            surface.grid().measures.clone().into(),
            Group::Cells,
            1,
        ),
    ];
    match &surface.grid().layout {
        Layout::Raster { width, height } => {
            for vector in &mut vectors {
                vector.regular(*width, *height);
            }
        }
        Layout::Adaptive(topology) => adaptive(&mut vectors, topology),
    }
    definition.partitions = partitions::create(surface.grid(), &vectors)?;
    definition.descriptor.arrays = vectors.iter().map(|v| v.array.clone()).collect();
    Ok(Resource {
        definition,
        vectors,
    })
}
fn adaptive(vectors: &mut Vec<Vector>, t: &Topology) {
    for (name, band, group) in [
        ("leaves", t.leaves.clone().into(), Group::Cells),
        ("offsets", t.offsets.clone().into(), Group::Cells),
        ("neighbors", t.neighbors.clone().into(), Group::Faces),
        ("faceLengths", t.face_lengths.clone().into(), Group::Faces),
        ("distances", t.distances.clone().into(), Group::Faces),
        ("directionX", t.direction_x.clone().into(), Group::Faces),
        ("directionY", t.direction_y.clone().into(), Group::Faces),
        ("normalX", t.normal_x.clone().into(), Group::Faces),
        ("normalY", t.normal_y.clone().into(), Group::Faces),
    ] {
        vectors.push(Vector::linear(name, band, group, 1));
    }
    let mut bounds = Vector::linear("cellBounds", t.boxes.clone().into(), Group::Cells, 4);
    bounds.array.shape = vec![t.leaves.len() * 4];
    bounds.values = Values::Bounds(Box::new(t.clone()));
    vectors.push(bounds);
}
pub fn tree(
    surface: &Surface,
    topology: &Topology,
    mut definition: Definition,
) -> io::Result<Resource> {
    let mut vectors = vec![Vector::linear(
        "boxes",
        topology.boxes.clone().into(),
        Group::Tree,
        4,
    )];
    for (name, band) in [
        ("children", topology.children.clone().into()),
        ("levels", topology.levels.clone().into()),
        ("leafIndex", topology.leaf_index.clone().into()),
    ] {
        vectors.push(Vector::linear(name, band, Group::Tree, 1));
    }
    definition.descriptor.bounds = topology.bounds;
    definition.partitions = partitions::create(surface.grid(), &vectors)?;
    definition.descriptor.arrays = vectors.iter().map(|v| v.array.clone()).collect();
    Ok(Resource {
        definition,
        vectors,
    })
}
