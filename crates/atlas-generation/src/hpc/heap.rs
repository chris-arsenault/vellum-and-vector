#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Ascending,
    Descending,
}

/// Columnar lexicographic heap. Directions are compiled once, not callback dispatch per item.
pub struct MultiKeyHeap<const N: usize> {
    items: Vec<u32>,
    columns: [Vec<f64>; N],
    directions: [Direction; N],
    tie: Direction,
}
pub type KeyedHeap = MultiKeyHeap<1>;

impl<const N: usize> MultiKeyHeap<N> {
    pub fn new(directions: [Direction; N], tie: Direction) -> Self {
        Self {
            items: Vec::new(),
            columns: std::array::from_fn(|_| Vec::new()),
            directions,
            tie,
        }
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    pub fn peek(&self) -> Option<(u32, [f64; N])> {
        Some((
            *self.items.first()?,
            std::array::from_fn(|i| self.columns[i][0]),
        ))
    }
    fn before(&self, a: usize, b: usize) -> bool {
        for (column, direction) in self.columns.iter().zip(self.directions) {
            if column[a] == column[b] {
                continue;
            }
            return match direction {
                Direction::Ascending => column[a] < column[b],
                Direction::Descending => column[a] > column[b],
            };
        }
        match self.tie {
            Direction::Ascending => self.items[a] < self.items[b],
            Direction::Descending => self.items[a] > self.items[b],
        }
    }
    fn swap(&mut self, a: usize, b: usize) {
        self.items.swap(a, b);
        for column in &mut self.columns {
            column.swap(a, b);
        }
    }
    pub fn push(&mut self, item: u32, keys: [f64; N]) {
        assert!(
            keys.iter().all(|key| !key.is_nan()),
            "NaN is not an ordered key"
        );
        let mut at = self.len();
        self.items.push(item);
        for (column, key) in self.columns.iter_mut().zip(keys) {
            column.push(key);
        }
        while at > 0 {
            let parent = (at - 1) / 2;
            if !self.before(at, parent) {
                break;
            }
            self.swap(at, parent);
            at = parent;
        }
    }
    pub fn pop(&mut self) -> Option<(u32, [f64; N])> {
        let top = self.peek()?;
        self.swap(0, self.len() - 1);
        self.items.pop();
        for column in &mut self.columns {
            column.pop();
        }
        let mut at = 0;
        while at * 2 + 1 < self.len() {
            let mut child = at * 2 + 1;
            if child + 1 < self.len() && self.before(child + 1, child) {
                child += 1;
            }
            if !self.before(child, at) {
                break;
            }
            self.swap(child, at);
            at = child;
        }
        Some(top)
    }
}

pub struct TopK {
    capacity: usize,
    heap: KeyedHeap,
}
impl TopK {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            heap: KeyedHeap::new([Direction::Ascending], Direction::Descending),
        }
    }
    pub fn consider(&mut self, item: u32, score: f64) {
        if self.capacity == 0 {
            return;
        }
        if self.heap.len() == self.capacity {
            let (weakest, [value]) = self.heap.peek().expect("nonempty selection");
            if score < value || (score == value && item >= weakest) {
                return;
            }
            self.heap.pop();
        }
        self.heap.push(item, [score]);
    }
    pub fn best(mut self) -> Vec<u32> {
        let mut values = Vec::with_capacity(self.heap.len());
        while let Some((item, _)) = self.heap.pop() {
            values.push(item);
        }
        values.reverse();
        values
    }
}
