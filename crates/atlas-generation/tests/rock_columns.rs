use atlas_generation::{
    rock::{
        cargo::MaterialCargo, cargo_identity::CargoIdentities, catalogue::*, coarsening::*,
        columns::*, material::MaterialLayer,
    },
    storage::*,
};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Explicit columns fit cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Explicit columns fit cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn fixture() -> (Coverage, RockColumns) {
    let mut coverage = Coverage::samples(2, BlockCache::new(1_000_000, BlockScratch::new(File)));
    let columns = RockColumns::new(&mut coverage);
    (coverage, columns)
}
fn layer(kind: usize, depth: f64, age: f64) -> MaterialLayer {
    MaterialLayer {
        formed_min: age,
        formed_max: age,
        mixed: 1.0,
        ..material(kind, depth, 0.0)
    }
}
#[test]
fn coarsening_retains_cap_basement_and_current_contact_ranks() {
    let mut beds = vec![
        layer(9, 10.0, 0.0),
        layer(1, 1.0, 1.0),
        layer(1, 1.0, 2.0),
        layer(1, 1.0, 3.0),
        layer(2, 10.0, 0.0),
        layer(3, 10.0, 0.0),
        layer(9, 100.0, 0.0),
    ];
    let mut observed = Vec::new();
    coarsen_bulk(&mut beds, 4, true, &mut |fold| {
        observed.push((fold.upper, fold.above, fold.result.depth));
        Ok(())
    })
    .unwrap();
    assert_eq!(
        observed,
        vec![(2, 11.0, 2.0), (1, 10.0, 3.0), (1, 10.0, 13.0)]
    );
    assert_eq!((beds[0].kind, beds[3].kind, beds[3].depth), (9, 9, 100.0));
    assert_eq!(
        (beds[1].formed_min, beds[1].formed_max, beds[1].mixed),
        (0.0, 3.0, 1.0)
    );
}
#[test]
fn completed_folds_survive_observer_failure_and_finite_cover_can_fold_its_bottom() {
    let mut beds = vec![
        layer(9, 10.0, 0.0),
        layer(1, 1.0, 0.0),
        layer(1, 1.0, 0.0),
        layer(1, 1.0, 0.0),
        layer(2, 10.0, 0.0),
        layer(3, 10.0, 0.0),
        layer(9, 100.0, 0.0),
    ];
    let mut count = 0;
    assert!(coarsen_bulk(&mut beds, 4, true, &mut |_| {
        count += 1;
        if count == 2 {
            Err(io::Error::other("observer stopped"))
        } else {
            Ok(())
        }
    })
    .is_err());
    assert_eq!((beds.len(), beds[2].depth), (6, 2.0));
    let mut finite = vec![
        layer(9, 0.1, 0.0),
        layer(1, 10.0, 0.0),
        layer(2, 10.0, 0.0),
        layer(3, 1.0, 0.0),
        layer(21, 1.0, 0.0),
    ];
    coarsen_bulk(&mut finite, 4, false, &mut |_| Ok(())).unwrap();
    assert_eq!((finite[0].depth, finite[3].depth), (0.1, 2.0));
}
#[test]
fn repeated_small_arrivals_preserve_large_inherited_contacts() {
    let (_coverage, mut columns) = fixture();
    let kinds = [1, 2, 3, 9];
    for (slot, kind) in kinds.into_iter().enumerate() {
        let mut bed = material(
            kind,
            if slot == 3 {
                30_000.0
            } else {
                (slot + 1) as f64 * 1000.0
            },
            0.0,
        );
        bed.altered = 4.0;
        bed.grain_x = 0.6;
        columns.set_layer(0, Column::Land, slot, &bed).unwrap();
    }
    for at in 0..40 {
        let mut bed = material(11, if at % 2 == 0 { 1.0 } else { 0.5 }, 5.0);
        bed.damage = at as f64 / 100.0;
        columns
            .insert(0, Column::Land, &[bed], 5.0, &mut |_| Ok(()))
            .unwrap();
    }
    let beds: Vec<_> = (0..8)
        .map(|slot| columns.read_layer(0, Column::Land, slot).unwrap())
        .collect();
    for kind in [1, 2, 3] {
        let bed = beds.iter().find(|bed| bed.kind == kind).unwrap();
        assert_eq!((bed.mixed, bed.altered, bed.grain_x), (0.0, 4.0, 0.6));
    }
    assert_eq!((beds[0].kind, beds[0].depth, beds[7].kind), (11, 0.5, 9));
    columns.strip(0, Column::Land, 30.0).unwrap();
    assert_eq!(columns.read_layer(0, Column::Land, 0).unwrap().kind, 1);
}
#[test]
fn finite_cover_exhausts_but_basement_cargo_is_finite_and_snapshots_are_independent() {
    let (mut coverage, mut columns) = fixture();
    let mut bed = material(10, 5.0, 0.0);
    bed.cargo = Some(MaterialCargo::from_entries([(1, 10, 3.0)]));
    columns.set_layer(0, Column::Land, 0, &bed).unwrap();
    columns
        .set_layer(0, Column::Loose, 0, &material(ALLUVIUM, 2.0, 0.0))
        .unwrap();
    let before = columns.snapshot(&mut coverage).unwrap();
    let taken = columns
        .material_through(0, Column::Land, 8.0)
        .unwrap()
        .unwrap();
    assert_eq!(taken.cargo.unwrap().entries().next().unwrap(), (1, 10, 1.5));
    assert_eq!(columns.strip(0, Column::Loose, 7.0).unwrap(), 2.0);
    assert_eq!(columns.strip(0, Column::Land, 8.0).unwrap(), 8.0);
    let left = columns.read_layer(0, Column::Land, 0).unwrap();
    assert_eq!(left.depth, 1.0);
    assert!(left.cargo.is_none());
    assert_eq!(before.depth(0, Column::Land, 0).unwrap(), 5.0);
    assert!(before
        .read_layer(0, Column::Land, 0)
        .unwrap()
        .cargo
        .is_some());
}
#[test]
fn cargo_custody_returns_to_one_ordinary_identity_without_changing_hosts() {
    let mut identities = CargoIdentities::default();
    let held = identities.declare("kept vein", Some("fire")).unwrap();
    let ordinary = identities.declare("fire", None).unwrap();
    assert!(identities.declare("kept vein", Some("salt")).is_err());
    let cargo = MaterialCargo::from_entries([(held, 14, 2.0), (ordinary, 14, 3.0)]);
    let released = identities.release(&cargo).unwrap();
    assert_eq!(
        released.entries().collect::<Vec<_>>(),
        vec![(ordinary, 14, 5.0)]
    );
}
