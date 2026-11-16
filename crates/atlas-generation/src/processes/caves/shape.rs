//! Passage and chamber geometry in metres: vertices carry the width and depth of the passage.
use super::settings::LEVEL_DEPTH;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vertex {
    pub position: [f64; 2],
    /// Full passage width at this vertex, metres.
    pub width: f64,
    /// Depth of the passage floor below the ground, metres.
    pub depth: f64,
}
fn mix(a: &Vertex, b: &Vertex, share: f64) -> Vertex {
    let at = |x: f64, y: f64| x + (y - x) * share;
    Vertex {
        position: [
            at(a.position[0], b.position[0]),
            at(a.position[1], b.position[1]),
        ],
        width: at(a.width, b.width),
        depth: at(a.depth, b.depth),
    }
}
/// One corner-cutting pass: a course drawn through cell centres loses the lattice's zigzag
/// while its ends, where it meets mouths and confluences, stay where they were.
pub fn smooth(vertices: &[Vertex]) -> Vec<Vertex> {
    if vertices.len() < 3 {
        return vertices.to_vec();
    }
    let mut result = vec![vertices[0]];
    for pair in vertices.windows(2) {
        result.push(mix(&pair[0], &pair[1], 0.25));
        result.push(mix(&pair[0], &pair[1], 0.75));
    }
    result.push(*vertices.last().unwrap());
    result.remove(1);
    result.remove(result.len() - 2);
    result
}
/// Length of a course through these points, metres.
pub fn length(points: &[[f64; 2]]) -> f64 {
    points
        .windows(2)
        .map(|pair| (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]))
        .sum()
}
/// Indices of the points at which a course has run another `spacing` metres since the last.
pub fn spaced(points: &[[f64; 2]], spacing: f64) -> Vec<usize> {
    let mut chosen = Vec::new();
    let mut run = 0.0;
    for (at, pair) in points.windows(2).enumerate() {
        run += (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]);
        if run >= spacing {
            chosen.push(at + 1);
            run = 0.0;
        }
    }
    chosen
}
/// A closed ring around `centre` with `sides` corners.
pub fn outline(centre: [f64; 2], radius: f64, sides: usize) -> Vec<[f64; 2]> {
    let mut ring: Vec<[f64; 2]> = (0..sides)
        .map(|side| {
            let angle = std::f64::consts::TAU * side as f64 / sides as f64;
            [
                centre[0] + radius * angle.cos(),
                centre[1] + radius * angle.sin(),
            ]
        })
        .collect();
    ring.push(ring[0]);
    ring
}
/// Cave levels are depth bands below the ground; level one lies nearest the surface.
pub fn level(depth: f64) -> u32 {
    (depth.max(0.0) / LEVEL_DEPTH).floor() as u32 + 1
}
#[cfg(test)]
mod tests {
    use super::*;
    fn vertex(x: f64, width: f64) -> Vertex {
        Vertex {
            position: [x, if x == 1.0 { 1.0 } else { 0.0 }],
            width,
            depth: width * 10.0,
        }
    }
    #[test]
    fn smoothing_keeps_the_ends_and_carries_widths_and_depths() {
        let course = [vertex(0.0, 1.0), vertex(1.0, 2.0), vertex(2.0, 3.0)];
        let smoothed = smooth(&course);
        assert_eq!(smoothed.first(), course.first());
        assert_eq!(smoothed.last(), course.last());
        assert_eq!(smoothed.len(), 4);
        assert_eq!(smoothed[1].position, [0.75, 0.75]);
        assert_eq!((smoothed[1].width, smoothed[1].depth), (1.75, 17.5));
        assert_eq!(smooth(&course[..2]), course[..2].to_vec());
    }
    #[test]
    fn spacing_counts_distance_along_the_course() {
        let points: Vec<[f64; 2]> = (0..=10).map(|x| [f64::from(x) * 10.0, 0.0]).collect();
        assert_eq!(length(&points), 100.0);
        assert_eq!(spaced(&points, 30.0), vec![3, 6, 9]);
    }
    #[test]
    fn a_chamber_outline_is_a_closed_ring_at_its_radius() {
        let ring = outline([10.0, 5.0], 2.0, 12);
        assert_eq!(ring.len(), 13);
        assert_eq!(ring.first(), ring.last());
        for [x, y] in ring {
            assert!(((x - 10.0).hypot(y - 5.0) - 2.0).abs() < 1e-9);
        }
    }
    #[test]
    fn levels_are_depth_bands_from_the_surface() {
        assert_eq!(level(0.0), 1);
        assert_eq!(level(LEVEL_DEPTH - 0.1), 1);
        assert_eq!(level(LEVEL_DEPTH * 2.5), 3);
    }
}
