use super::{
    catalogue::{Activity, PlaceRules},
    fabric::{Holding, Town},
};
use crate::spatial::SpatialKernel;
use atlas_map::Bounds;
use std::io;

/// Read overlapping neighbourhoods from the occupied premises within a short walk.
pub fn characters(town: &Town, spatial: &dyn SpatialKernel) -> io::Result<Vec<&'static str>> {
    let shapes: Vec<_> = town.holdings().iter().map(|h| h.outline.clone()).collect();
    let index = spatial.index(&shapes).map_err(io::Error::other)?;
    town.holdings()
        .iter()
        .map(|home| {
            let [x, y] = home.slot.front;
            let radius = 60.;
            let mut mix = Occupation::default();
            for i in index
                .query(Bounds(x - radius, y - radius, x + radius, y + radius))
                .map_err(io::Error::other)?
            {
                let h = &town.holdings()[i];
                let distance = spatial
                    .distance(&home.outline, &h.outline)
                    .map_err(io::Error::other)?;
                let weight = (1. - distance / radius).max(0.) * h.occupation;
                mix.include(h, weight);
            }
            Ok(mix.character())
        })
        .collect()
}
#[derive(Default)]
struct Occupation {
    activity: [f64; 7],
    crowded: f64,
    means: f64,
    weight: f64,
    enclosed: f64,
}
impl Occupation {
    fn include(&mut self, h: &Holding, weight: f64) {
        self.weight += weight;
        self.means += weight * h.means;
        self.crowded += weight * h.crowding * (1. - h.condition * 0.5);
        if h.institution.is_some() {
            self.enclosed += weight;
        }
        for kind in std::iter::once(h.kind).chain(h.secondary) {
            self.activity[kind.definition().activity as usize] += weight;
        }
    }
    fn character(&self) -> &'static str {
        let share = |a: Activity| self.activity[a as usize] / self.weight.max(0.001);
        if self.weight < 0.2 {
            return "scattered premises";
        }
        if self.enclosed > self.weight * 0.25 || share(Activity::Institution) > 0.4 {
            return "institutional precinct";
        }
        if share(Activity::Agriculture) > 0.3 {
            return "working farm fringe";
        }
        if self.crowded > self.weight * 0.25 && self.means < self.weight * 0.46 {
            return "crowded household courts";
        }
        if share(Activity::Production) > 0.3 {
            return "workshop quarter";
        }
        if share(Activity::Trade) + share(Activity::Hospitality) > 0.4 {
            return "commercial frontage";
        }
        if self.means > self.weight * 0.63 {
            return "prosperous household quarter";
        }
        "mixed household streets"
    }
}
