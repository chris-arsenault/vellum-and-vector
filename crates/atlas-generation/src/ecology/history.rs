//! Completed ecological history records; these observations do not constrain generation.
use super::Habitat;
use crate::{
    field::shared::{CellCode, Scalar as S},
    storage::ReadBand,
};
use std::io;
pub struct Summary {
    pub areas: [f64; 27],
    pub migrated: f64,
    pub burned: f64,
    pub grazers: f64,
    pub browsers: f64,
    pub predators: f64,
}
pub fn summarize(map: &Habitat<'_>) -> io::Result<Summary> {
    let mut result = Summary {
        areas: [0.0; 27],
        migrated: 0.0,
        burned: 0.0,
        grazers: 0.0,
        browsers: 0.0,
        predators: 0.0,
    };
    for cell in 0..map.mesh.len() {
        let area = map.mesh.area(cell);
        let code = map.fields.code(CellCode::BiomeCodes).get(cell)? as usize;
        let entry = result
            .areas
            .get_mut(code)
            .ok_or_else(|| io::Error::other("Unknown ecology biome"))?;
        *entry += area;
        result.migrated += map.get(S::MigrationFlux, cell)? * area;
        result.burned += map.get(S::FireActivity, cell)? * area;
        result.grazers += map.get(S::Grazers, cell)? * area;
        result.browsers += map.get(S::Browsers, cell)? * area;
        result.predators += map.get(S::Predators, cell)? * area;
    }
    Ok(result)
}
pub struct Transition {
    pub from: i32,
    pub to: i32,
    pub area: f64,
}
impl Summary {
    pub fn description(&self, years: f64, inherited: bool) -> String {
        let cover = self
            .areas
            .iter()
            .zip(super::biomes::NAMES)
            .filter(|(area, _)| **area > 0.0)
            .map(|(area, name)| format!("{name}: {:.0} km²", (area / 1e6).round()))
            .collect::<Vec<_>>()
            .join(", ");
        let duration = if inherited { 0.0 } else { years };
        let inherited = if inherited {
            " (inherited ecology is refined without replaying its age)"
        } else {
            ""
        };
        format!("{duration} years of establishment, competition, cohort growth, migration and disturbance{inherited}. {cover}. Fire-affected cover {:.0} km². Grazers/browsers/predators {:.0}/{:.0}/{:.0} kg C; migrated {:.0} kg C through reachable habitat. Soil and seed banks carry this epoch's ecological consequences forward.",
            (self.burned / 1e6).round(), self.grazers.round(), self.browsers.round(), self.predators.round(), self.migrated.round())
    }
}
pub fn describe_transitions(changes: &[Transition]) -> String {
    changes
        .iter()
        .map(|change| {
            format!(
                "{} → {}: {:.1} km²",
                super::biomes::NAMES[change.from as usize],
                super::biomes::NAMES[change.to as usize],
                change.area / 1e6
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}
pub fn transitions(map: &Habitat<'_>, before: &ReadBand<i32>) -> io::Result<Vec<Transition>> {
    let mut areas = [0.0; 27 * 27];
    let mut order = Vec::new();
    let mut seen = [false; 27 * 27];
    for cell in 0..map.mesh.len() {
        let was = before.get(cell)?;
        let now = map.fields.code(CellCode::BiomeCodes).get(cell)?;
        if was == 0 || was == now {
            continue;
        }
        if !(0..27).contains(&was) || !(0..27).contains(&now) {
            return Err(io::Error::other("Unknown ecology transition"));
        }
        let at = was as usize * 27 + now as usize;
        if !seen[at] {
            order.push(at);
            seen[at] = true;
        }
        areas[at] += map.mesh.area(cell);
    }
    Ok(order
        .into_iter()
        .map(|at| Transition {
            from: (at / 27) as i32,
            to: (at % 27) as i32,
            area: areas[at],
        })
        .collect())
}
