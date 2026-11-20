//! Town streets can cut the actual parent links of the inherited Greenwood carrier.
use crate::{
    lattice::TriangularLattice,
    magic::state::MagicField,
    spatial::SpatialKernel,
    storage::ReadBand,
    town::{edits::line, geometry::add, network::Street},
};
use atlas_map::{
    spatial::{Predicate, SpatialIndex},
    Geometry,
};
use std::io;

pub(crate) struct RootReach<'a> {
    mesh: &'a TriangularLattice,
    parents: ReadBand<i32>,
    roads: Vec<Geometry>,
    index: Box<dyn SpatialIndex + 'a>,
    spatial: &'a dyn SpatialKernel,
    // hpc-exempt: sparse answers for the rooted cells reached by this town query.
    held: std::collections::BTreeMap<usize, bool>,
}

impl<'a> RootReach<'a> {
    pub(crate) fn bind(
        mesh: &'a TriangularLattice,
        systems: &[MagicField],
        streets: impl Iterator<Item = &'a Street>,
        spatial: &'a dyn SpatialKernel,
    ) -> io::Result<Option<Self>> {
        let Some(parents) = systems
            .iter()
            .find(|field| field.definition().id == super::CRAFTS[3].system)
            .and_then(MagicField::parents)
        else {
            return Ok(None);
        };
        let roads = streets
            .map(|street| line(&street.points))
            .collect::<Vec<_>>();
        if roads.is_empty() {
            return Ok(None);
        }
        let index = spatial.index(&roads).map_err(io::Error::other)?;
        Ok(Some(Self {
            mesh,
            parents,
            roads,
            index,
            spatial,
            held: Default::default(),
        }))
    }

    pub(crate) fn connected(&mut self, cell: usize) -> io::Result<bool> {
        let mut visited = Vec::new();
        let mut here = cell;
        let live = loop {
            if let Some(&alive) = self.held.get(&here) {
                break alive;
            }
            if visited.len() >= self.mesh.len() {
                return Err(io::Error::other("Greenwood root parent cycle"));
            }
            visited.push(here);
            let parent = self.parents.get(here)?;
            if parent < 0 {
                break true;
            }
            let parent = parent as usize;
            if self.cut(here, parent)? {
                break false;
            }
            here = parent;
        };
        self.held.extend(visited.into_iter().map(|key| (key, live)));
        Ok(live)
    }

    fn cut(&self, from: usize, to: usize) -> io::Result<bool> {
        let origin = self.mesh.origin();
        let link = line(&[
            add(origin, self.mesh.position(from)),
            add(origin, self.mesh.position(to)),
        ]);
        let bounds = self.spatial.bounds(&link).map_err(io::Error::other)?;
        for nearby in self.index.query(bounds).map_err(io::Error::other)? {
            if self
                .spatial
                .relation(&link, &self.roads[nearby], Predicate::Intersects)
                .map_err(io::Error::other)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
