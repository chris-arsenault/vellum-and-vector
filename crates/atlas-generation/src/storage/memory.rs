//! Shared accounting across native jobs and their publication allocations.
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

pub struct MemoryBudget {
    limit: usize,
    held: AtomicUsize,
    peak: AtomicUsize,
}
impl MemoryBudget {
    pub fn new(limit: usize) -> Arc<Self> {
        assert!(limit > 0, "Working memory needs a positive byte budget");
        Arc::new(Self {
            limit,
            held: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        })
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    pub fn bytes(&self) -> usize {
        self.held.load(Ordering::Relaxed)
    }
    pub fn peak_bytes(&self) -> usize {
        self.peak.load(Ordering::Relaxed)
    }
    pub(super) fn charge(&self, bytes: usize) {
        let held = self.held.fetch_add(bytes, Ordering::Relaxed) + bytes;
        self.peak.fetch_max(held, Ordering::Relaxed);
    }
    pub(super) fn release(&self, bytes: usize) {
        self.held.fetch_sub(bytes, Ordering::Relaxed);
    }
}
