//! The existing adaptiveHermite.ts polynomial and sample correction.
#[derive(Clone, Copy)]
pub struct Patch {
    pub coefficients: [f64; 16],
    pub correction: f64,
    pub low: f64,
    pub high: f64,
}
fn basis(t: f64, derivative: bool) -> [f64; 4] {
    if derivative {
        [
            6.0 * t * t - 6.0 * t,
            -6.0 * t * t + 6.0 * t,
            3.0 * t * t - 4.0 * t + 1.0,
            3.0 * t * t - 2.0 * t,
        ]
    } else {
        [
            2.0 * t * t * t - 3.0 * t * t + 1.0,
            -2.0 * t * t * t + 3.0 * t * t,
            t * t * t - 2.0 * t * t + t,
            t * t * t - t * t,
        ]
    }
}
pub fn polynomial(c: &[f64; 16], u: f64, v: f64, du: bool, dv: bool) -> f64 {
    let x = basis(u, du);
    let y = basis(v, dv);
    let mut value = 0.0;
    for corner in 0..4 {
        let i = corner % 2;
        let j = corner / 2;
        let at = corner * 4;
        value += c[at] * x[i] * y[j]
            + c[at + 1] * x[i + 2] * y[j]
            + c[at + 2] * x[i] * y[j + 2]
            + c[at + 3] * x[i + 2] * y[j + 2];
    }
    value
}
impl Patch {
    pub fn new(coefficients: [f64; 16], center: f64) -> Self {
        let mut low = center;
        let mut high = center;
        for corner in 0..4 {
            low = low.min(coefficients[corner * 4]);
            high = high.max(coefficients[corner * 4]);
        }
        Self {
            correction: center - polynomial(&coefficients, 0.5, 0.5, false, false),
            coefficients,
            low,
            high,
        }
    }
    pub fn polynomial(&self, u: f64, v: f64) -> f64 {
        let bubble = 256.0 * (u * (1.0 - u) * v * (1.0 - v)).powi(2);
        polynomial(&self.coefficients, u, v, false, false) + bubble * self.correction
    }
    pub fn sample(&self, u: f64, v: f64) -> f64 {
        self.polynomial(u, v).max(self.low).min(self.high)
    }
}
