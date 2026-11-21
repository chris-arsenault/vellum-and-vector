//! Coast polygons as the authority for land and sea: the height grid is forced above sea level
//! inside them and below it outside, with a shore transition a few pixels wide.
use super::{
    geom::{fill_mask, Ring},
    shape::{check_rings, Rect},
    Terrain,
};
use std::io;

/// Pixels over which the shore ramps from the coast to full lowland or full ocean depth.
pub const SHORE_WIDTH_PIXELS: u32 = 3;
/// Height of land three pixels inside a coast with no sculpting, in metres.
pub const LOWLAND_M: f32 = 12.0;
/// Depth of the ocean floor three pixels offshore and beyond, in metres.
pub const OCEAN_FLOOR_DEPTH_M: f32 = 4000.0;
/// Height of land at the coast line itself, in metres.
const SHORE_M: f32 = 1.0;

/// Distance in pixels from each cell to the nearest cell of the other kind (land or sea);
/// cells next to the boundary read 0.5, and a window with only one kind reads infinity.
fn distance_to_other(land: &[bool], width: usize, height: usize) -> Vec<f32> {
    let mut d = vec![f32::INFINITY; land.len()];
    let kind = |x: i64, y: i64| land[y as usize * width + x as usize];
    for y in 0..height as i64 {
        for x in 0..width as i64 {
            let here = kind(x, y);
            let differs = [(-1, 0), (1, 0), (0, -1), (0, 1)].iter().any(|&(dx, dy)| {
                let (nx, ny) = (x + dx, y + dy);
                nx >= 0
                    && ny >= 0
                    && nx < width as i64
                    && ny < height as i64
                    && kind(nx, ny) != here
            });
            if differs {
                d[y as usize * width + x as usize] = 0.5;
            }
        }
    }
    let root = std::f32::consts::SQRT_2;
    let forward = [(-1, 0, 1.0), (0, -1, 1.0), (-1, -1, root), (1, -1, root)];
    let backward = [(1, 0, 1.0), (0, 1, 1.0), (1, 1, root), (-1, 1, root)];
    let rows: Vec<i64> = (0..height as i64).collect();
    relax(&mut d, width, height, rows.iter().copied(), false, &forward);
    relax(
        &mut d,
        width,
        height,
        rows.iter().rev().copied(),
        true,
        &backward,
    );
    d
}
fn relax(
    d: &mut [f32],
    width: usize,
    height: usize,
    rows: impl Iterator<Item = i64>,
    reverse: bool,
    steps: &[(i64, i64, f32)],
) {
    for y in rows {
        let columns: Vec<i64> = if reverse {
            (0..width as i64).rev().collect()
        } else {
            (0..width as i64).collect()
        };
        for x in columns {
            for &(dx, dy, cost) in steps {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && nx < width as i64 && ny < height as i64 {
                    let via = d[ny as usize * width + nx as usize] + cost;
                    let here = &mut d[y as usize * width + x as usize];
                    *here = here.min(via);
                }
            }
        }
    }
}
fn shore_fraction(distance: f32) -> f32 {
    (distance / SHORE_WIDTH_PIXELS as f32).min(1.0)
}
/// Lowest height land can have at `distance` pixels inside the coast.
fn shore_ramp(distance: f32) -> f32 {
    SHORE_M + (LOWLAND_M - SHORE_M) * shore_fraction(distance)
}
/// Highest height sea can have at `distance` pixels off the coast.
fn offshore_ceiling(distance: f32) -> f32 {
    -(1.0 + shore_fraction(distance) * (OCEAN_FLOOR_DEPTH_M - 1.0))
}
impl Terrain {
    /// The pixels `conform` may write for `within`: it grows by the shore width plus one pixel
    /// so the transition reaches past the edit. Take the undo pre-image of this rectangle.
    pub fn conform_extent(&self, within: Option<Rect>) -> Rect {
        within.map_or(self.full(), |rect| {
            rect.grow(SHORE_WIDTH_PIXELS + 1).intersect(self.full())
        })
    }
    /// Make the grid agree with the coasts inside `within` (the whole map when `None`). Each
    /// coast is a polygon: rings in map coordinates, the outer ring first and holes after. No
    /// coasts means all ocean. Returns the bounding rectangle of the cells whose height changed.
    pub fn conform(&mut self, coasts: &[Vec<Ring>], within: Option<Rect>) -> io::Result<Rect> {
        coasts.iter().try_for_each(|rings| check_rings(rings))?;
        let rect = self.conform_extent(within);
        if rect.is_empty() {
            return Ok(Rect::default());
        }
        let mut land = vec![false; rect.area()];
        for rings in coasts {
            for (cell, inside) in land.iter_mut().zip(fill_mask(self.grid, rings, rect)) {
                *cell |= inside;
            }
        }
        let width = rect.width() as usize;
        let distance = distance_to_other(&land, width, rect.height() as usize);
        let mut changed = Rect::default();
        for row in rect.row0..rect.row1 {
            for col in rect.col0..rect.col1 {
                let at = (row - rect.row0) as usize * width + (col - rect.col0) as usize;
                let cell = self.index(col, row);
                let old = self.heights[cell];
                let new = if land[at] {
                    old.max(shore_ramp(distance[at]))
                } else {
                    old.min(offshore_ceiling(distance[at]))
                };
                if new != old {
                    self.set_clamped(cell, new);
                    changed = changed.union(Rect {
                        col0: col,
                        row0: row,
                        col1: col + 1,
                        row1: row + 1,
                    });
                }
            }
        }
        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::{grid, square};
    use super::*;

    fn island() -> Vec<Ring> {
        vec![square(100.0, 100.0, 300.0, 200.0)]
    }
    #[test]
    fn square_island_is_land_inside_and_sea_outside() {
        let mut t = Terrain::from_heights(grid(), vec![0.0; 1200]).unwrap();
        t.conform(&[island()], None).unwrap();
        for row in 0..30 {
            for col in 0..40 {
                let (x, y) = t.cell_centre(col, row);
                let land = (100.0..300.0).contains(&x) && (100.0..200.0).contains(&y);
                let h = t.heights()[t.index(col, row)];
                assert_eq!(h > 0.0, land, "cell {col},{row} is {h}");
                assert_ne!(h, 0.0);
            }
        }
        let h = |col, row| t.heights()[t.index(col, row)];
        assert!(h(10, 15) < h(12, 15) && (h(15, 15) - LOWLAND_M).abs() < 1e-4);
        assert!(h(9, 15) > h(7, 15) && h(0, 0) == -OCEAN_FLOOR_DEPTH_M);
    }
    #[test]
    fn high_ground_inside_a_coast_survives() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let peak = t.index(20, 15);
        t.set_clamped(peak, 3000.0);
        let changed = t.conform(&[island()], None).unwrap();
        assert_eq!(t.heights()[peak], 3000.0);
        assert!(changed.col0 >= 10 && changed.col1 <= 30);
    }
    #[test]
    fn a_hole_is_a_lake_below_sea_level() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let rings = vec![
            square(100.0, 100.0, 300.0, 200.0),
            square(180.0, 130.0, 220.0, 170.0),
        ];
        t.conform(&[rings], None).unwrap();
        assert!(t.heights()[t.index(20, 15)] < 0.0);
        assert!(t.heights()[t.index(14, 15)] > 0.0);
    }
    #[test]
    fn no_coasts_means_all_ocean() {
        let mut t = Terrain::from_heights(grid(), vec![500.0; 1200]).unwrap();
        let changed = t.conform(&[], None).unwrap();
        assert_eq!(changed, t.full());
        assert!(t.heights().iter().all(|&h| h <= -4000.0));
    }
    #[test]
    fn a_window_only_writes_near_itself() {
        let mut t = Terrain::from_heights(grid(), vec![9.0; 1200]).unwrap();
        let within = Rect {
            col0: 10,
            row0: 10,
            col1: 14,
            row1: 14,
        };
        let extent = t.conform_extent(Some(within));
        assert_eq!(
            extent,
            Rect {
                col0: 6,
                row0: 6,
                col1: 18,
                row1: 18
            }
        );
        let changed = t.conform(&[], Some(within)).unwrap();
        assert_eq!(changed, extent);
        assert_eq!(t.heights()[t.index(2, 2)], 9.0);
        assert!(t.heights()[t.index(12, 12)] < 0.0);
    }
    #[test]
    fn degenerate_polygons_are_refused() {
        let mut t = Terrain::ocean(grid()).unwrap();
        assert!(t
            .conform(&[vec![vec![[0.0, 0.0], [1.0, 1.0]]]], None)
            .is_err());
        assert!(t.conform(&[vec![]], None).is_err());
    }
}
