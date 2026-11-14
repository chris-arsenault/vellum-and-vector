use super::Direction;
pub enum NumericKey<'a> {
    Float(&'a [f64]),
    Signed(&'a [i32]),
    Unsigned(&'a [u32]),
}
impl NumericKey<'_> {
    fn len(&self) -> usize {
        match self {
            Self::Float(v) => v.len(),
            Self::Signed(v) => v.len(),
            Self::Unsigned(v) => v.len(),
        }
    }
    fn bits(&self, index: usize) -> u64 {
        match self {
            Self::Float(values) => {
                let value = values[index];
                let bits = if value == 0.0 { 0 } else { value.to_bits() };
                if bits >> 63 == 0 {
                    bits ^ (1 << 63)
                } else {
                    !bits
                }
            }
            Self::Signed(values) => (values[index] as u32 ^ (1 << 31)) as u64,
            Self::Unsigned(values) => values[index] as u64,
        }
    }
}

/// Stable lexicographic numeric order; source index resolves all equal keys.
pub fn radix_order(
    keys: &[NumericKey<'_>],
    direction: Direction,
) -> Result<Vec<usize>, &'static str> {
    let length = keys.first().map_or(0, NumericKey::len);
    for key in keys {
        if key.len() != length {
            return Err("Key columns must have the same length");
        }
        if matches!(key, NumericKey::Float(values) if values.iter().any(|value| value.is_nan())) {
            return Err("NaN is not an ordered key");
        }
    }
    let mut order: Vec<_> = (0..length).collect();
    let mut scratch = vec![0; length];
    for key in keys.iter().rev() {
        let bits: Vec<_> = (0..length)
            .map(|index| {
                let bits = key.bits(index);
                if direction == Direction::Descending {
                    !bits
                } else {
                    bits
                }
            })
            .collect();
        for shift in (0..64).step_by(8) {
            if pass(&bits, shift, &order, &mut scratch) {
                std::mem::swap(&mut order, &mut scratch);
            }
        }
    }
    Ok(order)
}
fn pass(bits: &[u64], shift: u32, source: &[usize], target: &mut [usize]) -> bool {
    let mut counts = [0usize; 256];
    for &index in source {
        counts[((bits[index] >> shift) & 255) as usize] += 1;
    }
    if counts.contains(&source.len()) {
        return false;
    }
    let mut total = 0;
    for count in &mut counts {
        let size = *count;
        *count = total;
        total += size;
    }
    for &index in source {
        let bucket = ((bits[index] >> shift) & 255) as usize;
        target[counts[bucket]] = index;
        counts[bucket] += 1;
    }
    true
}
