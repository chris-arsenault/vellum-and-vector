//! Finished-map files are rooted separately from private generation resources.
use atlas_map::MapRef;
use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
// Arconis: docs/architecture/subsystems.arconis#item=gis — published raster and vector map files.
#[derive(Clone)]
pub struct MapFiles {
    directory: PathBuf,
}
impl MapFiles {
    pub fn new(directory: impl AsRef<Path>) -> Self {
        Self {
            directory: directory.as_ref().to_path_buf(),
        }
    }
    pub fn path(&self, location: &str) -> io::Result<PathBuf> {
        let (name, extension) = location
            .split_once('.')
            .ok_or_else(|| io::Error::other("Invalid map asset location"))?;
        if name.is_empty()
            || extension.is_empty()
            || !name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || !extension.bytes().all(|c| c.is_ascii_lowercase())
        {
            return Err(io::Error::other("Invalid map asset location"));
        }
        Ok(self.directory.join(location))
    }
    pub fn open(&self, location: &str) -> io::Result<File> {
        File::open(self.path(location)?)
    }
    pub fn read(&self, location: &str) -> io::Result<Vec<u8>> {
        fs::read(self.path(location)?)
    }
    pub fn ensure_directory(&self) -> io::Result<()> {
        fs::create_dir_all(&self.directory)
    }
}
pub fn asset_path(reference: &MapRef, id: &str) -> String {
    let encode = |s: &str| {
        percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
    };
    format!(
        "/api/maps/{}/{}/assets/{}",
        encode(&reference.map_id),
        encode(&reference.revision),
        encode(id)
    )
}
