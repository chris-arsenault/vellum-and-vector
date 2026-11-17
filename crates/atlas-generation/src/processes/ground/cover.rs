//! Single plants and stones on maps fine enough to show them. Each triangle holds as many of
//! each kind as its share of that cover and the kind's density say, scattered so no two of a
//! kind stand closer than the kind's spacing (Poisson-disc sampling), each at a real size with
//! a long tail between the least, typical and largest sizes the catalogue gives its kind.
use super::{
    distance,
    settings::{ObjectKind, ATTEMPTS, OBJECTS},
};
use crate::{
    field::poi::true_sizes::{long_tail, Ladder},
    publication::catalogue::true_size,
};
use std::io;

/// The cover a kind of object stands in, in the order of `settings::OBJECTS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cover {
    /// Trees in forest and woodland.
    Trees,
    /// Shrubs in scrub.
    Scrub,
    /// Boulders on scree and outcrop.
    Stone,
    /// Reeds in wetland.
    Reeds,
}
impl Cover {
    pub const ALL: [Self; 4] = [Self::Trees, Self::Scrub, Self::Stone, Self::Reeds];
    pub fn kind(self) -> &'static ObjectKind {
        &OBJECTS[self as usize]
    }
    /// The kind's real size across, as the catalogue declares it for the objects layer.
    pub fn across(self) -> io::Result<Ladder> {
        let kind = self.kind().kind;
        let size = true_size("objects", kind).ok_or_else(|| {
            io::Error::other(format!("The catalogue gives no size for objects:{kind}"))
        })?;
        Ok(Ladder {
            least: size.least,
            typical: size.typical,
            largest: size.largest,
        })
    }
}
/// One triangle and its share of each cover, in the order of `Cover::ALL`.
pub struct Patch {
    pub cell: usize,
    pub corners: [[f64; 2]; 3],
    pub shares: [f64; 4],
}
#[derive(Clone, Debug, PartialEq)]
pub struct Object {
    pub cover: Cover,
    pub cell: usize,
    pub position: [f64; 2],
    /// Metres across.
    pub across: f64,
}
/// A stable draw in [0, 1) from a triangle, a kind and a try.
fn draw(seed: u64, cell: usize, kind: usize, at: u64) -> f64 {
    let mut x = seed
        ^ (cell as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ (kind as u64 + 1).wrapping_mul(0xbf58_476d_1ce4_e5b9)
        ^ at.wrapping_mul(0x94d0_49bb_1331_11eb);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^= x >> 31;
    (x >> 11) as f64 / (1u64 << 53) as f64
}
fn area([a, b, c]: [[f64; 2]; 3]) -> f64 {
    ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs() / 2.0
}
/// A uniform point inside a triangle from two draws.
fn inside([a, b, c]: [[f64; 2]; 3], u: f64, v: f64) -> [f64; 2] {
    let r = u.sqrt();
    let (wa, wb, wc) = (1.0 - r, r * (1.0 - v), r * v);
    [
        wa * a[0] + wb * b[0] + wc * c[0],
        wa * a[1] + wb * b[1] + wc * c[1],
    ]
}
/// Placed objects of one kind, bucketed by the kind's spacing so a candidate checks only the
/// buckets around it.
struct Placed {
    spacing: f64,
    origin: [f64; 2],
    columns: usize,
    rows: usize,
    heads: Vec<u32>,
    next: Vec<u32>,
    points: Vec<[f64; 2]>,
}
impl Placed {
    fn new(spacing: f64, bounds: [f64; 4]) -> Self {
        let columns = ((bounds[2] - bounds[0]) / spacing).ceil() as usize + 1;
        let rows = ((bounds[3] - bounds[1]) / spacing).ceil() as usize + 1;
        Self {
            spacing,
            origin: [bounds[0], bounds[1]],
            columns,
            rows,
            heads: vec![u32::MAX; columns * rows],
            next: Vec::new(),
            points: Vec::new(),
        }
    }
    fn bucket(&self, p: [f64; 2]) -> (usize, usize) {
        let column = ((p[0] - self.origin[0]) / self.spacing).floor().max(0.0) as usize;
        let row = ((p[1] - self.origin[1]) / self.spacing).floor().max(0.0) as usize;
        (column.min(self.columns - 1), row.min(self.rows - 1))
    }
    fn clear(&self, p: [f64; 2]) -> bool {
        let (column, row) = self.bucket(p);
        for r in row.saturating_sub(1)..=(row + 1).min(self.rows - 1) {
            for c in column.saturating_sub(1)..=(column + 1).min(self.columns - 1) {
                let mut at = self.heads[r * self.columns + c];
                while at != u32::MAX {
                    if distance(self.points[at as usize], p) < self.spacing {
                        return false;
                    }
                    at = self.next[at as usize];
                }
            }
        }
        true
    }
    fn add(&mut self, p: [f64; 2]) {
        let (column, row) = self.bucket(p);
        let bucket = row * self.columns + column;
        self.next.push(self.heads[bucket]);
        self.heads[bucket] = self.points.len() as u32;
        self.points.push(p);
    }
}
fn bounds(patches: &[Patch]) -> [f64; 4] {
    patches.iter().flat_map(|p| p.corners).fold(
        [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ],
        |[w, s, e, n], [x, y]| [w.min(x), s.min(y), e.max(x), n.max(y)],
    )
}
/// How many objects of a kind a triangle holds: its expected number, with the fraction
/// settled by a draw.
fn count(share: f64, area: f64, kind: &ObjectKind, roll: f64) -> usize {
    let expected = share * area * kind.density;
    expected.floor() as usize + usize::from(roll < expected.fract())
}
/// Every object the triangles' cover holds.
pub fn scatter(patches: &[Patch], seed: u64) -> io::Result<Vec<Object>> {
    if patches.is_empty() {
        return Ok(Vec::new());
    }
    let sizes = Cover::ALL
        .iter()
        .map(|cover| cover.across())
        .collect::<io::Result<Vec<_>>>()?;
    let frame = bounds(patches);
    let mut placed: Vec<Placed> = Cover::ALL
        .iter()
        .map(|cover| Placed::new(cover.kind().spacing, frame))
        .collect();
    let mut objects = Vec::new();
    for patch in patches {
        let size = area(patch.corners);
        for (k, &cover) in Cover::ALL.iter().enumerate() {
            let kind = cover.kind();
            let wanted = count(patch.shares[k], size, kind, draw(seed, patch.cell, k, 0));
            let mut made = 0;
            for attempt in 0..(wanted * ATTEMPTS) as u64 {
                if made == wanted {
                    break;
                }
                let at = 3 * attempt + 1;
                let point = inside(
                    patch.corners,
                    draw(seed, patch.cell, k, at),
                    draw(seed, patch.cell, k, at + 1),
                );
                if !placed[k].clear(point) {
                    continue;
                }
                placed[k].add(point);
                made += 1;
                objects.push(Object {
                    cover,
                    cell: patch.cell,
                    position: point,
                    across: long_tail(draw(seed, patch.cell, k, at + 2), &sizes[k]),
                });
            }
        }
    }
    Ok(objects)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A square field of side `side` metres cut into two triangles per square metre.
    fn field(side: usize, shares: [f64; 4]) -> Vec<Patch> {
        let mut patches = Vec::new();
        for y in 0..side {
            for x in 0..side {
                let (x, y) = (x as f64, y as f64);
                for corners in [
                    [[x, y], [x + 1.0, y], [x, y + 1.0]],
                    [[x + 1.0, y], [x + 1.0, y + 1.0], [x, y + 1.0]],
                ] {
                    patches.push(Patch {
                        cell: patches.len(),
                        corners,
                        shares,
                    });
                }
            }
        }
        patches
    }
    #[test]
    fn no_two_of_a_kind_stand_closer_than_their_spacing() {
        let objects = scatter(&field(40, [1.0, 1.0, 0.0, 0.0]), 7).unwrap();
        for cover in [Cover::Trees, Cover::Scrub] {
            let kind: Vec<_> = objects.iter().filter(|o| o.cover == cover).collect();
            assert!(!kind.is_empty());
            for (i, a) in kind.iter().enumerate() {
                for b in &kind[i + 1..] {
                    assert!(distance(a.position, b.position) >= cover.kind().spacing);
                }
            }
        }
    }
    #[test]
    fn density_follows_the_cover_share() {
        // Thin cover stands far below the spacing's limit, so its count follows its share
        // within three standard deviations of the drawn count. Denser cover is thinned by the
        // spacing, so it holds more objects but fewer than its share alone would.
        let count = |share: f64| {
            scatter(&field(150, [share, 0.0, 0.0, 0.0]), 3)
                .unwrap()
                .len() as f64
        };
        let expected = 0.05 * 150.0 * 150.0 * Cover::Trees.kind().density;
        let thin = count(0.05);
        assert!(
            (thin - expected).abs() < 3.0 * expected.sqrt(),
            "{thin} against {expected}"
        );
        let (half, full) = (count(0.5), count(1.0));
        assert!(thin < half && half < full && full < 20.0 * expected);
        assert!(scatter(&field(20, [0.0; 4]), 3).unwrap().is_empty());
    }
    #[test]
    fn every_object_stands_within_its_catalogue_size() {
        let objects = scatter(&field(60, [1.0, 1.0, 1.0, 1.0]), 5).unwrap();
        for cover in Cover::ALL {
            let size = true_size("objects", cover.kind().kind).unwrap();
            let kind: Vec<_> = objects.iter().filter(|o| o.cover == cover).collect();
            assert!(!kind.is_empty());
            assert!(kind
                .iter()
                .all(|o| o.across >= size.least && o.across <= size.largest));
        }
    }
    #[test]
    fn sizes_have_a_long_tail() {
        let objects = scatter(&field(60, [1.0, 0.0, 0.0, 0.0]), 11).unwrap();
        let ladder = &Cover::Trees.across().unwrap();
        assert!(objects
            .iter()
            .all(|o| o.across >= ladder.least && o.across <= ladder.largest));
        let mut sizes: Vec<f64> = objects.iter().map(|o| o.across).collect();
        // hpc-exempt: a test's few hundred sizes.
        sizes.sort_by(f64::total_cmp);
        let median = sizes[sizes.len() / 2];
        assert!(median <= 1.2 * ladder.typical && sizes[sizes.len() - 1] > 2.0 * median);
    }
}
