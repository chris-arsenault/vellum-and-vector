//! A Gaussian blur of scattered cell values whose cost does not grow with its length.
//!
//! Values are deposited on a square raster a third of the blur length apart, blurred
//! separably there and read back by bilinear interpolation. Values and their weights are
//! blurred alike and divided afterwards, so nothing flows past the outermost cells: the
//! frame edge behaves as a closed boundary, as it does for diffusion sweeps.

/// Raster spacing as a share of the blur's standard deviation.
const SPACING: f64 = 1.0 / 3.0;
/// Kernel reach in standard deviations.
const REACH: f64 = 3.0;

struct Raster {
    origin: [f64; 2],
    spacing: f64,
    columns: usize,
    rows: usize,
}
impl Raster {
    fn cover(points: &[[f64; 2]], weights: &[f64], spacing: f64) -> Option<Self> {
        let mut low = [f64::INFINITY; 2];
        let mut high = [f64::NEG_INFINITY; 2];
        for (point, weight) in points.iter().zip(weights) {
            if *weight > 0.0 {
                for axis in 0..2 {
                    low[axis] = low[axis].min(point[axis]);
                    high[axis] = high[axis].max(point[axis]);
                }
            }
        }
        if !(low[0].is_finite() && spacing > 0.0) {
            return None;
        }
        let count = |axis: usize| ((high[axis] - low[axis]) / spacing).ceil() as usize + 1;
        Some(Self {
            origin: low,
            spacing,
            columns: count(0),
            rows: count(1),
        })
    }
    fn coordinates(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        [
            (x - self.origin[0]) / self.spacing,
            (y - self.origin[1]) / self.spacing,
        ]
    }
    fn nearest(&self, point: [f64; 2]) -> usize {
        let [u, v] = self.coordinates(point);
        let column = (u.round().max(0.0) as usize).min(self.columns - 1);
        let row = (v.round().max(0.0) as usize).min(self.rows - 1);
        row * self.columns + column
    }
    fn sample(&self, raster: &[f64], point: [f64; 2]) -> f64 {
        let [u, v] = self.coordinates(point);
        let span = |t: f64, count: usize| {
            let low = (t.floor().max(0.0) as usize).min(count - 1);
            let high = (low + 1).min(count - 1);
            (low, high, (t - low as f64).clamp(0.0, 1.0))
        };
        let (c0, c1, tx) = span(u, self.columns);
        let (r0, r1, ty) = span(v, self.rows);
        let at = |r: usize, c: usize| raster[r * self.columns + c];
        let bottom = at(r0, c0) * (1.0 - tx) + at(r0, c1) * tx;
        let top = at(r1, c0) * (1.0 - tx) + at(r1, c1) * tx;
        bottom * (1.0 - ty) + top * ty
    }
    /// Separable convolution; taps beyond the raster contribute nothing.
    fn convolve(&self, raster: &mut [f64], kernel: &[f64]) {
        let reach = kernel.len() - 1;
        let mut line = Vec::new();
        for row in 0..self.rows {
            let start = row * self.columns;
            line.clear();
            line.extend_from_slice(&raster[start..start + self.columns]);
            for column in 0..self.columns {
                raster[start + column] = taps(&line, column, reach, kernel);
            }
        }
        for column in 0..self.columns {
            line.clear();
            line.extend((0..self.rows).map(|row| raster[row * self.columns + column]));
            for row in 0..self.rows {
                raster[row * self.columns + column] = taps(&line, row, reach, kernel);
            }
        }
    }
}
fn taps(line: &[f64], at: usize, reach: usize, kernel: &[f64]) -> f64 {
    let low = at.saturating_sub(reach);
    let high = (at + reach).min(line.len() - 1);
    (low..=high).map(|i| line[i] * kernel[at.abs_diff(i)]).sum()
}
/// One side of a sampled Gaussian, centre first, for a standard deviation in raster steps.
fn kernel(deviation: f64) -> Vec<f64> {
    let reach = (REACH * deviation).ceil().max(1.0) as usize;
    (0..=reach)
        .map(|k| (-((k * k) as f64) / (2.0 * deviation * deviation)).exp())
        .collect()
}

/// Blur `values` at `points` with a Gaussian of standard deviation `sigma`, each value
/// counted with its `weight`. Points of zero weight neither contribute nor change.
pub fn blur(points: &[[f64; 2]], weights: &[f64], values: &mut [f64], sigma: f64) {
    let Some(raster) = Raster::cover(points, weights, sigma * SPACING) else {
        return;
    };
    let cells = raster.columns * raster.rows;
    let mut mass = vec![0.0; cells];
    let mut weight = vec![0.0; cells];
    for ((point, w), value) in points.iter().zip(weights).zip(values.iter()) {
        if *w > 0.0 {
            let bin = raster.nearest(*point);
            mass[bin] += value * w;
            weight[bin] += w;
        }
    }
    let kernel = kernel(1.0 / SPACING);
    raster.convolve(&mut mass, &kernel);
    raster.convolve(&mut weight, &kernel);
    for ((point, w), value) in points.iter().zip(weights).zip(values.iter_mut()) {
        if *w > 0.0 {
            let total = raster.sample(&weight, *point);
            if total > 0.0 {
                *value = raster.sample(&mass, *point) / total;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::blur;

    fn line(count: usize, step: f64) -> Vec<[f64; 2]> {
        (0..count).map(|i| [i as f64 * step, 0.0]).collect()
    }

    #[test]
    fn a_level_field_stays_level() {
        let points = line(200, 10.0);
        let mut values = vec![7.5; points.len()];
        blur(&points, &vec![1.0; points.len()], &mut values, 150.0);
        assert!(values.iter().all(|v| (v - 7.5).abs() < 1e-9));
    }

    #[test]
    fn a_step_spreads_over_about_the_blur_length() {
        let points = line(400, 10.0);
        let mut values: Vec<f64> = (0..400).map(|i| f64::from(u8::from(i >= 200))).collect();
        blur(&points, &vec![1.0; points.len()], &mut values, 100.0);
        // The edge lies at 1995 m. A Gaussian edge reads about 16% one standard
        // deviation before it and 84% one after it.
        assert!((values[190] - 0.16).abs() < 0.06, "{}", values[190]);
        assert!((values[210] - 0.84).abs() < 0.06, "{}", values[210]);
        assert!(values[100] < 0.01 && values[300] > 0.99);
    }

    #[test]
    fn unweighted_points_neither_contribute_nor_change() {
        let points = line(100, 10.0);
        let mut weights = vec![1.0; 100];
        let mut values = vec![1.0; 100];
        weights[50] = 0.0;
        values[50] = 1000.0;
        blur(&points, &weights, &mut values, 80.0);
        assert_eq!(values[50], 1000.0);
        assert!(values
            .iter()
            .enumerate()
            .all(|(i, v)| i == 50 || (v - 1.0).abs() < 1e-9));
    }
}
