//! A captured household density describes all the ground of a storage cell.
use crate::{
    field::Field,
    human::identity::{self, IdentityColumn, Tradition},
    lattice::{hexes::triangle_polygon, TriangularLattice},
    reconstruction::{grid_build::cell_bounds, Grid},
    spatial::SpatialKernel,
};
use atlas_map::{regions::rectangle, Bounds};
use std::io;

pub(super) struct Footprints(Vec<Vec<(usize, f64)>>);

impl Footprints {
    pub fn new(
        mesh: &TriangularLattice,
        grid: &Grid,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Self> {
        let triangles: Vec<_> = (0..mesh.len()).map(|i| triangle_polygon(mesh, i)).collect();
        let index = spatial.index(&triangles).map_err(io::Error::other)?;
        let Bounds(w, _, e, _) = mesh.bounds();
        let centre = mesh.origin()[0] + (w + e) * 0.5;
        let mut cells = Vec::with_capacity(grid.measures.len());
        for i in 0..grid.measures.len() {
            let [w, s, e, n] = cell_bounds(grid, i)?;
            let shift = grid.periodic_width.map_or(0., |period| {
                ((centre - (w + e) * 0.5) / period).round() * period
            });
            let bounds = Bounds(w + shift, s, e + shift, n);
            let ids = index.query(bounds).map_err(io::Error::other)?;
            let pieces: Vec<_> = ids.iter().map(|&c| triangles[c].clone()).collect();
            let areas = spatial
                .intersection_areas(&rectangle(bounds), &pieces)
                .map_err(io::Error::other)?;
            let total: f64 = areas.iter().sum();
            cells.push(
                ids.into_iter()
                    .zip(areas)
                    .filter(|&(_, a)| a > 0.)
                    .map(|(c, a)| (c, a / total))
                    .collect(),
            );
        }
        Ok(Self(cells))
    }

    pub fn mean(&self, sample: usize, read: &impl Fn(usize) -> io::Result<f64>) -> io::Result<f64> {
        self.0[sample]
            .iter()
            .try_fold(0., |sum, &(i, share)| Ok(sum + read(i)? * share))
    }

    pub fn identities(&self, field: &Field) -> io::Result<Vec<IdentityColumn>> {
        self.0
            .iter()
            .map(|support| {
                let mut column = Vec::new();
                for &(cell, weight) in support {
                    let mut incoming = field.people().column(cell)?;
                    for group in &mut incoming {
                        group.people *= weight;
                    }
                    identity::accumulate(&mut column, &incoming);
                }
                identity::settle(&mut column);
                Ok(column)
            })
            .collect()
    }
}

pub(super) fn identity_band(name: &str, columns: &[IdentityColumn]) -> Option<Vec<f64>> {
    let name = name.strip_prefix("Identity")?;
    let (part, slot) = name.split_at(name.find(|c: char| c.is_ascii_digit())?);
    let slot: usize = slot.parse().ok()?;
    let tradition = Tradition::NAMES.iter().position(|&t| t == part);
    if tradition.is_none() && !matches!(part, "People" | "Age" | "Hardness") {
        return None;
    }
    Some(
        columns
            .iter()
            .map(|column| {
                column.get(slot).map_or(0., |group| match part {
                    "People" => group.people,
                    "Age" => group.age,
                    "Hardness" => group.hardness,
                    _ => tradition.map_or(0., |t| group.traditions[t] as f64),
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        field::tests::{seed, MemoryFile},
        human::{catalogue::LayerId, identity::IdentityLayer, HumanField},
        reconstruction::Layout,
        rock::ground::observers::GroundObservers,
        storage::{BlockCache, BlockScratch, Coverage},
    };

    #[test]
    fn a_partly_covered_neighbourhood_contributes_its_households_and_tongue() {
        let cache = BlockCache::new(1_000_000, BlockScratch::new(MemoryFile::default()));
        let grid = Grid {
            bounds: [0., 0., 100., 100.],
            periodic_width: None,
            layout: Layout::Raster {
                width: 2,
                height: 2,
            },
            measures: Coverage::samples(4, cache).allocate(2500.).read_only(),
            donors: Default::default(),
        };
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let empty = seed().finish(Box::<GroundObservers>::default()).unwrap();
        let support = Footprints::new(empty.mesh(), &grid, &spatial).unwrap();
        let mut seed = seed();
        let (cell, _) = *support.0[0]
            .iter()
            .find(|&&(_, w)| w > 0. && w < 0.5)
            .unwrap();
        seed.people
            .initialize(HumanField::Layer(LayerId::Population), cell, 1000.)
            .unwrap();
        let mut residents = IdentityLayer {
            people: 1000.,
            ..Default::default()
        };
        residents.traditions[Tradition::Tongue as usize] = 7;
        seed.people.initialize_column(cell, &[residents]).unwrap();
        let field = seed.finish(Box::<GroundObservers>::default()).unwrap();
        let mean = support.mean(0, &|i| field.people().people(i)).unwrap();
        assert!(mean > 0. && mean < 500.);
        let columns = support.identities(&field).unwrap();
        assert!(identity_band("IdentityPeople0", &columns).unwrap()[0] > 0.);
        assert_eq!(identity_band("IdentityTongue0", &columns).unwrap()[0], 7.);
    }
}
