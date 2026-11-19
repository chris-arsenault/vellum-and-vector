use super::CellQueue;

#[derive(Clone, Debug)]
pub struct BitSet {
    length: usize,
    words: Vec<u64>,
}

impl BitSet {
    pub fn new(length: usize) -> Self {
        Self {
            length,
            words: vec![0; length.div_ceil(64)],
        }
    }
    pub fn has(&self, index: usize) -> bool {
        assert!(index < self.length);
        self.words[index / 64] & (1 << (index % 64)) != 0
    }
    pub fn add(&mut self, index: usize) -> bool {
        let fresh = !self.has(index);
        self.words[index / 64] |= 1 << (index % 64);
        fresh
    }
    pub fn clear(&mut self, index: usize) {
        assert!(index < self.length);
        self.words[index / 64] &= !(1 << (index % 64));
    }
    pub fn clear_all(&mut self) {
        self.words.fill(0);
    }
    pub fn count(&self) -> usize {
        self.words.iter().map(|v| v.count_ones() as usize).sum()
    }
    pub fn next_set(&self, from: usize) -> Option<usize> {
        if from >= self.length {
            return None;
        }
        let mut word = from / 64;
        let mut bits = self.words[word] & (u64::MAX << (from % 64));
        loop {
            if bits != 0 {
                return Some(word * 64 + bits.trailing_zeros() as usize);
            }
            word += 1;
            bits = *self.words.get(word)?;
        }
    }
}

/// Clearing advances a generation counter; overflow performs a real reset.
pub struct EpochStamps<T> {
    stamps: Vec<u32>,
    values: Vec<T>,
    epoch: u32,
}

impl<T: Clone + Default> EpochStamps<T> {
    pub fn new(length: usize) -> Self {
        Self {
            stamps: vec![0; length],
            values: vec![T::default(); length],
            epoch: 1,
        }
    }
    pub fn begin(&mut self) {
        match self.epoch.checked_add(1) {
            Some(next) => self.epoch = next,
            None => {
                self.stamps.fill(0);
                self.epoch = 1;
            }
        }
    }
    pub fn marked(&self, index: usize) -> bool {
        self.stamps[index] == self.epoch
    }
    pub fn forget(&mut self, index: usize) {
        self.stamps[index] = 0;
    }
    pub fn mark(&mut self, index: usize) -> bool {
        let fresh = !self.marked(index);
        self.stamps[index] = self.epoch;
        fresh
    }
    pub fn set(&mut self, index: usize, value: T) {
        self.mark(index);
        self.values[index] = value;
    }
    pub fn get(&self, index: usize) -> Option<&T> {
        self.marked(index).then(|| &self.values[index])
    }
}

/// Membership in insertion order. A few values are scanned directly; past that a hash
/// index answers, so a set that grows (cells a walk visited) stays linear overall.
#[derive(Default)]
pub struct SmallIntSet {
    values: Vec<i32>,
    // hpc-exempt: sparse membership of the values added, not per-cell lattice state.
    index: std::collections::HashSet<i32>,
}
/// Up to this many values a linear scan is faster than hashing.
const SCANNED: usize = 16;
impl SmallIntSet {
    pub fn has(&self, value: i32) -> bool {
        if self.values.len() <= SCANNED {
            self.values.contains(&value)
        } else {
            self.index.contains(&value)
        }
    }
    pub fn add(&mut self, value: i32) -> bool {
        if self.has(value) {
            return false;
        }
        self.values.push(value);
        if self.values.len() > SCANNED {
            if self.index.is_empty() {
                self.index.extend(self.values.iter().copied());
            } else {
                self.index.insert(value);
            }
        }
        true
    }
    pub fn items(&self) -> &[i32] {
        &self.values
    }
    pub fn clear(&mut self) {
        self.values.clear();
        self.index.clear();
    }
}

pub struct Worklist {
    queue: CellQueue,
    queued: BitSet,
}
impl Worklist {
    pub fn new(length: usize) -> Self {
        assert!(
            u32::try_from(length).is_ok(),
            "cell IDs must fit their representation"
        );
        Self {
            queue: CellQueue::new(),
            queued: BitSet::new(length),
        }
    }
    pub fn add(&mut self, cell: u32) -> bool {
        if !self.queued.add(cell as usize) {
            return false;
        }
        self.queue.push_back(cell);
        true
    }
    pub fn take(&mut self) -> Option<u32> {
        let cell = self.queue.pop_front()?;
        self.queued.clear(cell as usize);
        Some(cell)
    }
    pub fn fill(&mut self, count: u32) {
        for cell in 0..count {
            self.add(cell);
        }
    }
    pub fn len(&self) -> usize {
        self.queue.len()
    }
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;
    #[test]
    fn resetting_stamps_including_wrap_discards_old_values() {
        let mut stamps = EpochStamps::<f64>::new(2);
        stamps.set(0, 12.0);
        stamps.begin();
        assert!(stamps.get(0).is_none());
        stamps.epoch = u32::MAX;
        stamps.set(1, 4.0);
        stamps.begin();
        assert!(stamps.get(1).is_none());
        assert!(stamps.mark(0));
        assert!(!stamps.mark(0));
    }

    #[test]
    fn small_int_sets_keep_membership_and_order_past_the_scanned_size() {
        let mut set = super::SmallIntSet::default();
        let values: Vec<i32> = (0..100).map(|i| (i * 37) % 101 - 50).collect();
        for &value in &values {
            assert!(set.add(value));
            assert!(!set.add(value));
        }
        assert_eq!(set.items(), values.as_slice());
        assert!(values.iter().all(|&value| set.has(value)));
        assert!(!set.has(1000));
        set.clear();
        assert!(set.items().is_empty() && !set.has(values[50]));
        assert!(set.add(values[50]));
    }
}
