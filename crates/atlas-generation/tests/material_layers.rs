use atlas_generation::{
    rock::{cargo::MaterialCargo, layer_bands::*, material::*, MaterialFacts},
    storage::*,
};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn weighted_material_keeps_signed_bedding_and_distinct_formation_history() {
    let mut a = MaterialLayer::new(1, 120.0, 0.2, false, 2.0);
    a.damage = 0.1;
    a.grain_x = -1.0;
    a.grain_y = 0.5;
    a.bed_slope_x = -2.0;
    a.bed_slope_y = 1.0;
    a.consolidation = 0.4;
    a.formed_max = 3.0;
    a.deposited = 5.0;
    a.altered = 6.0;
    let mut b = MaterialLayer::new(2, 15.0, 0.8, false, 1.0);
    b.damage = 0.5;
    b.grain_x = 1.0;
    b.grain_y = -0.5;
    b.bed_slope_x = 2.0;
    b.bed_slope_y = -1.0;
    b.formed_max = 4.0;
    b.deposited = 3.0;
    b.altered = 9.0;
    let result = blend_layers(&a, &b, 1.0, 3.0);
    assert_eq!(
        (result.kind, result.secondary_kind, result.secondary_share),
        (2, 1, 0.25)
    );
    assert_eq!(
        (
            result.depth,
            result.grain_x,
            result.grain_y,
            result.bed_slope_x,
            result.bed_slope_y
        ),
        (4.0, 0.5, -0.25, 1.0, -0.5)
    );
    assert_eq!(
        (
            result.formed_min,
            result.formed_max,
            result.deposited,
            result.altered
        ),
        (1.0, 4.0, 5.0, 9.0)
    );
    assert!((result.strength - 0.65).abs() < 1e-12);
    assert!((result.consolidation - 0.85).abs() < 1e-12);
    assert_eq!(result.interaction().bed_slope, [1.0, -0.5]);
}
#[test]
fn all_donors_contribute_before_constituent_reduction_and_scratch_resets() {
    let mut mixture = MaterialMixture::new(5);
    for kind in 1..4 {
        let mut donor = MaterialLayer::new(
            kind,
            10.0,
            1000.0 + 100.0 * (kind - 1) as f64,
            false,
            kind as f64,
        );
        donor.secondary_kind = 4;
        donor.secondary_share = 0.4;
        mixture.add(&donor, 1.0).unwrap();
    }
    let first = mixture.material(27.0).unwrap();
    assert_eq!((first.kind, first.secondary_kind), (4, 1));
    assert!((first.secondary_share - 1.0 / 3.0).abs() < 1e-12);
    assert_eq!(
        (
            first.strength,
            first.depth,
            first.formed_min,
            first.formed_max
        ),
        (1100.0, 27.0, 1.0, 3.0)
    );
    mixture.reset();
    assert!(mixture.material(0.0).is_none());
    let donor = MaterialLayer::new(2, 7.0, 2000.0, false, 5.0);
    mixture.add(&donor, 0.75).unwrap();
    assert_eq!((mixture.material(3.0).unwrap().kind, first.kind), (2, 4));
}
#[test]
fn coarsened_material_cargo_and_finite_basement_remain_attached_to_the_parcel() {
    let mut a = MaterialLayer::new(1, 1.0, 1000.0, false, 0.0);
    a.cargo = Some(MaterialCargo::from_entries([(1, 1, 12.0)]));
    let mut b = MaterialLayer::new(2, 2.0, 2000.0, false, 0.0);
    b.cargo = Some(MaterialCargo::from_entries([(2, 2, 6.0)]));
    let c = MaterialLayer::new(3, 3.0, 3000.0, false, 0.0);
    let ab = blend_layers(&a, &b, a.depth, b.depth);
    let mixed = blend_layers(&ab, &c, ab.depth, c.depth);
    assert_eq!(
        mixed.cargo.unwrap(),
        MaterialCargo::from_entries([(1, 0, 2.0), (2, 2, 2.0)])
    );
    let mut basement = MaterialLayer::new(2, 11.0, 2000.0, false, 0.0);
    basement.cargo = Some(MaterialCargo::from_entries([(4, 2, 8.0)]));
    assert_eq!(
        basement.finite_slice(20.0, true, 0.0).cargo.unwrap(),
        MaterialCargo::from_entries([(4, 2, 4.0)])
    );
    assert!(basement.finite_slice(5.0, true, 15.0).cargo.is_none());
}

struct SuppliedFile;
impl RandomAccessFile for SuppliedFile {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied layer columns fit in cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied layer columns fit in cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[test]
fn owner_bands_publish_live_read_views_and_independent_snapshots() {
    let cache = BlockCache::new(1 << 20, BlockScratch::new(SuppliedFile));
    let mut coverage = Coverage::samples(2, cache);
    let mut bands = LayerBands::new(&mut coverage);
    let view = bands.read_only();
    let facts = MaterialFacts {
        resistance: 1000.0,
        jointing: 0.0,
        bedding: 0.0,
        solubility: 0.0,
        porosity: 0.0,
        gives: [None; 4],
    };
    let catalogue = [facts];
    let original = MaterialLayer::new(0, 10.0, 1000.0, false, 2.0);
    bands.write(1, &original).unwrap();
    let captured = bands.snapshot(&mut coverage).unwrap();
    let mut changed = original.clone();
    changed.bed_slope_x = -2.0;
    changed.damage = 0.5;
    changed.strength = 0.0;
    bands.write(1, &changed).unwrap();
    let current = view.read(1, &catalogue).unwrap();
    assert_eq!(
        (current.bed_slope_x, current.damage, current.strength),
        (-2.0, 0.5, 1000.0)
    );
    assert_eq!(captured.read_only().read(1, &catalogue).unwrap(), original);
    drop(bands);
    assert_eq!(view.scalar(MaterialScalar::Depth).get(1).unwrap(), 10.0);
    drop(coverage);
    assert!(view.scalar(MaterialScalar::Depth).get(1).is_err());
}
