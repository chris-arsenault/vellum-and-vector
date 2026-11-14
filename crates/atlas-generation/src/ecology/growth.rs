//! Cohorts, nutrient allocation and competition from ecologyGrowth.ts.
use super::{
    approach,
    environment::environment,
    establishment::Arrival,
    groups::{self, Group, Id, GROUPS},
    unit, Forcing, Habitat,
};
use crate::field::shared::Scalar as S;
use std::io;
pub fn logistic(value: f64, rate: f64, years: f64, capacity: f64) -> f64 {
    if rate <= 0.0 {
        return value * (rate * years).exp();
    }
    if capacity <= 0.0 || value <= 0.0 {
        return 0.0;
    }
    if value >= capacity {
        return capacity / (1.0 + (capacity / value - 1.0) * (-rate * years).exp());
    }
    let odds = (capacity - value).ln() - value.ln() - rate * years;
    if odds > 0.0 {
        capacity * (-odds).exp() / (1.0 + (-odds).exp())
    } else {
        capacity / (1.0 + odds.exp())
    }
}
struct Proposal {
    group: &'static Group,
    cover: f64,
    mortality: f64,
    available: f64,
    elapsed: f64,
    mature: f64,
    young: f64,
    retained: f64,
    quickening: f64,
    stillness: f64,
}
fn proposal(
    map: &Habitat<'_>,
    arrival: &Arrival,
    cell: usize,
    years: f64,
    f: &Forcing,
) -> io::Result<Proposal> {
    let group = arrival.group;
    let previous = groups::plant_cover(map, group, cell)?;
    let available = if previous > 0.00001 {
        years
    } else {
        (years - arrival.front.time.get(cell)?).max(0.0)
    };
    let seed = if available > 0.0 {
        0.001 * map.get(group.seed, cell)?.max(0.01 + 0.3 * f.verdure)
    } else {
        0.0
    };
    let suitable = groups::suitability(map, group, cell, f)?;
    let browsing = if group.juvenile.is_some() {
        map.get(S::Browsers, cell)? * 0.7
    } else {
        map.get(S::Grazers, cell)? * 2.0
    };
    let toxicity = map.get(S::EcologicalToxicity, cell)? * 0.02;
    let fire = map.get(S::FireActivity, cell)?
        * f.fire_regime
        * if group.id == Id::Grass { 0.003 } else { 0.025 };
    let flood = map.get(S::FloodFrequency, cell)? * group.flood_sensitivity;
    let turnover = (1.0 + 3.0 * f.quickening) * (1.0 - 0.85 * f.stillness);
    let mortality = turnover / group.lifespan
        + (1.0 - suitable) / 100.0
        + browsing
        + toxicity
        + fire
        + flood
        + 0.05 * f.salting;
    let rate = 2.0 / group.maturity
        * suitable
        * (1.0 + f.growth).max(0.0)
        * f.productivity
        * (1.0 + 2.0 * f.quickening)
        * (1.0 - 0.7 * f.stillness)
        * (1.0 + f.verdure)
        * (1.0 - 0.8 * f.salting)
        - mortality;
    Ok(Proposal {
        group,
        cover: logistic(previous.max(seed), rate, available, suitable),
        mortality,
        available,
        elapsed: years,
        mature: 0.0,
        young: 0.0,
        retained: 0.0,
        quickening: f.quickening,
        stillness: f.stillness,
    })
}
fn competition(proposals: &mut [Proposal]) {
    let pressure: f64 = proposals
        .iter()
        .filter(|p| p.group.juvenile.is_some())
        .map(|p| p.cover)
        .sum();
    for p in proposals.iter_mut().filter(|p| p.group.id == Id::Grass) {
        p.cover *= (-pressure * 1.5).exp();
    }
    let total: f64 = proposals.iter().map(|p| p.cover).sum();
    if total > 1.0 {
        for p in proposals {
            p.cover /= total;
        }
    }
}
fn prepare(map: &Habitat<'_>, cell: usize, p: &mut Proposal) -> io::Result<()> {
    if p.group.juvenile.is_none() {
        p.mature = p.cover;
        return Ok(());
    }
    let survivors = p
        .cover
        .min(map.get(p.group.cover, cell)? * (-p.mortality * p.available).exp());
    p.retained = survivors;
    p.mature = survivors + (p.cover - survivors) * -(-p.available / p.group.maturity).exp_m1();
    p.young = (p.cover - p.mature).max(0.0);
    Ok(())
}
fn proposed_carbon(p: &Proposal) -> f64 {
    (p.mature + p.young * 0.2) * p.group.mass
}
fn cohort_carbon(map: &Habitat<'_>, cell: usize, group: &Group) -> io::Result<f64> {
    Ok((map.get(group.cover, cell)?
        + group.juvenile.map_or(Ok(0.0), |name| map.get(name, cell))? * 0.2)
        * group.mass)
}
fn nutrients(map: &mut Habitat<'_>, cell: usize, proposals: &mut [Proposal]) -> io::Result<()> {
    let mut required = 0.0;
    for p in proposals.iter_mut() {
        prepare(map, cell, p)?;
        required +=
            (proposed_carbon(p) - cohort_carbon(map, cell, p.group)?).max(0.0) / p.group.nitrogen;
    }
    let uptake = map.get(S::MineralNutrients, cell)?.min(required);
    let fraction = if required > 0.0 {
        uptake / required
    } else {
        1.0
    };
    for p in proposals {
        if proposed_carbon(p) <= cohort_carbon(map, cell, p.group)? {
            continue;
        }
        let mature = map.get(p.group.cover, cell)?;
        p.mature = mature + (p.mature - mature) * fraction;
        let young = p
            .group
            .juvenile
            .map_or(Ok(0.0), |name| map.get(name, cell))?;
        p.young = young + (p.young - young) * fraction;
        p.cover = p.mature + p.young;
    }
    map.add(S::MineralNutrients, cell, -uptake)
}
fn grow_cohort(map: &mut Habitat<'_>, cell: usize, p: &Proposal) -> io::Result<()> {
    let group = p.group;
    let before = cohort_carbon(map, cell, group)?;
    map.set(group.cover, cell, p.mature)?;
    if let Some(young) = group.juvenile {
        map.set(young, cell, p.young)?;
    }
    map.add(
        S::SoilCarbon,
        cell,
        (before - cohort_carbon(map, cell, group)?).max(0.0),
    )?;
    let viability = if p.cover > 0.0001 {
        unit(map.get(group.cover, cell)? * 0.3)
    } else {
        0.0
    };
    let seeding = if group.juvenile.is_some() { 80.0 } else { 20.0 }
        / ((1.0 + 2.0 * p.quickening) * (1.0 - 0.9 * p.stillness)).max(0.05);
    map.set(
        group.seed,
        cell,
        approach(map.get(group.seed, cell)?, viability, p.elapsed, seeding),
    )
}
pub fn update_tree_cover(map: &mut Habitat<'_>, cell: usize) -> io::Result<()> {
    map.set(
        S::TreeCover,
        cell,
        unit(
            groups::canopy(map, cell)?
                + (map.get(S::BroadleafSaplings, cell)? + map.get(S::ConiferSaplings, cell)?)
                    * 0.35,
        ),
    )
}
pub type Restore<'a> = dyn Fn(&mut Habitat<'_>, usize) -> io::Result<()> + 'a;
pub fn grow(
    map: &mut Habitat<'_>,
    years: f64,
    arrivals: &[Arrival],
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
    restore: &Restore<'_>,
    advance_age: bool,
) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        let f = forcing(cell)?;
        let e = environment(map, cell, &f)?;
        let mut proposals = arrivals
            .iter()
            .map(|arrival| proposal(map, arrival, cell, years, &f))
            .collect::<io::Result<Vec<_>>>()?;
        competition(&mut proposals);
        nutrients(map, cell, &mut proposals)?;
        for p in &proposals {
            grow_cohort(map, cell, p)?;
        }
        update_tree_cover(map, cell)?;
        restore(map, cell)?;
        if advance_age {
            canopy_age(map, cell, years, &proposals)?;
        }
        productivity(map, cell, &f)?;
        let light = (-e.depth / map.length(0.000025)?).exp();
        let wet = e.water > 0 || e.wetness > 0.5;
        let nutrients = 1.0 + 1.5 * map.get(S::Upwelling, cell)? / 1000.0;
        map.set(
            S::AquaticProductivity,
            cell,
            if wet && !e.frozen {
                0.18 * e.warmth * light * nutrients * f.productivity
            } else {
                0.0
            },
        )?;
    }
    Ok(())
}
fn productivity(map: &mut Habitat<'_>, cell: usize, f: &Forcing) -> io::Result<()> {
    let mut amount = 0.0;
    for group in &GROUPS {
        amount += groups::suitability(map, group, cell, f)?
            * groups::plant_cover(map, group, cell)?
            * if group.juvenile.is_some() { 0.65 } else { 0.4 };
    }
    map.set(
        S::Productivity,
        cell,
        amount
            * f.productivity
            * (1.0 + f.growth).max(0.0)
            * (1.0 + f.quickening)
            * (1.0 - 0.5 * f.stillness)
            * (1.0 - 0.8 * f.salting),
    )
}
fn canopy_age(
    map: &mut Habitat<'_>,
    cell: usize,
    years: f64,
    proposals: &[Proposal],
) -> io::Result<()> {
    let age = map.get(S::CanopyAge, cell)?;
    let mut weighted = 0.0;
    for p in proposals.iter().filter(|p| p.group.juvenile.is_some()) {
        let cover = map.get(p.group.cover, cell)?;
        let retained = cover.min(p.retained);
        weighted +=
            retained * (age + years) + (cover - retained) * (years / 2.0).min(1.0 / p.mortality);
    }
    let total = groups::canopy(map, cell)?;
    map.set(
        S::CanopyAge,
        cell,
        if total > 0.0 { weighted / total } else { 0.0 },
    )
}
pub fn normalize(map: &mut Habitat<'_>, cell: usize) -> io::Result<()> {
    let mut total = 0.0;
    for group in &GROUPS {
        total += groups::plant_cover(map, group, cell)?;
    }
    if total <= 1.0 {
        return Ok(());
    }
    for group in &GROUPS {
        map.set(group.cover, cell, map.get(group.cover, cell)? / total)?;
        if let Some(young) = group.juvenile {
            map.set(young, cell, map.get(young, cell)? / total)?;
        }
    }
    Ok(())
}
pub fn authoritative_canopy(map: &mut Habitat<'_>, cell: usize, requested: f64) -> io::Result<()> {
    update_tree_cover(map, cell)?;
    let represented = map.get(S::TreeCover, cell)?;
    if represented == 0.0 {
        map.set(S::BroadleafCover, cell, requested)?;
    } else {
        for group in GROUPS.iter().filter(|g| g.juvenile.is_some()) {
            map.set(
                group.cover,
                cell,
                map.get(group.cover, cell)? * requested / represented,
            )?;
            if let Some(young) = group.juvenile {
                map.set(young, cell, map.get(young, cell)? * requested / represented)?;
            }
        }
    }
    map.set(S::TreeCover, cell, requested)
}
