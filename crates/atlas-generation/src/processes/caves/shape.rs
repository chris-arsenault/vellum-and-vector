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
/// A closed ring cut to a rectangular frame `[west, south, east, north]`, closed again; empty
/// when nothing of it lies inside. A chamber beneath an edge triangle reaches past the map's
/// edge, and the map holds only the part inside.
pub fn clip_ring(ring: &[[f64; 2]], frame: [f64; 4]) -> Vec<[f64; 2]> {
    // Each frame edge keeps the side `inside` says and cuts a crossing at `cut`.
    type Side = (
        fn([f64; 2], [f64; 4]) -> bool,
        fn([f64; 2], [f64; 2], [f64; 4]) -> [f64; 2],
    );
    let sides: [Side; 4] = [
        (|p, f| p[0] >= f[0], |a, b, f| cut_x(a, b, f[0])),
        (|p, f| p[0] <= f[2], |a, b, f| cut_x(a, b, f[2])),
        (|p, f| p[1] >= f[1], |a, b, f| cut_y(a, b, f[1])),
        (|p, f| p[1] <= f[3], |a, b, f| cut_y(a, b, f[3])),
    ];
    let mut points: Vec<[f64; 2]> = ring.to_vec();
    if points.len() > 1 && points.first() == points.last() {
        points.pop();
    }
    for (inside, cut) in sides {
        let input = std::mem::take(&mut points);
        for (at, &current) in input.iter().enumerate() {
            let previous = input[(at + input.len() - 1) % input.len()];
            match (inside(previous, frame), inside(current, frame)) {
                (true, true) => points.push(current),
                (true, false) => points.push(cut(previous, current, frame)),
                (false, true) => {
                    points.push(cut(previous, current, frame));
                    points.push(current);
                }
                (false, false) => {}
            }
        }
    }
    if points.len() < 3 {
        return Vec::new();
    }
    points.push(points[0]);
    points
}
fn cut_x(a: [f64; 2], b: [f64; 2], x: f64) -> [f64; 2] {
    let t = (x - a[0]) / (b[0] - a[0]);
    [x, a[1] + (b[1] - a[1]) * t]
}
fn cut_y(a: [f64; 2], b: [f64; 2], y: f64) -> [f64; 2] {
    let t = (y - a[1]) / (b[1] - a[1]);
    [a[0] + (b[0] - a[0]) * t, y]
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
    fn a_chamber_at_the_edge_is_cut_to_the_frame() {
        let ring = outline([0.0, 50.0], 10.0, 12);
        let cut = clip_ring(&ring, [0.0, 0.0, 100.0, 100.0]);
        assert_eq!(cut.first(), cut.last());
        assert!(cut.iter().all(|p| p[0] >= -1e-9 && p[0] <= 100.0));
        assert!(cut.iter().any(|p| p[0] > 9.0));
        assert!(clip_ring(&outline([-50.0, 50.0], 10.0, 12), [0.0, 0.0, 100.0, 100.0]).is_empty());
        let inside = outline([50.0, 50.0], 10.0, 12);
        assert_eq!(
            clip_ring(&inside, [0.0, 0.0, 100.0, 100.0]).len(),
            inside.len()
        );
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
