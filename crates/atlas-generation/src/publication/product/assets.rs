use crate::storage::Coverage;
use atlas_map::PublishedAsset;
use std::io::{self, Seek, Write};
/// Platform file access only; encoding and publication ordering stay in the shared Rust producer.
pub trait Assets {
    type Writer: Write + Seek;
    fn identity(&mut self) -> io::Result<String>;
    fn scratch(&mut self) -> io::Result<Coverage>;
    fn create(&mut self, id: &str, media_type: &str) -> io::Result<Self::Writer>;
    fn close(
        &mut self,
        id: &str,
        media_type: &str,
        illustration: bool,
        writer: Self::Writer,
    ) -> io::Result<PublishedAsset>;
}
