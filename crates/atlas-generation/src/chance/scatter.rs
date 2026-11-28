//! Points thrown down over a rectangle.
use super::Chance;
use atlas_map::Bounds;

/// Numbered points scattered over a rectangle, each with a rank drawn for it. A rule
/// that needs a few of many throws down more than it needs and keeps the highest
/// ranked, so asking for more keeps the ones it had: plate seeds, plume sources and
/// fracture roots are thrown this way.
#[derive(Clone, Copy, Debug)]
pub struct Scatter {
    east: Chance,
    north: Chance,
    rank: Chance,
}
impl Scatter {
    /// A scatter on a map's seed with a purpose for each of east, north and rank.
    pub const fn new(seed: i32, [east, north, rank]: [i32; 3]) -> Self {
        Self {
            east: Chance::of(seed, east),
            north: Chance::of(seed, north),
            rank: Chance::of(seed, rank),
        }
    }
    /// Where the point numbered `id` falls within `bounds`.
    pub fn position(&self, id: usize, Bounds(west, south, east, north): Bounds) -> [f64; 2] {
        let id = id as f64;
        [
            west + (east - west) * self.east.unit([id, 0.0]),
            south + (north - south) * self.north.unit([id, 1.0]),
        ]
    }
    /// The rank drawn for the point numbered `id`, from nought up to one.
    pub fn rank(&self, id: usize) -> f64 {
        self.rank.unit([id as f64, 2.0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scattered_points_cover_their_rectangle_and_keep_their_place_as_more_are_thrown() {
        let scatter = Scatter::new(12, [0x1b73, 0x2db9, 0x4a91]);
        let bounds = Bounds(100., -50., 500., 150.);
        let points: Vec<_> = (0..4_000).map(|id| scatter.position(id, bounds)).collect();
        assert!(points
            .iter()
            .all(|[x, y]| (100. ..500.).contains(x) && (-50. ..150.).contains(y)));
        // Each quarter of the rectangle takes about a quarter of the points.
        for (east, north) in [(false, false), (false, true), (true, false), (true, true)] {
            let held = points
                .iter()
                .filter(|[x, y]| (*x >= 300.) == east && (*y >= 50.) == north)
                .count();
            assert!((850..1_150).contains(&held), "{held}");
        }
        // A point's place and rank are its own: the fortieth is the same among forty
        // or four thousand.
        assert_eq!(scatter.position(39, bounds), points[39]);
        assert_eq!(scatter.rank(39), scatter.rank(39));
        assert_ne!(scatter.rank(39), scatter.rank(40));
        // Where a point falls says nothing of its rank.
        let high_ranked_east = (0..4_000)
            .filter(|id| scatter.rank(*id) > 0.5 && points[*id][0] >= 300.)
            .count();
        assert!(
            (850..1_150).contains(&high_ranked_east),
            "{high_ranked_east}"
        );
    }
}
