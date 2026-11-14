//! Ported immutable tiled-input cases from fieldResources.test.ts; no generated worlds.
use atlas_generation::storage::{BlockCache, BlockScratch, RandomAccessFile};
use atlas_host::numerical_input::{open, Array, Snapshot};
use serde_json::json;
use std::{cell::RefCell, io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

struct NoWrites;
impl RandomAccessFile for NoWrites {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        panic!("Immutable inputs reload their source")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        panic!("Immutable inputs never spill")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[derive(Default)]
struct Tiles(RefCell<Vec<Vec<usize>>>);
impl Snapshot for Tiles {
    fn read(&self, at: &[usize]) -> io::Result<Vec<u8>> {
        self.0.borrow_mut().push(at.to_vec());
        Ok((0..64 * 256)
            .flat_map(|i| {
                let row = at[0] * 64 + i / 256;
                let column = at[1] * 256 + i % 256;
                ((row * 517 + column) as u32).to_le_bytes()
            })
            .collect())
    }
}
fn descriptor() -> (Array, serde_json::Value) {
    let array = serde_json::from_value(json!({"name":"height", "dtype":"uint32", "shape":[71,517],
        "chunkShape":[64,256], "unit":"metre", "quantity":"intensive"}))
    .unwrap();
    let metadata = json!({"zarr_format":3,"node_type":"array","data_type":"uint32","shape":[71,517],
        "chunk_grid":{"name":"regular","configuration":{"chunk_shape":[64,256]}},
        "chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},
        "codecs":[{"name":"bytes","configuration":{"endian":"little"}}]});
    (array, metadata)
}
#[test]
fn tiled_inputs_read_touched_chunks_and_keep_edge_rows() {
    let (array, metadata) = descriptor();
    let snapshot = Rc::new(Tiles::default());
    let cache = BlockCache::new(262_144, BlockScratch::new(NoWrites));
    let values = open::<u32>(array, &metadata, snapshot.clone(), cache).unwrap();
    assert!(snapshot.0.borrow().is_empty());
    assert_eq!(values.get(516).unwrap(), 516);
    assert!(snapshot
        .0
        .borrow()
        .iter()
        .all(|coordinates| coordinates[0] == 0));
    assert_eq!(values.get(70 * 517 + 516).unwrap(), (70 * 517 + 516) as u32);
    assert_eq!(values.get(518).unwrap(), 518);
}
#[test]
fn input_metadata_rejects_changed_shape_and_nonbyte_codecs() {
    let (array, mut metadata) = descriptor();
    array.validate(&metadata).unwrap();
    metadata["shape"] = json!([71, 518]);
    assert!(array.validate(&metadata).is_err());
    metadata["shape"] = json!([71, 517]);
    metadata["codecs"] = json!([{"name":"gzip"}]);
    assert!(array.validate(&metadata).is_err());
}
