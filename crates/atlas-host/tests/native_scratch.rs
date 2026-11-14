#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::{
    lattice::BLOCK_CELLS,
    storage::{Band, BlockCache, BlockScratch},
};
use atlas_host::native::NativeScratch;

#[test]
fn native_spill_uses_an_owned_disposable_file_and_refuses_existing_paths() {
    let path = std::env::temp_dir().join(format!(
        "atlas-scratch-{}-{}.blocks",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let file = NativeScratch::create_new(&path).unwrap();
    assert!(NativeScratch::create_new(&path).is_err());
    let cache = BlockCache::new(BLOCK_CELLS * 8, BlockScratch::new(file));
    let mut band = Band::new(BLOCK_CELLS * 2, 0.0, cache.clone());
    band.set(0, 7.0).unwrap();
    band.set(BLOCK_CELLS, 9.0).unwrap();
    assert_eq!(band.get(0).unwrap(), 7.0);
    drop(band);
    drop(cache);
    assert!(!path.exists());
}
