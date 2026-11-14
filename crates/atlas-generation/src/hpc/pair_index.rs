use super::EpochStamps;

pub struct IntPairIndex {
    first: Vec<i32>,
    second: Vec<i32>,
    slots: Vec<usize>,
    stamps: EpochStamps<()>,
}
impl Default for IntPairIndex {
    fn default() -> Self {
        Self {
            first: Vec::new(),
            second: Vec::new(),
            slots: vec![0; 32],
            stamps: EpochStamps::new(32),
        }
    }
}
impl IntPairIndex {
    pub fn len(&self) -> usize {
        self.first.len()
    }
    pub fn is_empty(&self) -> bool {
        self.first.is_empty()
    }
    pub fn pair(&self, index: usize) -> (i32, i32) {
        (self.first[index], self.second[index])
    }
    pub fn clear(&mut self) {
        self.first.clear();
        self.second.clear();
        self.stamps.begin();
    }
    fn slot(&self, a: i32, b: i32) -> usize {
        let mask = self.slots.len() - 1;
        let mut slot = ((a as u32).wrapping_mul(0x9e3779b1) ^ (b as u32).wrapping_mul(0x85ebca6b))
            as usize
            & mask;
        while self.stamps.marked(slot) {
            if self.pair(self.slots[slot]) == (a, b) {
                return slot;
            }
            slot = (slot + 1) & mask;
        }
        slot
    }
    pub fn include(&mut self, a: i32, b: i32) -> usize {
        let mut slot = self.slot(a, b);
        if self.stamps.marked(slot) {
            return self.slots[slot];
        }
        if self.len() * 2 >= self.slots.len() {
            self.grow();
            slot = self.slot(a, b);
        }
        let index = self.len();
        self.first.push(a);
        self.second.push(b);
        self.slots[slot] = index;
        self.stamps.mark(slot);
        index
    }
    fn grow(&mut self) {
        self.slots.resize(self.slots.len() * 2, 0);
        self.stamps = EpochStamps::new(self.slots.len());
        for index in 0..self.len() {
            let (a, b) = self.pair(index);
            let slot = self.slot(a, b);
            self.slots[slot] = index;
            self.stamps.mark(slot);
        }
    }
}
