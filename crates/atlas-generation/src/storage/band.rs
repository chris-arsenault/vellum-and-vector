use super::{
    cache::{Evict, Pin},
    scratch::{SharedScratch, SpillSlot},
    Sample, SharedCache,
};
use crate::lattice::BLOCK_CELLS;
use std::{
    cell::{Cell, Ref, RefCell, RefMut},
    io,
    ops::{Deref, DerefMut},
    rc::Rc,
};

pub type BlockSource<T> = dyn Fn(usize, &mut [T]) -> io::Result<()>;

/// A pinned read slice has no writable alias, including through a bulk view.
/// ```compile_fail
/// use atlas_generation::storage::ReadBlock;
/// fn bypass(mut block:ReadBlock<'_,f64>) {block[0]=3.0;}
/// ```
pub struct ReadBlock<'a, T: Sample> {
    values: BlockRead<'a, T>,
    _pin: Option<Pin>,
}
enum BlockRead<'a, T: Sample> {
    Borrowed(Ref<'a, [T]>),
    Copied(Vec<T>),
}
impl<T: Sample> Deref for ReadBlock<'_, T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        match &self.values {
            BlockRead::Borrowed(values) => values,
            BlockRead::Copied(values) => values,
        }
    }
}
pub struct WriteBlock<'a, T: Sample> {
    values: RefMut<'a, [T]>,
    _pin: Pin,
}
impl<T: Sample> Deref for WriteBlock<'_, T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        &self.values
    }
}
impl<T: Sample> DerefMut for WriteBlock<'_, T> {
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.values
    }
}
struct BlockData<T: Sample> {
    values: Option<Rc<Vec<T>>>,
    dirty: bool,
    spill: Option<Rc<SpillSlot>>,
}
struct Block<T: Sample> {
    data: RefCell<BlockData<T>>,
    source: Option<Rc<BlockSource<T>>>,
    index: usize,
    length: usize,
    initial: T,
}
impl<T: Sample> Block<T> {
    fn load(&self) -> io::Result<bool> {
        if self.data.borrow().values.is_some() {
            return Ok(false);
        }
        let mut data = self.data.borrow_mut();
        let mut values = vec![self.initial; self.length];
        if let Some(slot) = &data.spill {
            slot.scratch
                .borrow_mut()
                .read(slot.offset, bytemuck::cast_slice_mut(&mut values))?;
        } else if let Some(source) = &self.source {
            for (offset, into) in values.chunks_mut(BLOCK_CELLS).enumerate() {
                source(self.index + offset, into)?;
            }
        }
        data.values = Some(Rc::new(values));
        data.dirty = false;
        Ok(true)
    }
}
impl<T: Sample> Evict for Block<T> {
    fn evict(&self, scratch: &SharedScratch) -> io::Result<()> {
        let mut data = self.data.borrow_mut();
        if data.dirty {
            let values = data.values.as_ref().expect("Dirty block is resident");
            let bytes = bytemuck::cast_slice(values.as_slice());
            let offset = scratch.borrow_mut().allocate(bytes.len())?;
            let slot = Rc::new(SpillSlot {
                offset,
                length: bytes.len(),
                scratch: scratch.clone(),
            });
            scratch.borrow_mut().write(offset, bytes)?;
            data.spill = Some(slot);
        }
        data.values = None;
        data.dirty = false;
        Ok(())
    }
}
struct BandState<T: Sample> {
    owner: u64,
    length: usize,
    block_cells: usize,
    blocks: Vec<Rc<Block<T>>>,
    cache: SharedCache,
    released: Cell<bool>,
    retained: Cell<bool>,
}
pub(super) trait Allocation {
    fn released(&self) -> bool;
    fn retained(&self) -> bool;
    fn release(&self);
}
impl<T: Sample> Allocation for BandState<T> {
    fn released(&self) -> bool {
        self.released.get()
    }
    fn retained(&self) -> bool {
        self.retained.get()
    }
    fn release(&self) {
        if self.released.replace(true) {
            return;
        }
        self.cache.borrow_mut().forget(self.owner);
        for block in &self.blocks {
            let mut data = block.data.borrow_mut();
            data.values = None;
            data.spill = None;
            data.dirty = false;
        }
    }
}
impl<T: Sample> BandState<T> {
    fn check(&self) -> io::Result<()> {
        if self.released.get() {
            Err(io::Error::other("Band has been released"))
        } else {
            Ok(())
        }
    }
    fn pin(&self, index: usize) -> io::Result<Pin> {
        self.check()?;
        let block = self
            .blocks
            .get(index)
            .ok_or_else(|| io::Error::other("Band block out of range"))?;
        if block.load()? {
            let erased: Rc<dyn Evict> = block.clone();
            if let Err(error) = self.cache.borrow_mut().admit(
                (self.owner, index),
                Rc::downgrade(&erased),
                block.length * T::BYTES,
            ) {
                block.data.borrow_mut().values = None;
                return Err(error);
            }
        }
        self.cache.borrow_mut().pin((self.owner, index));
        Ok(Pin {
            cache: self.cache.clone(),
            key: (self.owner, index),
        })
    }
    fn get(&self, index: usize) -> io::Result<T> {
        self.check()?;
        if index >= self.length {
            return Err(io::Error::other("Band index out of range"));
        }
        let (physical, offset) = self.address(index);
        let block = &self.blocks[physical];
        if let Some(values) = &block.data.borrow().values {
            return Ok(values[offset]);
        }
        let _pin = self.pin(physical)?;
        let value = block.data.borrow().values.as_ref().expect("Loaded block")[offset];
        Ok(value)
    }
    fn read_values(self: &Rc<Self>, start: usize, length: usize) -> io::Result<ReadValues<'_, T>> {
        self.check()?;
        if self.block_cells != self.length || self.length == 0 {
            return Ok(ReadValues::Paged(ReadBand {
                state: self.clone(),
                start,
                length,
            }));
        }
        let pin = self.pin(0)?;
        let values = Ref::map(self.blocks[0].data.borrow(), |data| {
            &data.values.as_ref().expect("Loaded field")[start..start + length]
        });
        Ok(ReadValues::Resident(ReadBlock {
            values: BlockRead::Borrowed(values),
            _pin: Some(pin),
        }))
    }
    fn address(&self, index: usize) -> (usize, usize) {
        // Native resident fields are contiguous: direct access must not calculate
        // a page number and remainder for every numerical value.
        if self.blocks.len() == 1 {
            (0, index)
        } else {
            (index / self.block_cells, index % self.block_cells)
        }
    }
    fn block_range(&self, block: usize) -> io::Result<(usize, std::ops::Range<usize>)> {
        let start = block
            .checked_mul(BLOCK_CELLS)
            .filter(|&start| start < self.length)
            .ok_or_else(|| io::Error::other("Band block out of range"))?;
        let physical = start / self.block_cells;
        let offset = start % self.block_cells;
        Ok((
            physical,
            offset..offset + BLOCK_CELLS.min(self.length - start),
        ))
    }
}

pub struct Band<T: Sample> {
    state: Rc<BandState<T>>,
    immutable: bool,
}
/// Live reads without a writer or mutable backing-buffer alias.
/// ```compile_fail
/// use atlas_generation::storage::ReadBand;
/// fn bypass(mut view: ReadBand<f64>) { view.set(0, 10.0); }
/// ```
pub struct ReadBand<T: Sample> {
    state: Rc<BandState<T>>,
    start: usize,
    length: usize,
}
/// A kernel borrows once. Resident reads index the field directly without repeated borrow checks.
pub enum ReadValues<'a, T: Sample> {
    Resident(ReadBlock<'a, T>),
    Paged(ReadBand<T>),
}
/// Owner-only bulk mutation. Native resident fields keep one exclusive borrow per kernel.
pub enum WriteValues<'a, T: Sample> {
    Resident(WriteBlock<'a, T>),
    Paged(&'a mut Band<T>),
}
impl<T: Sample> WriteValues<'_, T> {
    pub fn as_mut_slice(&mut self) -> Option<&mut [T]> {
        match self {
            Self::Resident(values) => Some(values),
            Self::Paged(_) => None,
        }
    }
    pub fn get(&self, index: usize) -> io::Result<T> {
        match self {
            Self::Resident(values) => values
                .get(index)
                .copied()
                .ok_or_else(|| io::Error::other("Band index out of range")),
            Self::Paged(band) => band.get(index),
        }
    }
    pub fn set(&mut self, index: usize, value: T) -> io::Result<()> {
        match self {
            Self::Resident(values) => {
                *values
                    .get_mut(index)
                    .ok_or_else(|| io::Error::other("Band index out of range"))? = value;
                Ok(())
            }
            Self::Paged(band) => band.set(index, value),
        }
    }
}
impl<T: Sample> ReadValues<'_, T> {
    pub fn get(&self, index: usize) -> io::Result<T> {
        match self {
            Self::Resident(values) => values
                .get(index)
                .copied()
                .ok_or_else(|| io::Error::other("Band index out of range")),
            Self::Paged(band) => band.get(index),
        }
    }
    /// A borrowed resident slice can be shared with scoped native workers.
    pub fn as_slice(&self) -> Option<&[T]> {
        match self {
            Self::Resident(values) => Some(values),
            Self::Paged(_) => None,
        }
    }
}
impl<T: Sample> Clone for ReadBand<T> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            start: self.start,
            length: self.length,
        }
    }
}
impl<T: Sample> ReadBand<T> {
    /// Publication groups channels with the same immutable sample ownership.
    pub fn shares_storage(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.state, &other.state)
            && self.start == other.start
            && self.length == other.length
    }
    pub fn len(&self) -> usize {
        self.length
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn get(&self, index: usize) -> io::Result<T> {
        if index >= self.length {
            return Err(io::Error::other("Band index out of range"));
        }
        self.state.get(self.start + index)
    }
    /// A live read-only channel within an owner allocation, never a writable alias.
    pub fn slice(&self, range: std::ops::Range<usize>) -> io::Result<Self> {
        if range.start > range.end || range.end > self.length {
            return Err(io::Error::other("Band slice out of range"));
        }
        Ok(Self {
            state: self.state.clone(),
            start: self.start + range.start,
            length: range.len(),
        })
    }
    pub fn block_copy(&self, block: usize) -> io::Result<Vec<T>> {
        Ok(self.read_block(block)?.to_vec())
    }
    pub fn read_block(&self, block: usize) -> io::Result<ReadBlock<'_, T>> {
        self.state.check()?;
        let local = block
            .checked_mul(BLOCK_CELLS)
            .filter(|&v| v < self.length)
            .ok_or_else(|| io::Error::other("Band block out of range"))?;
        let start = self.start + local;
        let length = BLOCK_CELLS.min(self.length - local);
        let (physical, offset) = self.state.address(start);
        if offset + length > self.state.blocks[physical].length {
            let mut values = Vec::with_capacity(length);
            let mut at = start;
            while at < start + length {
                let (page, offset) = self.state.address(at);
                let count = (start + length - at).min(self.state.blocks[page].length - offset);
                let _pin = self.state.pin(page)?;
                let data = self.state.blocks[page].data.borrow();
                values.extend_from_slice(
                    &data.values.as_ref().expect("Loaded block")[offset..offset + count],
                );
                at += count;
            }
            return Ok(ReadBlock {
                values: BlockRead::Copied(values),
                _pin: None,
            });
        }
        let pin = self.state.pin(physical)?;
        let values = Ref::map(self.state.blocks[physical].data.borrow(), |data| {
            &data.values.as_ref().expect("Loaded block")[offset..offset + length]
        });
        Ok(ReadBlock {
            values: BlockRead::Borrowed(values),
            _pin: Some(pin),
        })
    }
    pub fn read_values(&self) -> io::Result<ReadValues<'_, T>> {
        self.state.read_values(self.start, self.length)
    }
    pub fn with_block<R>(&self, block: usize, read: impl FnOnce(&[T]) -> R) -> io::Result<R> {
        Ok(read(&self.read_block(block)?))
    }
}
impl<T: Sample> Band<T> {
    pub fn read_values(&self) -> io::Result<ReadValues<'_, T>> {
        self.state.read_values(0, self.len())
    }
    pub fn new(length: usize, initial: T, cache: SharedCache) -> Self {
        Self::build(length, initial, cache, None, false)
    }
    pub fn from_source(
        length: usize,
        initial: T,
        cache: SharedCache,
        source: Rc<BlockSource<T>>,
    ) -> Self {
        Self::build(length, initial, cache, Some(source), true)
    }
    fn build(
        length: usize,
        initial: T,
        cache: SharedCache,
        source: Option<Rc<BlockSource<T>>>,
        immutable: bool,
    ) -> Self {
        let owner = cache.borrow_mut().owner();
        let block_cells = cache.borrow().allocation_cells::<T>(length);
        let blocks = (0..length.div_ceil(block_cells))
            .map(|index| {
                Rc::new(Block {
                    data: RefCell::new(BlockData {
                        values: None,
                        dirty: false,
                        spill: None,
                    }),
                    source: source.clone(),
                    index: index * block_cells / BLOCK_CELLS,
                    length: block_cells.min(length - index * block_cells),
                    initial,
                })
            })
            .collect();
        Self {
            state: Rc::new(BandState {
                owner,
                length,
                block_cells,
                blocks,
                cache,
                released: Cell::new(false),
                retained: Cell::new(false),
            }),
            immutable,
        }
    }
    pub fn len(&self) -> usize {
        self.state.length
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn read_only(&self) -> ReadBand<T> {
        ReadBand {
            state: self.state.clone(),
            start: 0,
            length: self.len(),
        }
    }
    pub fn get(&self, index: usize) -> io::Result<T> {
        self.state.get(index)
    }
    pub fn set(&mut self, index: usize, value: T) -> io::Result<()> {
        self.state.check()?;
        if self.immutable {
            return Err(io::Error::other(
                "Immutable input needs a separate working output",
            ));
        }
        if index >= self.len() {
            return Err(io::Error::other("Band index out of range"));
        }
        let (physical, offset) = self.state.address(index);
        {
            let mut data = self.state.blocks[physical].data.borrow_mut();
            if let Some(values) = data.values.as_mut() {
                Rc::make_mut(values)[offset] = value;
                data.dirty = true;
                return Ok(());
            }
        }
        self.with_block_mut(index / BLOCK_CELLS, |values| {
            values[index % BLOCK_CELLS] = value
        })
    }
    pub fn with_block_mut<R>(
        &mut self,
        index: usize,
        write: impl FnOnce(&mut [T]) -> R,
    ) -> io::Result<R> {
        Ok(write(&mut self.write_block(index)?))
    }
    pub fn write_values(&mut self) -> io::Result<WriteValues<'_, T>> {
        self.state.check()?;
        if self.immutable {
            return Err(io::Error::other(
                "Immutable input needs a separate working output",
            ));
        }
        if self.state.block_cells != self.len() || self.is_empty() {
            return Ok(WriteValues::Paged(self));
        }
        let pin = self.state.pin(0)?;
        let mut data = self.state.blocks[0].data.borrow_mut();
        data.dirty = true;
        let values = RefMut::map(data, |data| {
            Rc::make_mut(data.values.as_mut().expect("Loaded field")).as_mut_slice()
        });
        Ok(WriteValues::Resident(WriteBlock { values, _pin: pin }))
    }
    pub fn write_block(&mut self, index: usize) -> io::Result<WriteBlock<'_, T>> {
        if self.immutable {
            return Err(io::Error::other(
                "Immutable input needs a separate working output",
            ));
        }
        let (physical, range) = self.state.block_range(index)?;
        let pin = self.state.pin(physical)?;
        let mut data = self.state.blocks[physical].data.borrow_mut();
        data.dirty = true;
        let values = RefMut::map(data, |data| {
            &mut Rc::make_mut(data.values.as_mut().expect("Loaded block"))[range]
        });
        Ok(WriteBlock { values, _pin: pin })
    }
    pub fn retain(&mut self) {
        self.state.retained.set(true);
    }
    pub fn is_retained(&self) -> bool {
        self.state.retained.get()
    }
    pub fn snapshot(&self) -> io::Result<Self> {
        self.state.check()?;
        let mut copy = Self::new(
            self.len(),
            self.state
                .blocks
                .first()
                .map_or(T::default(), |b| b.initial),
            self.state.cache.clone(),
        );
        copy.state.retained.set(self.state.retained.get());
        for (index, block) in self.state.blocks.iter().enumerate() {
            let data = block.data.borrow();
            let cloned = Rc::new(Block {
                data: RefCell::new(BlockData {
                    values: data.values.clone(),
                    dirty: data.dirty,
                    spill: data.spill.clone(),
                }),
                source: block.source.clone(),
                index: block.index,
                length: block.length,
                initial: block.initial,
            });
            drop(data);
            if cloned.data.borrow().values.is_some() {
                let erased: Rc<dyn Evict> = cloned.clone();
                copy.state.cache.borrow_mut().admit(
                    (copy.state.owner, index),
                    Rc::downgrade(&erased),
                    cloned.length * T::BYTES,
                )?;
            }
            Rc::get_mut(&mut copy.state)
                .expect("Snapshot not yet shared")
                .blocks[index] = cloned;
        }
        Ok(copy)
    }
    pub fn release(&mut self) {
        self.state.release();
    }
    pub(super) fn registration(&self) -> std::rc::Weak<dyn Allocation> {
        let erased: Rc<dyn Allocation> = self.state.clone();
        Rc::downgrade(&erased)
    }
}
// A returned query view keeps its allocation alive. Explicit release and coverage
// scope cleanup still revoke every view; ordinary writer drop only drops its ownership.
impl<T: Sample> Drop for BandState<T> {
    fn drop(&mut self) {
        self.release();
    }
}
