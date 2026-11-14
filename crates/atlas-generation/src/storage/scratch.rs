use std::{
    cell::RefCell,
    collections::BTreeMap,
    io::{self, Error, ErrorKind},
    rc::Rc,
};

/// Native files or an OPFS synchronous handle supplied by the selected worker host.
pub trait RandomAccessFile {
    fn read(&mut self, into: &mut [u8], offset: u64) -> io::Result<usize>;
    fn write(&mut self, bytes: &[u8], offset: u64) -> io::Result<usize>;
    fn flush(&mut self) -> io::Result<()>;
    fn close(&mut self) -> io::Result<()>;
}

pub struct BlockScratch {
    file: Box<dyn RandomAccessFile>,
    end: u64,
    free: BTreeMap<usize, Vec<u64>>,
    closed: bool,
}
impl Drop for BlockScratch {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
pub(crate) type SharedScratch = Rc<RefCell<BlockScratch>>;
pub(crate) struct SpillSlot {
    pub offset: u64,
    pub length: usize,
    pub scratch: SharedScratch,
}
impl Drop for SpillSlot {
    fn drop(&mut self) {
        self.scratch.borrow_mut().release(self.offset, self.length);
    }
}
impl BlockScratch {
    pub fn new(file: impl RandomAccessFile + 'static) -> Self {
        Self {
            file: Box::new(file),
            end: 0,
            free: BTreeMap::new(),
            closed: false,
        }
    }
    pub fn allocate(&mut self, length: usize) -> io::Result<u64> {
        self.check()?;
        if let Some(offset) = self.free.get_mut(&length).and_then(Vec::pop) {
            return Ok(offset);
        }
        let offset = self.end;
        self.end = self
            .end
            .checked_add(length as u64)
            .ok_or_else(|| Error::other("Scratch address overflow"))?;
        Ok(offset)
    }
    pub fn release(&mut self, offset: u64, length: usize) {
        if !self.closed {
            self.free.entry(length).or_default().push(offset);
        }
    }
    fn check(&self) -> io::Result<()> {
        if self.closed {
            Err(Error::other("Scratch is closed"))
        } else {
            Ok(())
        }
    }
    pub fn read(&mut self, offset: u64, into: &mut [u8]) -> io::Result<()> {
        self.check()?;
        let mut done = 0;
        while done < into.len() {
            let read = self.file.read(&mut into[done..], offset + done as u64)?;
            if read == 0 || read > into.len() - done {
                return Err(Error::new(
                    ErrorKind::UnexpectedEof,
                    "Scratch read did not advance",
                ));
            }
            done += read;
        }
        Ok(())
    }
    pub fn write(&mut self, offset: u64, bytes: &[u8]) -> io::Result<()> {
        self.check()?;
        let mut done = 0;
        while done < bytes.len() {
            let written = self.file.write(&bytes[done..], offset + done as u64)?;
            if written == 0 || written > bytes.len() - done {
                return Err(Error::new(
                    ErrorKind::WriteZero,
                    "Scratch write did not advance",
                ));
            }
            done += written;
        }
        Ok(())
    }
    pub fn flush(&mut self) -> io::Result<()> {
        self.check()?;
        self.file.flush()
    }
    pub fn close(&mut self) -> io::Result<()> {
        if !self.closed {
            self.file.close()?;
            self.closed = true;
        }
        Ok(())
    }
}
