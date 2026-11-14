use super::{drainage::*, guidance::*, reaches::ReachStore};
use crate::{
    lattice::{TriangularLattice, WorldLatticeOptions},
    scale::MapScale,
    storage::*,
};
use atlas_map::Bounds;
use std::{io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied lattice fits cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied lattice fits cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn fixture() -> (Rc<TriangularLattice>, Coverage) {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, 1000.0, 1000.0), 16.0, 0.0, |_, _| true)
            .unwrap(),
    );
    let coverage = Coverage::new(
        mesh.clone(),
        BlockCache::new(1000000, BlockScratch::new(File)),
    );
    (mesh, coverage)
}
#[test]
fn entering_boundary_water_cannot_also_seed_an_open_drain() {
    let (mesh, mut coverage) = fixture();
    let mut drainage = Drainage::new(&mut coverage);
    let kind = coverage.allocate(0u8);
    let mut entering = coverage.allocate(0.0);
    let cell = (0..mesh.len()).find(|&cell| mesh.boundary(cell)).unwrap();
    entering.set(cell, 1.0).unwrap();
    drainage
        .condition(
            Conditioning {
                mesh: &mesh,
                water_kind: &kind.read_only(),
                bed: &|_| Ok(0.0),
                incoming: Some(&entering.read_only()),
                open_boundary: true,
                seed: 14,
                neighborhood_radius: 100.0,
                response: &|_, _| Ok(0.0),
            },
            &mut coverage,
        )
        .unwrap();
    let view = drainage.read_only();
    assert!(view.parents.get(cell).unwrap() >= 0);
    assert!(view.ranks.get(cell).unwrap() > 0);
    let outlets = (0..mesh.len())
        .filter(|&cell| view.parents.get(cell).unwrap() < 0)
        .count();
    assert!(outlets > 0);
    assert_eq!(view.elevations.get(cell).unwrap(), 0.0);
}
#[test]
fn flat_guidance_uses_parent_corridors_and_preserves_an_existing_descending_course() {
    let (mesh, mut coverage) = fixture();
    let mut drainage = Drainage::new(&mut coverage);
    let kind = coverage.allocate(0u8);
    let elevation = coverage.allocate(100.0);
    let erosion = coverage.allocate(0.0);
    drainage
        .condition(
            Conditioning {
                mesh: &mesh,
                water_kind: &kind.read_only(),
                bed: &|_| Ok(100.0),
                incoming: None,
                open_boundary: true,
                seed: 14,
                neighborhood_radius: 100.0,
                response: &|_, _| Ok(0.0),
            },
            &mut coverage,
        )
        .unwrap();
    let view = drainage.read_only();
    let source = (0..mesh.len())
        .find(|&cell| view.parents.get(cell).unwrap() >= 0)
        .unwrap();
    let next = view.parents.get(source).unwrap() as usize;
    let mut rivers = ReachStore::default();
    rivers.add(vec![source, next]);
    let scale = MapScale::new(1000.0, 1000.0, mesh.cell_span()).unwrap();
    let settings = GuidanceSettings {
        lookahead_distance: 500.0,
        outlet_alignment_weight: 1.0,
        inherited_valley_weight: 1.0,
        floor_gradient_weight: 1.0,
        conditioned_gradient_weight: 1.0,
        capture_weight: 1.0,
    };
    let targets = drainage
        .resolve_targets(
            GuidanceInputs {
                mesh: &mesh,
                scale: &scale,
                water_kind: &kind.read_only(),
                elevation: &elevation.read_only(),
                fluvial_erosion: &erosion.read_only(),
                glacial_erosion: &erosion.read_only(),
                open_boundary: true,
                seed: 14,
                epoch_stable_seed: 14,
                response: &|_, _| Ok(0.0),
                settings: &settings,
            },
            &rivers,
            &mut coverage,
        )
        .unwrap();
    assert_eq!(targets.get(source).unwrap(), next as i32);
    assert!(crate::flow_graph::target_order(&mut coverage, &targets.read_only()).is_ok());
    assert!(drainage.decision_total >= mesh.len() as u64);
}
