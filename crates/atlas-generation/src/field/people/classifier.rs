use super::work::km2;
use crate::{
    field::Field,
    hpc::group_by_label,
    human::{catalogue::LayerId, HumanField},
    storage::ReadBand,
};
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenseZone {
    pub anchor: usize,
    pub cells: Vec<usize>,
    pub town_people: f64,
    pub people: f64,
    pub built_km2: f64,
    pub works: f64,
}
pub struct RuinSite {
    pub anchor: usize,
    pub cells: Vec<usize>,
    pub ruined_km2: f64,
    pub works: f64,
    pub covered: f64,
    pub tongue: i32,
}
fn climb(
    field: &Field,
    qualifies: impl Fn(usize) -> io::Result<bool>,
    height: &ReadBand<f64>,
) -> io::Result<Vec<i32>> {
    let mut up = vec![-1; field.mesh.len()];
    for (cell, target) in up.iter_mut().enumerate() {
        if !qualifies(cell)? {
            continue;
        }
        let mut best = cell;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if qualifies(next)?
                && (height.get(next)? > height.get(best)?
                    || (height.get(next)? == height.get(best)? && next < best))
            {
                best = next;
            }
        }
        *target = best as i32;
    }
    for cell in 0..up.len() {
        if up[cell] < 0 {
            continue;
        }
        let mut top = cell;
        while up[top] != top as i32 {
            top = up[top] as usize;
        }
        let mut at = cell;
        while up[at] != top as i32 {
            let next = up[at] as usize;
            up[at] = top as i32;
            at = next;
        }
    }
    Ok(up)
}
/// Town people are the people gathered above the density of the country around them
/// (`background`, the travel-reach average). Poor ground with few people is countryside,
/// however little it feeds; a concentration on good, connected ground is a town. Cells
/// climb to their people peak; peaks that sit under one rise of the travel-reach
/// background are one gathering and form one town, anchored on its densest cell.
// Arconis: docs/architecture/subsystems.arconis#item=pp_places — finds town zones from the population and built layers.
pub fn dense_zones(
    field: &Field,
    background: &ReadBand<f64>,
    least: f64,
    people: Option<&ReadBand<f64>>,
) -> io::Result<Vec<DenseZone>> {
    let living = field.people.view(HumanField::Layer(LayerId::Population));
    let people = people.unwrap_or(&living);
    let town = |cell| Ok::<_, io::Error>((people.get(cell)? - background.get(cell)?).max(0.0));
    let qualifies = |cell| Ok(people.get(cell)? > 0.0 && town(cell)? > 0.05 * people.get(cell)?);
    let peaks = climb(field, qualifies, people)?;
    let rises = climb(field, qualifies, background)?;
    let gathering: Vec<i32> = peaks
        .iter()
        .map(|&peak| if peak < 0 { -1 } else { rises[peak as usize] })
        .collect();
    let groups = group_by_label(&gathering, field.mesh.len());
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let works = field.people.view(HumanField::Layer(LayerId::Standing));
    let mut zones = Vec::new();
    for label in 0..groups.count() {
        let cells = groups.members_of(label);
        if cells.is_empty() {
            continue;
        }
        let mut anchor = cells[0];
        for &cell in cells {
            if people.get(cell)? > people.get(anchor)? {
                anchor = cell;
            }
        }
        let mut zone = DenseZone {
            anchor,
            cells: cells.to_vec(),
            town_people: 0.0,
            people: 0.0,
            built_km2: 0.0,
            works: 0.0,
        };
        for &cell in cells {
            let area = km2(field, cell);
            zone.town_people += town(cell)? * area;
            zone.people += people.get(cell)? * area;
            zone.built_km2 += built.get(cell)? * area;
            zone.works += works.get(cell)? * area;
        }
        if zone.town_people >= least {
            zones.push(zone);
        }
    }
    // hpc-exempt: sparse classified place records, not cell ordering or storage.
    zones.sort_by(|a, b| {
        b.town_people
            .total_cmp(&a.town_people)
            .then(a.anchor.cmp(&b.anchor))
    });
    Ok(zones)
}
pub fn ruin_sites(field: &Field, least: f64) -> io::Result<Vec<RuinSite>> {
    let remains = field.people.view(HumanField::RuinedBuiltUp);
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let cover = field.people.view(HumanField::RuinCover);
    let works = field.people.view(HumanField::RuinedStanding);
    let tops = climb(
        field,
        |cell| Ok(remains.get(cell)? > built.get(cell)?),
        &remains,
    )?;
    let groups = group_by_label(&tops, field.mesh.len());
    let mut sites = Vec::new();
    for anchor in 0..groups.count() {
        let cells = groups.members_of(anchor);
        if cells.is_empty() {
            continue;
        }
        let mut ruined_km2 = 0.0;
        let mut labour = 0.0;
        let mut under = 0.0;
        for &cell in cells {
            let area = remains.get(cell)? * km2(field, cell);
            ruined_km2 += area;
            under += area * cover.get(cell)?;
            labour += works.get(cell)? * km2(field, cell);
        }
        if ruined_km2 >= least {
            sites.push(RuinSite {
                anchor,
                cells: cells.to_vec(),
                ruined_km2,
                works: labour,
                covered: under / ruined_km2,
                tongue: field.people.ruin_tongue().get(anchor)?,
            });
        }
    }
    // hpc-exempt: sparse classified ruin records, not cell ordering or storage.
    sites.sort_by(|a, b| {
        b.ruined_km2
            .total_cmp(&a.ruined_km2)
            .then(a.anchor.cmp(&b.anchor))
    });
    Ok(sites)
}
