//! Native disposable scratch; generation never imports filesystem APIs.
use atlas_generation::storage::RandomAccessFile;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub struct NativeScratch {
    file: Option<File>,
    path: PathBuf,
}
impl NativeScratch {
    pub fn create_new(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref().to_path_buf();
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok(Self {
            file: Some(file),
            path,
        })
    }
    fn file(&mut self) -> io::Result<&mut File> {
        self.file
            .as_mut()
            .ok_or_else(|| io::Error::other("Scratch is closed"))
    }
}
impl RandomAccessFile for NativeScratch {
    fn read(&mut self, into: &mut [u8], offset: u64) -> io::Result<usize> {
        let file = self.file()?;
        file.seek(SeekFrom::Start(offset))?;
        file.read(into)
    }
    fn write(&mut self, bytes: &[u8], offset: u64) -> io::Result<usize> {
        let file = self.file()?;
        file.seek(SeekFrom::Start(offset))?;
        file.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file()?.sync_data()
    }
    fn close(&mut self) -> io::Result<()> {
        self.file.take();
        Ok(())
    }
}
impl Drop for NativeScratch {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}
