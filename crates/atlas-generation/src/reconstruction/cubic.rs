//! Smooth reconstruction on a regular sample raster. Bilinear interpolation has a
//! constant slope inside each sample square, so shading drawn from it shows the
//! squares; a Catmull-Rom window keeps value and slope continuous across samples.

/// Catmull-Rom weights for the samples at -1, 0, 1 and 2 around a fraction `t`.
pub fn weights(t: f64) -> [f64; 4] {
    let t2 = t * t;
    let t3 = t2 * t;
    [
        0.5 * (-t3 + 2.0 * t2 - t),
        0.5 * (3.0 * t3 - 5.0 * t2 + 2.0),
        0.5 * (-3.0 * t3 + 4.0 * t2 + t),
        0.5 * (t3 - t2),
    ]
}
/// The 4×4 sample window around the lower-left sample `cell` of a `width` × `height`
/// raster, rows from below, clamped at the raster edges.
pub fn window(cell: usize, width: usize, height: usize) -> [[usize; 4]; 4] {
    let (x, y) = ((cell % width) as isize, (cell / width) as isize);
    let at = |dx: isize, dy: isize| {
        let col = (x + dx).clamp(0, width as isize - 1) as usize;
        let row = (y + dy).clamp(0, height as isize - 1) as usize;
        row * width + col
    };
    std::array::from_fn(|r| std::array::from_fn(|c| at(c as isize - 1, r as isize - 1)))
}
/// Cubic value at fraction (`tx`, `ty`) inside the window, kept within the range of
/// the four surrounding samples so the curve adds no peaks or pits of its own.
/// Falls back to bilinear when an outer sample is not finite.
pub fn sample(values: &[[f64; 4]; 4], tx: f64, ty: f64) -> f64 {
    let inner = [values[1][1], values[1][2], values[2][1], values[2][2]];
    let bilinear = (1.0 - ty) * ((1.0 - tx) * inner[0] + tx * inner[1])
        + ty * ((1.0 - tx) * inner[2] + tx * inner[3]);
    if values.iter().flatten().any(|v| !v.is_finite()) {
        return bilinear;
    }
    let (wx, wy) = (weights(tx), weights(ty));
    let mut value = 0.0;
    for (row, wy) in values.iter().zip(wy) {
        for (v, wx) in row.iter().zip(wx) {
            value += wy * wx * v;
        }
    }
    let low = inner.into_iter().fold(f64::INFINITY, f64::min);
    let high = inner.into_iter().fold(f64::NEG_INFINITY, f64::max);
    value.clamp(low, high)
}
/// Class codes of a 4×4 window, `None` where a sample is inactive.
pub type Codes = [[Option<i32>; 4]; 4];
/// Cubic membership of `code` in a window of class codes.
pub fn membership(codes: &Codes, code: i32, wx: [f64; 4], wy: [f64; 4]) -> f64 {
    let mut weight = 0.0;
    for (row, wy) in codes.iter().zip(wy) {
        for (cell, wx) in row.iter().zip(wx) {
            if *cell == Some(code) {
                weight += wy * wx;
            }
        }
    }
    weight
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weights_reproduce_samples_and_sum_to_one() {
        assert_eq!(weights(0.0), [0.0, 1.0, 0.0, 0.0]);
        assert_eq!(weights(1.0), [0.0, 0.0, 1.0, 0.0]);
        for t in [0.1, 0.37, 0.5, 0.9] {
            assert!((weights(t).iter().sum::<f64>() - 1.0).abs() < 1e-12);
        }
    }

    #[test]
    fn slope_is_continuous_across_a_sample() {
        // A parabola sampled on integers: bilinear slope jumps at x = 2, cubic does not.
        let row = |x0: f64| std::array::from_fn(|c| (x0 + c as f64 - 1.0).powi(2));
        let left: [[f64; 4]; 4] = std::array::from_fn(|_| row(1.0));
        let right: [[f64; 4]; 4] = std::array::from_fn(|_| row(2.0));
        let h = 1e-6;
        let before = (sample(&left, 1.0, 0.5) - sample(&left, 1.0 - h, 0.5)) / h;
        let after = (sample(&right, h, 0.5) - sample(&right, 0.0, 0.5)) / h;
        assert!((before - after).abs() < 1e-3, "{before} vs {after}");
    }

    #[test]
    fn window_clamps_at_the_raster_edge() {
        let rows = window(0, 3, 2);
        assert_eq!(rows[0], [0, 0, 1, 2]);
        assert_eq!(rows[3], [3, 3, 4, 5]);
    }
}
