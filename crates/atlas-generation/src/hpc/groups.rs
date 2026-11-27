/// Inactive indices have no root; all storage remains dense and unboxed.
pub struct UnionFind {
    parent: Vec<usize>,
    sizes: Vec<usize>,
}
impl UnionFind {
    pub fn push_active(&mut self) -> usize {
        let index = self.parent.len();
        self.parent.push(index);
        self.sizes.push(1);
        index
    }
    pub fn new(length: usize) -> Self {
        Self {
            parent: vec![usize::MAX; length],
            sizes: vec![0; length],
        }
    }
    pub fn active(&self, index: usize) -> bool {
        self.parent[index] != usize::MAX
    }
    pub fn make(&mut self, index: usize) {
        assert!(!self.active(index), "cannot reset a live component");
        self.parent[index] = index;
        self.sizes[index] = 1;
    }
    pub fn find(&mut self, mut index: usize) -> usize {
        assert!(self.active(index), "inactive component has no root");
        while self.parent[index] != index {
            self.parent[index] = self.parent[self.parent[index]];
            index = self.parent[index];
        }
        index
    }
    pub fn size(&mut self, index: usize) -> usize {
        let root = self.find(index);
        self.sizes[root]
    }
    pub fn union(&mut self, a: usize, b: usize) -> usize {
        let (mut a, mut b) = (self.find(a), self.find(b));
        if self.sizes[a] < self.sizes[b] {
            std::mem::swap(&mut a, &mut b);
        }
        self.attach(a, b)
    }
    pub fn attach(&mut self, a: usize, b: usize) -> usize {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[b] = a;
            self.sizes[a] += self.sizes[b];
        }
        a
    }
}

pub struct LabelGroups {
    offsets: Vec<usize>,
    members: Vec<usize>,
}
impl LabelGroups {
    pub fn count(&self) -> usize {
        self.offsets.len() - 1
    }
    pub fn members_of(&self, label: usize) -> &[usize] {
        &self.members[self.offsets[label]..self.offsets[label + 1]]
    }
}
pub fn group_by_label(labels: &[i32], count: usize) -> LabelGroups {
    let mut offsets = vec![0; count + 1];
    for &label in labels.iter().filter(|&&label| label >= 0) {
        offsets[label as usize + 1] += 1;
    }
    for label in 0..count {
        offsets[label + 1] += offsets[label];
    }
    let mut members = vec![0; offsets[count]];
    let mut cursor = offsets[..count].to_vec();
    for (index, &label) in labels.iter().enumerate().filter(|(_, label)| **label >= 0) {
        let label = label as usize;
        members[cursor[label]] = index;
        cursor[label] += 1;
    }
    LabelGroups { offsets, members }
}
