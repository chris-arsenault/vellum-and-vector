use super::{network::*, reaches::*};
use crate::transport::TransportShares;
use crate::{
    lattice::{TriangularLattice, WorldLatticeOptions},
    storage::*,
};
use atlas_map::Bounds;
use std::{io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Small supplied bands fit cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Small supplied bands fit cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(super) fn fixture() -> (Rc<TriangularLattice>, Coverage, [usize; 3]) {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, 100.0, 100.0), 16.0, 0.0, |_, _| true)
            .unwrap(),
    );
    let b = (0..mesh.len())
        .find(|&cell| (0..3).all(|edge| mesh.neighbor(cell, edge).is_some()))
        .unwrap();
    let a = mesh.neighbor(b, 0).unwrap();
    let c = mesh.neighbor(b, 1).unwrap();
    let coverage = Coverage::new(
        mesh.clone(),
        BlockCache::new(1_000_000, BlockScratch::new(File)),
    );
    (mesh, coverage, [a, b, c])
}
#[test]
fn point_readers_share_the_index_until_owned_records_change() {
    let mut store = ReachStore::default();
    let first = store.add(vec![0, 1]);
    let second = store.add(vec![1, 2]);
    store.get_mut(second).unwrap().order = 2;
    let initial = store.cell_index();
    assert!(Rc::ptr_eq(&initial, &store.cell_index()));
    assert_eq!(initial.get(&store, 1).unwrap().id(), second);
    let captured = store.clone();
    store.get_mut(second).unwrap().dry = true;
    let changed = store.cell_index();
    assert!(!Rc::ptr_eq(&initial, &changed));
    assert_eq!(changed.get(&store, 1).unwrap().id(), first);
    assert_eq!(
        captured.cell_index().get(&captured, 1).unwrap().id(),
        second
    );
}
#[test]
fn retained_profiles_drive_point_reads_and_projection_with_a_terminal_water_mouth() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut kind = coverage.allocate(0u8);
    kind.set(c, 2).unwrap();
    let mut targets = coverage.allocate(-1i32);
    targets.set(b, c as i32).unwrap();
    let flood = coverage.allocate(20.0);
    let mut store = ReachStore::default();
    let id = store.add(vec![a, b]);
    let reach = store.get_mut(id).unwrap();
    reach.drawn = true;
    reach.order = 2;
    reach.monthly[..12].fill(30.0);
    reach.monthly[12..18].fill(10.0);
    reach.bed = vec![100.0, 90.0];
    let terrain = RiverTerrain {
        mesh: &mesh,
        water_kind: &kind.read_only(),
        targets: &targets.read_only(),
    };
    let reader = store.reader();
    assert_eq!(reader.successor(b, None, &terrain).unwrap(), Some(c));
    assert_eq!(reader.order_at(a, 0), 2);
    assert_eq!(reader.water_at(b, false, -1.0), 5.0);
    assert_eq!(reader.sample(b, RiverSample::Bed, -1.0), 90.0);
    let mut projection = RiverProjection::new(&mut coverage);
    projection
        .project(&store, &terrain, &flood.read_only())
        .unwrap();
    assert_eq!(projection.months().get(b).unwrap(), 6);
    assert_eq!(projection.small_channels().get(a).unwrap(), 0.0);
    kind.set(b, 2).unwrap();
    projection
        .project_orders(&store, &kind.read_only())
        .unwrap();
    assert_eq!(projection.orders().get(b).unwrap(), 0);
    assert_eq!(reader.order_at(b, 2), 0);
}
#[test]
fn routes_keep_only_connected_descending_or_ranked_flat_beds() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let kind = coverage.allocate(0u8);
    let mut targets = coverage.allocate(-1i32);
    let mut drainage = coverage.allocate(100.0);
    let mut ranks = coverage.allocate(0i32);
    drainage.set(a, 110.0).unwrap();
    ranks.set(b, 2).unwrap();
    ranks.set(c, 1).unwrap();
    let mut store = ReachStore::default();
    store.add(vec![a, b, c]);
    let terrain = RiverTerrain {
        mesh: &mesh,
        water_kind: &kind.read_only(),
        targets: &targets.read_only(),
    };
    retain_routes(
        &store,
        &terrain,
        &drainage.read_only(),
        &ranks.read_only(),
        &mut targets,
    )
    .unwrap();
    assert_eq!(
        (targets.get(a).unwrap(), targets.get(b).unwrap()),
        (b as i32, c as i32)
    );
    drainage.set(c, 120.0).unwrap();
    targets.set(b, -1).unwrap();
    retain_routes(
        &store,
        &terrain,
        &drainage.read_only(),
        &ranks.read_only(),
        &mut targets,
    )
    .unwrap();
    assert_eq!(targets.get(b).unwrap(), -1);
}
#[test]
fn ground_transport_moves_profiles_and_history_without_reconstructing_rivers_from_rasters() {
    let (_mesh, mut coverage, [a, b, c]) = fixture();
    let count = coverage.len();
    let mut store = ReachStore::default();
    let id = store.add(vec![a, b, c]);
    let reach = store.get_mut(id).unwrap();
    reach.bed = vec![100.0, 90.0, 80.0];
    reach.monthly[..12].fill(30.0);
    reach.monthly[12..24].fill(20.0);
    reach.monthly[24..].fill(10.0);
    reach.river = Some("retained".into());
    reach.former.push(FormerCourse {
        cells: vec![a, b],
        left_in: 3.0,
    });
    store.entries.push(BoundaryEntry {
        cell: a,
        monthly: [5.0; 12],
        catchment: 200.0,
    });
    let mut offsets = coverage.scratch(count + 1, 0u32);
    let mut targets = coverage.scratch(count, -1i32);
    let weights = coverage.scratch(count, 1_000_000.0);
    let dominant = coverage.scratch(count, -1i32);
    let inflow = coverage.scratch(count, 0.0);
    for cell in 0..=count {
        offsets.set(cell, cell as u32).unwrap();
    }
    targets.set(a, b as i32).unwrap();
    targets.set(b, b as i32).unwrap();
    targets.set(c, c as i32).unwrap();
    store
        .carry_ground(
            &TransportShares {
                offsets: offsets.read_only(),
                targets: targets.read_only(),
                weights: weights.read_only(),
                dominant: dominant.read_only(),
                inflow: inflow.read_only(),
            },
            count,
        )
        .unwrap();
    let reach = store.get(id).unwrap();
    assert_eq!(reach.cells(), &[b, c]);
    assert_eq!(reach.bed(), &[100.0, 80.0]);
    assert_eq!(reach.monthly()[12], 10.0);
    assert_eq!(reach.river(), Some("retained"));
    assert_eq!(reach.former()[0].cells, vec![b]);
    assert_eq!(store.entries()[0].cell, b);
}
#[test]
fn splitting_a_changed_course_before_profile_refresh_preserves_the_named_lower_identity() {
    let mut store = ReachStore::default();
    let id = store.add(vec![0]);
    let reach = store.get_mut(id).unwrap();
    reach.cells = vec![0, 1, 2, 3];
    reach.river = Some("named".into());
    reach.monthly.fill(20.0);
    let upper = store.split_at(id, 3).unwrap();
    assert_eq!(store.get(id).unwrap().cells(), &[3]);
    assert_eq!(store.get(id).unwrap().river(), Some("named"));
    assert_eq!(store.get(upper).unwrap().downstream(), Some(id));
    assert_eq!(store.get(upper).unwrap().months_at(2), 0);
}
#[test]
fn captures_real_junctions_and_restores_detached_named_dry_history() {
    let (mesh, _, [a, b, c]) = fixture();
    let mut store = ReachStore::default();
    let upper = store.add(vec![a]);
    let lower = store.add(vec![b]);
    let reach = store.get_mut(upper).unwrap();
    reach.downstream = Some(lower);
    reach.river = Some("named-dry".into());
    reach.dry = true;
    reach.former.push(FormerCourse {
        cells: vec![b, c],
        left_in: 8.0,
    });
    reach.monthly.fill(20.0);
    let saved = store.capture(&mesh);
    assert_eq!(
        (
            saved.reaches[0].course.len(),
            saved.reaches[0].monthly.len()
        ),
        (1, 12)
    );
    assert_eq!(saved.reaches[0].junction, Some(saved.reaches[1].course[0]));
    let directed = saved.reaches[0].directed().unwrap();
    assert_eq!(directed.monthly, [20.0; 24]);
    let mut reopened = ReachStore::default();
    reopened.restore(&saved, &mesh).unwrap();
    let reach = reopened.get_mut(upper).unwrap();
    assert_eq!(reach.cells, [a]);
    assert_eq!(reach.river.as_deref(), Some("named-dry"));
    assert!(reach.dry);
    assert_eq!(reach.former[0].cells, [b, c]);
    reach.monthly[0] = 99.0;
    assert_eq!(saved.reaches[0].monthly[0], 20.0);
    store.get_mut(lower).unwrap().cells = vec![c];
    assert_eq!(store.capture(&mesh).reaches[0].junction, None);
}
