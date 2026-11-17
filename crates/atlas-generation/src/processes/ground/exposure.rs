//! Where rock shows. Rock is bare where its loose cover is thinner than a declared depth, or
//! where the ground is steeper than loose cover can hold; touching bare triangles form one
//! outcrop. A long, narrow band of ground too steep to stand as anything but rock is a cliff.
use super::settings::{BARE_COVER, CLIFF_ELONGATION, CLIFF_LENGTH, CLIFF_SLOPE, HOLDING_SLOPE};

/// What exposure reads at one lattice triangle.
#[derive(Clone, Debug)]
pub struct Ground {
    pub position: [f64; 2],
    /// Square metres.
    pub area: f64,
    pub neighbours: [Option<usize>; 3],
    /// Dry land inside the map.
    pub land: bool,
    /// Loose cover over the rock, metres.
    pub cover: f64,
    /// Rise over run.
    pub slope: f64,
    /// Metres.
    pub elevation: f64,
}
/// Bare rock: thin cover, or a slope loose cover cannot hold.
pub fn exposed(ground: &Ground) -> bool {
    ground.land && (ground.cover < BARE_COVER || ground.slope > HOLDING_SLOPE)
}
fn steep(ground: &Ground) -> bool {
    ground.land && ground.slope > CLIFF_SLOPE
}
/// Groups of touching triangles that pass `test`, each listed from its first triangle.
pub fn components(cells: &[Ground], test: impl Fn(&Ground) -> bool) -> Vec<Vec<usize>> {
    let mut seen = vec![false; cells.len()];
    let mut groups = Vec::new();
    for start in 0..cells.len() {
        if seen[start] || !test(&cells[start]) {
            continue;
        }
        seen[start] = true;
        let mut group = vec![start];
        let mut next = 0;
        while next < group.len() {
            let cell = group[next];
            next += 1;
            for neighbour in cells[cell].neighbours.into_iter().flatten() {
                if neighbour < cells.len() && !seen[neighbour] && test(&cells[neighbour]) {
                    seen[neighbour] = true;
                    group.push(neighbour);
                }
            }
        }
        groups.push(group);
    }
    groups
}
/// Every outcrop: touching bare triangles.
pub fn outcrops(cells: &[Ground]) -> Vec<Vec<usize>> {
    components(cells, exposed)
}
#[derive(Clone, Debug, PartialEq)]
pub struct Cliff {
    /// The cliff's line along its band.
    pub line: Vec<[f64; 2]>,
    /// The rise across the band, metres.
    pub height: f64,
    pub length: f64,
}
/// The band's long axis and its extent along it.
fn axis(cells: &[Ground], group: &[usize]) -> ([f64; 2], [f64; 2], f64, f64) {
    let n = group.len() as f64;
    let (mx, my) = group.iter().fold((0.0, 0.0), |(x, y), &c| {
        (x + cells[c].position[0] / n, y + cells[c].position[1] / n)
    });
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for &c in group {
        let (dx, dy) = (cells[c].position[0] - mx, cells[c].position[1] - my);
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    let angle = 0.5 * (2.0 * xy).atan2(xx - yy);
    let direction = [angle.cos(), angle.sin()];
    let (low, high) = group
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), &c| {
            let along = (cells[c].position[0] - mx) * direction[0]
                + (cells[c].position[1] - my) * direction[1];
            (l.min(along), h.max(along))
        });
    ([mx, my], direction, low, high)
}
/// The band's line: the mean position of its triangles in steps along its long axis.
fn trace(
    cells: &[Ground],
    group: &[usize],
    centre: [f64; 2],
    direction: [f64; 2],
    low: f64,
    step: f64,
) -> Vec<[f64; 2]> {
    let mut bins: Vec<(f64, f64, f64)> = Vec::new();
    for &c in group {
        let [x, y] = cells[c].position;
        let along = (x - centre[0]) * direction[0] + (y - centre[1]) * direction[1];
        let bin = ((along - low) / step) as usize;
        if bins.len() <= bin {
            bins.resize(bin + 1, (0.0, 0.0, 0.0));
        }
        bins[bin] = (bins[bin].0 + x, bins[bin].1 + y, bins[bin].2 + 1.0);
    }
    bins.into_iter()
        .filter(|b| b.2 > 0.0)
        .map(|(x, y, n)| [x / n, y / n])
        .collect()
}
/// Every cliff: a band of rock too steep to hold cover, long and narrow enough to read as one.
pub fn cliffs(cells: &[Ground]) -> Vec<Cliff> {
    let mut result = Vec::new();
    for group in components(cells, steep) {
        let area: f64 = group.iter().map(|&c| cells[c].area).sum();
        let cell = (area / group.len() as f64).sqrt();
        let (centre, direction, low, high) = axis(cells, &group);
        let length = high - low + cell;
        if length < CLIFF_LENGTH || length < CLIFF_ELONGATION * area / length {
            continue;
        }
        let line = trace(cells, &group, centre, direction, low, 2.0 * cell);
        if line.len() < 2 {
            continue;
        }
        let (bottom, top) = group
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(b, t), &c| {
                (b.min(cells[c].elevation), t.max(cells[c].elevation))
            });
        result.push(Cliff {
            line,
            height: top - bottom,
            length,
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A grid of one-metre cells, `columns` by `rows`, each joined left, right and up.
    fn grid(
        columns: usize,
        rows: usize,
        ground: impl Fn(usize, usize) -> (f64, f64),
    ) -> Vec<Ground> {
        let mut cells = Vec::new();
        for row in 0..rows {
            for column in 0..columns {
                let at = |c: usize, r: usize| (c < columns && r < rows).then_some(r * columns + c);
                let (cover, slope) = ground(column, row);
                cells.push(Ground {
                    position: [column as f64, row as f64],
                    area: 1.0,
                    neighbours: [
                        column.checked_sub(1).and_then(|c| at(c, row)),
                        at(column + 1, row),
                        at(column, row + 1),
                    ],
                    land: true,
                    cover,
                    slope,
                    elevation: row as f64 * slope,
                });
            }
        }
        cells
    }
    #[test]
    fn thin_or_oversteep_cover_leaves_rock_showing() {
        let cells = grid(5, 1, |column, _| match column {
            0 => (0.1, 0.1),
            1 => (2.0, 0.9),
            2 => (2.0, 0.1),
            _ => (0.0, 0.0),
        });
        let found = outcrops(&cells);
        assert_eq!(found, vec![vec![0, 1], vec![3, 4]]);
    }
    #[test]
    fn water_shows_no_rock() {
        let mut cells = grid(3, 1, |_, _| (0.0, 0.0));
        cells[1].land = false;
        assert_eq!(outcrops(&cells).len(), 2);
    }
    #[test]
    fn a_long_steep_band_is_a_cliff_and_a_steep_patch_is_not() {
        let band = grid(20, 2, |_, _| (0.0, 2.0));
        let found = cliffs(&band);
        assert_eq!(found.len(), 1);
        let cliff = &found[0];
        assert!(cliff.length >= 20.0 && cliff.line.len() >= 5);
        assert!(cliff.line.iter().all(|p| (p[1] - 0.5).abs() < 1e-6));
        assert!((cliff.height - 2.0).abs() < 1e-9);
        let patch = grid(4, 4, |_, _| (0.0, 2.0));
        assert!(cliffs(&patch).is_empty());
    }
}
