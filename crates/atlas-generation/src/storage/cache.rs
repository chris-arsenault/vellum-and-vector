use super::{
    memory::MemoryBudget,
    scratch::{BlockScratch, SharedScratch},
};
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    io,
    rc::{Rc, Weak},
    sync::Arc,
};

pub(crate) type BlockKey = (u64, usize);
pub(crate) trait Evict {
    fn evict(&self, scratch: &SharedScratch) -> io::Result<()>;
}
struct Entry {
    owner: Weak<dyn Evict>,
    bytes: usize,
    pins: usize,
    used: bool,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct CacheStats {
    pub loads: usize,
    pub evictions: usize,
    pub peak_bytes: usize,
}
pub type SharedCache = Rc<RefCell<BlockCache>>;

pub struct BlockCache {
    budget: Arc<MemoryBudget>,
    resident: bool,
    held: usize,
    entries: HashMap<BlockKey, Entry>,
    clock: VecDeque<BlockKey>,
    pub(crate) scratch: SharedScratch,
    stats: CacheStats,
    next_owner: u64,
}
impl BlockCache {
    pub fn new(budget: usize, scratch: BlockScratch) -> SharedCache {
        Self::build(MemoryBudget::new(budget), scratch, false)
    }
    /// Keep each fitting field contiguous; oversized fields retain the paged representation.
    pub fn resident(budget: usize, scratch: BlockScratch) -> SharedCache {
        Self::with_memory(MemoryBudget::new(budget), scratch)
    }
    pub fn with_memory(budget: Arc<MemoryBudget>, scratch: BlockScratch) -> SharedCache {
        Self::build(budget, scratch, true)
    }
    fn build(budget: Arc<MemoryBudget>, scratch: BlockScratch, resident: bool) -> SharedCache {
        Rc::new(RefCell::new(Self {
            budget,
            resident,
            held: 0,
            entries: HashMap::new(),
            clock: VecDeque::new(),
            scratch: Rc::new(RefCell::new(scratch)),
            stats: CacheStats::default(),
            next_owner: 0,
        }))
    }
    pub(super) fn allocation_cells<T: super::Sample>(&self, length: usize) -> usize {
        if self.resident && length <= self.budget.limit() / T::BYTES {
            length.max(1)
        } else {
            crate::lattice::BLOCK_CELLS
        }
    }
    pub fn bytes(&self) -> usize {
        self.held
    }
    pub fn tracked_blocks(&self) -> usize {
        self.entries.len()
    }
    pub fn stats(&self) -> CacheStats {
        self.stats
    }
    pub(crate) fn owner(&mut self) -> u64 {
        let id = self.next_owner;
        self.next_owner = self
            .next_owner
            .checked_add(1)
            .expect("Band identity overflow");
        id
    }
    pub(crate) fn admit(
        &mut self,
        key: BlockKey,
        owner: Weak<dyn Evict>,
        bytes: usize,
    ) -> io::Result<()> {
        while self.budget.bytes().saturating_add(bytes) > self.budget.limit() && self.evict_one()? {
        }
        self.entries.insert(
            key,
            Entry {
                owner,
                bytes,
                pins: 0,
                used: false,
            },
        );
        self.clock.push_back(key);
        self.held += bytes;
        self.budget.charge(bytes);
        self.stats.loads += 1;
        self.stats.peak_bytes = self.stats.peak_bytes.max(self.held);
        Ok(())
    }
    fn evict_one(&mut self) -> io::Result<bool> {
        for _ in 0..self.clock.len() * 2 {
            let Some(key) = self.clock.pop_front() else {
                return Ok(false);
            };
            let entry = self.entries.get_mut(&key).expect("Clock entry is tracked");
            self.clock.push_back(key);
            if entry.pins > 0 {
                continue;
            }
            if entry.used {
                entry.used = false;
                continue;
            }
            if let Some(owner) = entry.owner.upgrade() {
                owner.evict(&self.scratch)?;
            }
            let entry = self.entries.remove(&key).expect("Evicted entry is tracked");
            self.clock.pop_back();
            self.held -= entry.bytes;
            self.budget.release(entry.bytes);
            self.stats.evictions += 1;
            return Ok(true);
        }
        Ok(false)
    }
    pub(crate) fn pin(&mut self, key: BlockKey) {
        let entry = self.entries.get_mut(&key).expect("Pin a loaded block");
        entry.pins += 1;
        entry.used = true;
    }
    pub(crate) fn unpin(&mut self, key: BlockKey) {
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.pins = entry.pins.saturating_sub(1);
        }
    }
    pub(crate) fn forget(&mut self, owner: u64) {
        self.entries.retain(|key, entry| {
            if key.0 == owner {
                self.held -= entry.bytes;
                self.budget.release(entry.bytes);
                false
            } else {
                true
            }
        });
        self.clock.retain(|key| key.0 != owner);
    }
}

pub(crate) struct Pin {
    pub cache: SharedCache,
    pub key: BlockKey,
}
impl Drop for Pin {
    fn drop(&mut self) {
        self.cache.borrow_mut().unpin(self.key);
    }
}
