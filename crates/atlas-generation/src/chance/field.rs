//! Chance that varies smoothly over the ground at many scales at once.
use super::Chance;
use crate::{
    lattice::TriangularLattice,
    noise::{fractal_noise, mesh_noise, unit_noise, world_noise},
};

/// A many-scaled noise field. `scale` is the distance over which its broadest swell
/// turns; each further octave adds swells half as broad and half as strong, so a field
/// of many octaves is rough at every scale down to its finest. Read with the same
/// purpose it is the same field everywhere, which is how two rules can read one field.
#[derive(Clone, Copy, Debug)]
pub struct Noise {
    salt: i32,
    scale: f64,
    octaves: usize,
}
impl Noise {
    pub const fn new(chance: Chance, scale: f64, octaves: usize) -> Self {
        Self {
            salt: chance.0,
            scale,
            octaves,
        }
    }
    /// The field at a point, from minus one to one. A rule may read it along a slope or
    /// a range by turning or stretching the point it asks for.
    pub fn signed(&self, [x, y]: [f64; 2]) -> f64 {
        fractal_noise(x, y, self.salt, self.scale, self.octaves)
    }
    /// The field at a point, from nought to one.
    pub fn unit(&self, [x, y]: [f64; 2]) -> f64 {
        unit_noise(x, y, self.salt, self.scale, self.octaves)
    }
    /// The field at a point of `mesh`, in the mesh's own positions, joined across the
    /// seam of a world that wraps round.
    pub fn on(&self, mesh: &TriangularLattice, [x, y]: [f64; 2]) -> f64 {
        mesh_noise(mesh, x, y, self.salt, self.scale, self.octaves)
    }
    /// The field at a point of the world as a map on `mesh` sees it: joined across the
    /// seam where the map is the whole world, and the same field on any map opened
    /// inside it.
    pub fn across(&self, mesh: &TriangularLattice, [x, y]: [f64; 2]) -> f64 {
        world_noise(mesh, x, y, self.salt, self.scale, self.octaves)
    }
}

/// Folds a field about its middle so its swells meet in sharp crests: coasts cut by
/// ridged noise have headlands and coves where plain noise gives a gentle wobble.
pub fn ridged(value: f64) -> f64 {
    2.0 * value.abs() - 1.0
}

/// Two noise fields that pull a point east and north. A rule reads its ground, or lays
/// its shapes, at the pulled point, so straight edges wander and stay joined: province
/// edges, the parent surface a finer map samples, and river courses carried onto a
/// finer map are all bent this way. Each pull is from minus one to one; the rule says
/// how far that carries the point.
#[derive(Clone, Copy, Debug)]
pub struct Warp {
    pub east: Noise,
    pub north: Noise,
}
impl Warp {
    /// Two fields of one scale and roughness, each with its own purpose.
    pub const fn new([east, north]: [Chance; 2], scale: f64, octaves: usize) -> Self {
        Self {
            east: Noise::new(east, scale, octaves),
            north: Noise::new(north, scale, octaves),
        }
    }
    pub fn pull(&self, point: [f64; 2]) -> [f64; 2] {
        [self.east.signed(point), self.north.signed(point)]
    }
    /// The pull at a point of `mesh`, joined across the seam of a world that wraps.
    pub fn pull_on(&self, mesh: &TriangularLattice, point: [f64; 2]) -> [f64; 2] {
        [self.east.on(mesh, point), self.north.on(mesh, point)]
    }
}

/// Ground that something spreading finds easy in patches and hard between them. Where
/// the field lies under `open` the ground resists as `easy`; elsewhere it resists from
/// the first of `hard` to the second as the field rises. A flood or a front that pays
/// this resistance finds its way through the patches, so on flat ground where nothing
/// else tells it where to go it wanders instead of running straight.
#[derive(Clone, Copy, Debug)]
pub struct Corridors {
    pub noise: Noise,
    pub open: f64,
    pub easy: f64,
    pub hard: [f64; 2],
}
impl Corridors {
    /// The resistance where the field, from nought to one, reads `value`.
    pub fn resistance(&self, value: f64) -> f64 {
        if value < self.open {
            self.easy
        } else {
            self.hard[0] + (self.hard[1] - self.hard[0]) * value
        }
    }
    /// The resistance at a point of the world as a map on `mesh` sees it.
    pub fn across(&self, mesh: &TriangularLattice, point: [f64; 2]) -> f64 {
        self.resistance((self.noise.across(mesh, point) + 1.0) * 0.5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(count: usize) -> impl Iterator<Item = [f64; 2]> {
        (0..count).map(|n| {
            let n = n as f64;
            [n * 37.1 % 9_000., n * 53.7 % 7_000.]
        })
    }
    /// How much a field differs between points `apart` from each other, on average.
    fn difference(noise: &Noise, apart: f64) -> f64 {
        points(2_000)
            .map(|[x, y]| (noise.signed([x, y]) - noise.signed([x + apart, y])).abs())
            .sum::<f64>()
            / 2_000.
    }

    #[test]
    fn a_field_is_alike_nearby_and_unlike_far_off() {
        let noise = Chance::of(4, 0x52c9).noise(1_000., 3);
        assert!(points(2_000).all(|p| (-1. ..=1.).contains(&noise.signed(p))));
        assert!(points(2_000).all(|p| (0. ..=1.).contains(&noise.unit(p))));
        let (near, far) = (difference(&noise, 20.), difference(&noise, 5_000.));
        assert!(near * 8. < far, "{near} {far}");
        // Another purpose is another field.
        let other = Chance::of(4, 0x52ca).noise(1_000., 3);
        let same = points(500)
            .filter(|p| (noise.signed(*p) - other.signed(*p)).abs() < 0.01)
            .count();
        assert!(same < 50, "{same}");
    }

    #[test]
    fn more_octaves_keep_a_field_turning_at_small_distances() {
        // The octaves share one field's range, so more of them do not make it swing
        // wider. They move its variety toward small distances: how much nearby points
        // differ grows beside how much far-off points do.
        let nearness = |octaves| {
            let noise = Chance::of(4, 0x5ee1).noise(1_000., octaves);
            difference(&noise, 30.) / difference(&noise, 5_000.)
        };
        let (smooth, rough) = (nearness(1), nearness(5));
        assert!(rough > 1.4 * smooth, "{smooth} {rough}");
    }

    #[test]
    fn ridging_makes_crests_where_a_field_crosses_its_middle() {
        assert_eq!(ridged(0.), -1.);
        assert_eq!(ridged(1.), 1.);
        assert_eq!(ridged(-1.), 1.);
        assert_eq!(ridged(0.5), ridged(-0.5));
    }

    #[test]
    fn a_warp_pulls_neighbours_alike_and_each_way_on_its_own() {
        let warp = Warp::new([Chance::of(8, 0x16f1), Chance::of(8, 0x62bd)], 2_000., 3);
        let pulls: Vec<_> = points(1_000).map(|p| (p, warp.pull(p))).collect();
        assert!(pulls
            .iter()
            .all(|(_, pull)| pull.iter().all(|way| (-1. ..=1.).contains(way))));
        let near = pulls
            .iter()
            .map(|([x, y], pull)| (warp.pull([x + 15., *y])[0] - pull[0]).abs())
            .sum::<f64>()
            / 1_000.;
        assert!(near < 0.03, "{near}");
        // East and north are different fields.
        let alike = pulls
            .iter()
            .filter(|(_, pull)| (pull[0] - pull[1]).abs() < 0.01)
            .count();
        assert!(alike < 100, "{alike}");
    }

    #[test]
    fn corridors_are_easy_in_patches_and_far_harder_between() {
        let corridors = |open| Corridors {
            noise: Chance::of(2, 0x1f7d).noise(600., 2),
            open,
            easy: 1.,
            hard: [12., 19.],
        };
        assert_eq!(corridors(0.37).resistance(0.2), 1.);
        assert_eq!(corridors(0.37).resistance(1.), 19.);
        assert!(corridors(0.37).resistance(0.4) > 12.);
        // A wider opening leaves more of the ground easy.
        let easy = |open: f64| {
            let corridors = corridors(open);
            points(4_000)
                .filter(|p| corridors.resistance(corridors.noise.unit(*p)) <= 1.)
                .count()
        };
        let (narrow, usual, wide) = (easy(0.3), easy(0.37), easy(0.5));
        assert!(narrow < usual && usual < wide, "{narrow} {usual} {wide}");
        assert!(narrow > 50 && wide < 3_900, "{narrow} {wide}");
        // Easy ground comes in patches: a neighbour of easy ground is mostly easy too.
        let patchy = corridors(0.37);
        let open = |p: [f64; 2]| patchy.resistance(patchy.noise.unit(p)) <= 1.;
        let easy_points: Vec<_> = points(4_000).filter(|p| open(*p)).collect();
        let beside = easy_points
            .iter()
            .filter(|[x, y]| open([x + 30., *y]))
            .count();
        assert!(
            beside * 10 > easy_points.len() * 8,
            "{beside} of {}",
            easy_points.len()
        );
    }
}
