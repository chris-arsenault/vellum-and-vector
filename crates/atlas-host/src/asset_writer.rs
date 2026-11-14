//! Sequential/seekable encoding over a host's positional file, with an explicit close boundary.
use atlas_generation::storage::RandomAccessFile;
use std::io::{self, Seek, SeekFrom, Write};
pub struct AssetWriter<F: RandomAccessFile> {
    file: F,
    position: u64,
    length: u64,
    closed: bool,
}
impl<F: RandomAccessFile> AssetWriter<F> {
    /// The host supplies a newly created empty output file, separate from disposable scratch.
    pub fn new(file: F) -> Self {
        Self {
            file,
            position: 0,
            length: 0,
            closed: false,
        }
    }
    pub fn finish(&mut self) -> io::Result<()> {
        if self.closed {
            return Ok(());
        }
        let flushed = self.file.flush();
        let closed = self.file.close();
        self.closed = true;
        flushed.and(closed)
    }
}
impl<F: RandomAccessFile> Write for AssetWriter<F> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.closed {
            return Err(io::Error::other("Map asset is closed"));
        }
        let written = self.file.write(bytes, self.position)?;
        if written > bytes.len() {
            return Err(io::Error::other("Host wrote beyond supplied buffer"));
        }
        self.position = self
            .position
            .checked_add(written as u64)
            .ok_or_else(|| io::Error::other("Map asset exceeds file address space"))?;
        self.length = self.length.max(self.position);
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}
impl<F: RandomAccessFile> Seek for AssetWriter<F> {
    fn seek(&mut self, seek: SeekFrom) -> io::Result<u64> {
        let next = match seek {
            SeekFrom::Start(at) => Some(at),
            SeekFrom::Current(by) => self.position.checked_add_signed(by),
            SeekFrom::End(by) => self.length.checked_add_signed(by),
        }
        .ok_or_else(|| io::Error::other("Invalid map asset seek"))?;
        self.position = next;
        Ok(next)
    }
}
impl<F: RandomAccessFile> Drop for AssetWriter<F> {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.file.close();
        }
    }
}
