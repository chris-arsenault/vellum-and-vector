//! Atlas spatial noise: mixed integer coordinates and rotated value-noise octaves.
//!
//! This is the arithmetic beneath [`crate::chance`]. A generation rule does not call it:
//! it takes its draws, fields, choices, spreads and walks from `chance`, and the
//! architecture suite fails a file that adds a call here.
use crate::lattice::TriangularLattice;
fn word(value: f64) -> u32 {
    value.trunc().rem_euclid(4_294_967_296.0) as u32
}
pub fn hash_unit(salt: i32, x: f64, y: f64) -> f64 {
    let coordinates = (u64::from(word(x)) << 32) | u64::from(word(y));
    let mut value =
        coordinates.wrapping_add(u64::from(salt as u32).wrapping_mul(0x9e37_79b9_7f4a_7c15));
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value >> 11) as f64 / 9_007_199_254_740_992.0
}
pub fn hash_signed(salt: i32, x: f64, y: f64) -> f64 {
    hash_unit(salt, x, y) * 2.0 - 1.0
}
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
fn smooth(value: f64) -> f64 {
    value * value * (3.0 - 2.0 * value)
}
fn value_noise(x: f64, y: f64, salt: i32) -> f64 {
    let (x0, y0) = (x.floor(), y.floor());
    let (tx, ty) = (smooth(x - x0), smooth(y - y0));
    lerp(
        lerp(
            hash_signed(salt, x0, y0),
            hash_signed(salt, x0 + 1.0, y0),
            tx,
        ),
        lerp(
            hash_signed(salt, x0, y0 + 1.0),
            hash_signed(salt, x0 + 1.0, y0 + 1.0),
            tx,
        ),
        ty,
    )
}
pub fn fractal_noise(x: f64, y: f64, salt: i32, mut scale: f64, octaves: usize) -> f64 {
    let (mut amplitude, mut total, mut value, mut cos, mut sin) = (1.0, 0.0, 0.0, 1.0, 0.0);
    let (rotation_sin, rotation_cos) = 2.399_963_229_728_653_5f64.sin_cos();
    for octave in 0..octaves {
        value += value_noise(
            (x * cos - y * sin) / scale,
            (x * sin + y * cos) / scale,
            salt.wrapping_add((octave as i32).wrapping_mul(7919)),
        ) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
        scale *= 0.5;
        let next_cos = cos * rotation_cos - sin * rotation_sin;
        sin = cos * rotation_sin + sin * rotation_cos;
        cos = next_cos;
    }
    value / total
}
pub fn unit_noise(x: f64, y: f64, salt: i32, scale: f64, octaves: usize) -> f64 {
    (fractal_noise(x, y, salt, scale, octaves) + 1.0) * 0.5
}
pub fn mesh_noise(
    mesh: &TriangularLattice,
    x: f64,
    y: f64,
    salt: i32,
    scale: f64,
    octaves: usize,
) -> f64 {
    let Some(width) = mesh.periodic_width() else {
        return fractal_noise(x, y, salt, scale, octaves);
    };
    let phase = x.rem_euclid(width);
    lerp(
        fractal_noise(phase, y, salt, scale, octaves),
        fractal_noise(phase - width, y, salt, scale, octaves),
        smooth(phase / width),
    )
}
pub fn world_noise(
    mesh: &TriangularLattice,
    x: f64,
    y: f64,
    salt: i32,
    scale: f64,
    octaves: usize,
) -> f64 {
    if mesh.periodic_width().is_some() {
        let [ox, oy] = mesh.origin();
        mesh_noise(mesh, x - ox, y - oy, salt, scale, octaves)
    } else {
        fractal_noise(x, y, salt, scale, octaves)
    }
}
