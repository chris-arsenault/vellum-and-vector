#![cfg(target_arch = "wasm32")]
use atlas_generation::{
    publication::upload::RasterPublication,
    storage::{BlockCache, BlockScratch, Coverage},
};
use atlas_host::{
    browser_control::{BrowserControl, GenerationCallbacks},
    native::NativeScratch,
};
use std::io::Cursor;
use tiff::{
    decoder::{Decoder, DecodingResult},
    tags::Tag,
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen(inline_js = "
export function publicationCallbacks() { return { cancelled() { return false; }, progress() {}, yieldControl() { throw Error('Rust must own scheduling'); } }; }
")]
extern "C" {
    #[wasm_bindgen(js_name=publicationCallbacks)]
    fn callbacks() -> GenerationCallbacks;
}
#[wasm_bindgen_test]
async fn worker_publication_writes_a_complete_geotiff() {
    let input = r#"{"assetId":"map/rev/terrain.tif","grid":{"width":2,"height":1,"bounds":[10,20,14,22]},"planes":[{"band":{"id":"height","name":"Height","unit":"metre","display":{"unit":"m","factor":1},"nodata":null,"categories":[],"range":null},"resampling":"mean"}]}"#;
    let scratch = "/tmp/publication.blocks";
    let output = "/tmp/publication.tif";
    let cache = BlockCache::new(
        131072,
        BlockScratch::new(NativeScratch::create_new(scratch).unwrap()),
    );
    let mut publisher = RasterPublication::new(
        serde_json::from_str(input).unwrap(),
        Coverage::samples(0, cache),
    )
    .unwrap();
    publisher.append(&[12.0, 1.0, 34.0, 1.0]).unwrap();
    let mut file = std::fs::File::create(output).unwrap();
    let source = publisher
        .finish(&mut file, &BrowserControl::new(callbacks()))
        .await
        .unwrap();
    file.sync_all().unwrap();
    drop(file);
    assert_eq!(source.asset_id, "map/rev/terrain.tif");
    let bytes = std::fs::read(output).unwrap();
    std::fs::remove_file(output).unwrap();
    let mut decoder = Decoder::new(Cursor::new(bytes)).unwrap();
    assert_eq!(decoder.get_tag_u16_vec(Tag::ExtraSamples).unwrap(), [2]);
    let DecodingResult::F32(values) = decoder.read_chunk(0).unwrap() else {
        panic!("Float map pixels")
    };
    assert_eq!(&values[..2], [12.0, 34.0]);
}
