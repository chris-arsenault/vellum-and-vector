//! Independent seeded choices for names and geographic language origins.
pub struct Random(u64);
impl Random {
    pub fn new(seed: &str) -> Self {
        Self(seed.bytes().fold(0xcbf29ce484222325, |state, byte| {
            (state ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        }))
    }
    pub fn sample(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((value ^ (value >> 31)) >> 11) as f64 / 9_007_199_254_740_992.0
    }
    pub fn index(&mut self, length: usize) -> usize {
        (self.sample() * length as f64) as usize
    }
    pub fn weighted(&mut self, weights: &[f64]) -> Option<usize> {
        if weights.is_empty() {
            return None;
        }
        let total: f64 = weights.iter().map(|weight| weight.max(0.0)).sum();
        if total == 0.0 {
            return Some(self.index(weights.len()));
        }
        let mut pick = self.sample() * total;
        for (index, weight) in weights.iter().enumerate() {
            pick -= weight.max(0.0);
            if pick < 0.0 {
                return Some(index);
            }
        }
        Some(weights.len() - 1)
    }
}
