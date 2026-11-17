use atlas_generation::{
    publication::product::Assets,
    storage::{Coverage, SharedCache},
};
use atlas_gis::map_files::MapFiles;
use atlas_map::PublishedAsset;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Seek, SeekFrom, Write},
    path::PathBuf,
};
use uuid::Uuid;

pub struct NativeMapAssets {
    pub files: MapFiles,
    cache: SharedCache,
}
impl NativeMapAssets {
    pub fn new(files: MapFiles, cache: SharedCache) -> Self {
        Self { files, cache }
    }
}
pub struct MapAssetWriter {
    file: BufWriter<File>,
    path: PathBuf,
    location: String,
    published: bool,
}
impl Write for MapAssetWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.file.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()?;
        self.file.get_ref().sync_all()
    }
}
impl Seek for MapAssetWriter {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.file.seek(from)
    }
}
impl Drop for MapAssetWriter {
    fn drop(&mut self) {
        if !self.published {
            let _ = fs::remove_file(&self.path);
        }
    }
}
impl Assets for NativeMapAssets {
    type Writer = MapAssetWriter;
    fn identity(&mut self) -> io::Result<String> {
        Ok(Uuid::new_v4().to_string())
    }
    fn scratch(&mut self) -> io::Result<Coverage> {
        Ok(Coverage::samples(0, self.cache.clone()))
    }
    fn create(&mut self, _id: &str, media_type: &str) -> io::Result<MapAssetWriter> {
        self.files.ensure_directory()?;
        let extension = match media_type {
            "image/tiff" => "tif",
            "application/geo+json" => "json",
            _ => return Err(io::Error::other("Unknown map asset media type")),
        };
        let location = format!("{}.{extension}", Uuid::new_v4());
        let path = self.files.path(&location)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok(MapAssetWriter {
            file: BufWriter::new(file),
            path,
            location,
            published: false,
        })
    }
    fn close(
        &mut self,
        id: &str,
        media_type: &str,
        illustration: bool,
        mut writer: MapAssetWriter,
    ) -> io::Result<PublishedAsset> {
        writer.flush()?;
        let byte_length = writer.file.get_ref().metadata()?.len();
        writer.published = true;
        Ok(PublishedAsset {
            id: id.into(),
            media_type: media_type.into(),
            location: writer.location.clone(),
            byte_length,
            illustration,
        })
    }
}
