// Arconis: docs/architecture/subsystems.arconis#item=c_season — answers crop and herd yields from what the land feeds.
use super::{
    contract::{Dispatch, MapType, Rule, Timing},
    facts::LEAST_WILD,
    travel::length,
};
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionResult, Query, QueryDependency},
    field::{shared::Scalar as S, Field},
    human::{catalogue::LayerId, HumanField},
    rock::ground::GroundField,
    storage::ReadBand,
    water::{column::Store, soil},
};
use std::io;

#[derive(Clone, Copy)]
enum HarvestBasis {
    CurrentYield,
    SurveyedFarms,
}

const SUPPORT: Dispatch<HarvestBasis> = Dispatch {
    id: "support",
    rules: &[
        Rule::new(MapType::WORLD, Some(HarvestBasis::CurrentYield)),
        Rule::new(MapType::REFINED, Some(HarvestBasis::SurveyedFarms)),
    ],
};

/// Residents fed per cultivated square kilometre. Intensive farming needs
/// the soil, water, season and workable terrain to coincide on the same land.
// owner-direction(2026-11-19): use exaggerated realism for population bands, with 300-500k capitals and exceptional cities around 2 million.
pub(super) fn cultivated_yield(suitability: f64) -> f64 {
    const EXTENSIVE: f64 = 35.0;
    const INTENSIVE: f64 = 420.0;
    suitability * (EXTENSIVE + INTENSIVE * suitability)
}

/// Occupied farmland produces a harvest only over the area its households can work.
/// The demographic model assigns two hectares of field work per rural resident.
fn worked_farmland(farmland: f64, residents_per_km2: f64) -> f64 {
    const FARM_KM2_PER_RESIDENT: f64 = 0.02;
    farmland.min(residents_per_km2 * FARM_KM2_PER_RESIDENT)
}

/// Present agricultural evidence from the captured parent. Land that stays farmed can
/// realize its surveyed harvest where the local terrain and season can support it.
pub(in crate::field) struct Harvest {
    pub food: ReadBand<f64>,
    pub farmland: ReadBand<f64>,
    pub residents: ReadBand<f64>,
}

fn harvest(field: &Field, cell: usize, farmed: f64, crop: f64) -> io::Result<f64> {
    let mut food = farmed * crop;
    let basis = SUPPORT.select(field.process_site(), Timing::Present)?;
    if let (Some(HarvestBasis::SurveyedFarms), Some(survey)) = (basis, &field.harvest) {
        let before = worked_farmland(survey.farmland.get(cell)?, survey.residents.get(cell)?);
        let existing = before.min(farmed);
        if existing > 0.0 {
            let wet = crop_factors(field, cell, 1.0)?;
            let potential = cultivated_yield(wet.suitability()) * wet.quickened;
            let surveyed = survey.food.get(cell)? / before;
            // Coarse support includes other livelihoods. This estimate uses it only on
            // still-worked farmland and never beyond what these crops could yield.
            food += existing * (surveyed.min(potential) - crop).max(0.0);
        }
    }
    Ok(food)
}

fn read(field: &Field, name: S, cell: usize) -> io::Result<f64> {
    field.shared.scalar(name).get(cell)
}
fn human(field: &Field, id: LayerId, cell: usize) -> io::Result<f64> {
    field.people.view(HumanField::Layer(id)).get(cell)
}
/// The share of a cell people do not keep under fields, pasture or buildings.
fn wild_share(field: &Field, cell: usize) -> io::Result<f64> {
    Ok((1.0
        - human(field, LayerId::Farmland, cell)?
        - human(field, LayerId::Pasture, cell)?
        - human(field, LayerId::BuiltUp, cell)?)
    .clamp(0.0, 1.0))
}
/// A cover the living land reports over a whole cell, as it stands on the part of the cell
/// it can grow on: the land's cover already falls with the ground people keep, so food read
/// per share of ground must not count that loss again.
fn on_share(cover: f64, share: f64) -> f64 {
    (cover / share.max(LEAST_WILD)).clamp(0.0, 1.0)
}
/// What each way of living gives on a cell, per km² of the cell: farming, herding, fishing and
/// gathering, from the yields of its crops, herds, wild ground and catch as its ground is used.
pub fn ways_of_living(field: &Field, cell: usize, yields: [f64; 4]) -> io::Result<[f64; 4]> {
    let [crop, herd, wild, catch] = yields;
    let farmed = worked_farmland(
        human(field, LayerId::Farmland, cell)?,
        field.people.people(cell)?,
    );
    let open = wild_share(field, cell)?;
    Ok([
        harvest(field, cell, farmed, crop.max(0.0))?,
        human(field, LayerId::Pasture, cell)? * herd.max(0.0),
        open * catch.max(0.0),
        open * (wild - catch).max(0.0),
    ])
}
/// What the woods and game give per km² of wild ground, before ice.
fn gathered(field: &Field, cell: usize) -> io::Result<f64> {
    let wild = wild_share(field, cell)?;
    Ok(2.0
        * on_share(read(field, S::TreeCover, cell)?, wild)
        * (3.0 * read(field, S::Productivity, cell)?.max(0.0) / wild.max(LEAST_WILD)).min(1.0)
        + 2.0 * read(field, S::Herbivores, cell)? / wild.max(LEAST_WILD))
}
fn ice_free(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(1.0 - (read(field, S::IceThickness, cell)? / length(field, 0.00025)?).min(1.0))
}
fn quickened(field: &Field, cell: usize, stilled: f64) -> io::Result<f64> {
    Ok((1.0 + 0.5 * read(field, S::Quickening, cell)?)
        * (1.0 - stilled * read(field, S::Stillness, cell)?))
}
fn river(field: &Field, cell: usize, orders: &ReadBand<u32>) -> io::Result<f64> {
    Ok(if orders.get(cell)? > 0 {
        (field.water.borrow().channel_strength(cell)? / 1000.0).min(1.0)
    } else {
        0.0
    })
}
fn shore_catch(field: &Field, cell: usize) -> io::Result<f64> {
    let mut seas = 0;
    let mut fauna = 0.0;
    let mut upwelling = 0.0f64;
    let mut safe = 0.0;
    let water = field.water.borrow().kinds();
    for edge in 0..3 {
        let Some(next) = field.mesh.neighbor(cell, edge) else {
            continue;
        };
        if water.get(next)? != 1 {
            continue;
        }
        seas += 1;
        // Perilous waters, a crush zone or a reef of rogue waves, give little to the boats
        // that dare them.
        let dared = field
            .place_offers()
            .map_or(Ok(0.0), |offers| offers.perilous(next))?
            .clamp(0.0, 1.0);
        fauna += read(field, S::AquaticFauna, next)? * (1.0 - dared);
        safe += 1.0 - dared;
        upwelling = upwelling.max(read(field, S::Upwelling, next)? * (1.0 - dared) / 1000.0);
    }
    Ok(if seas > 0 {
        let seas = f64::from(seas);
        0.5 * safe / seas + 4.0 * fauna / seas + 2.0 * upwelling
    } else {
        0.0
    })
}
fn season(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(
        (-((read(field, S::Temperature, cell)? - 480.0) / 200.0).powi(2)).exp()
            * ice_free(field, cell)?,
    )
}
/// What makes a dry cell's crops, each from 0 to 1 but `quickened`, which magic raises above
/// 1: the cultivated yield is `cultivated_yield(suitability) * quickened`.
#[derive(Clone, Copy, Default, serde::Serialize)]
pub struct CropFactors {
    pub season: f64,
    pub soil: f64,
    pub wet: f64,
    pub slope: f64,
    pub woods: f64,
    pub quickened: f64,
}
impl CropFactors {
    pub fn suitability(&self) -> f64 {
        self.season * self.soil * self.wet * self.slope * self.woods
    }
}
/// A dry cell's crop factors, given how strongly a river waters it.
pub fn crop_factors(field: &Field, cell: usize, river: f64) -> io::Result<CropFactors> {
    let stored = field.water.borrow().store(Store::Soil);
    let filled = soil::filled(stored.held(cell)?, stored.capacity(cell)?);
    Ok(CropFactors {
        season: season(field, cell)?,
        soil: (field.ground().view(GroundField::SoilDepth).get(cell)? / length(field, 1.25e-7)?)
            .min(1.0),
        wet: (read(field, S::Moisture, cell)? / 1000.0)
            .max(river)
            .max(filled)
            .min(1.0),
        slope: (-12.0 * read(field, S::Slope, cell)?).exp(),
        // How wooded the land would be left alone: clearing it is the cost woods put on crops.
        woods: 1.0 - 0.8 * on_share(read(field, S::TreeCover, cell)?, wild_share(field, cell)?),
        quickened: quickened(field, cell, 0.8)?,
    })
}
/// The mean crop factors over a map's dry cells, with the land the people layers farm and the
/// people they hold, written to the server log when `ATLAS_TRACE_PEOPLE` is set. Rivers are
/// left out, so `wet` is the least a river would raise it to.
pub fn trace_food(field: &Field, stage: &str) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let farmland = field.people.view(HumanField::Layer(LayerId::Farmland));
    let (mut dry, mut km2, mut people, mut farmed, mut fed_full) = (0., 0., 0., 0., 0.);
    let mut sum = CropFactors::default();
    let mut suitable = [0.; 4];
    for cell in 0..field.mesh.len() {
        let area = field.mesh.area(cell) / 1e6;
        people += field.people.people(cell)? * area;
        if field.water.borrow().kind_at(cell)? != 0 {
            continue;
        }
        let f = crop_factors(field, cell, 0.0)?;
        dry += 1.;
        km2 += area;
        farmed += farmland.get(cell)? * area;
        fed_full += cultivated_yield(f.suitability()) * f.quickened * area;
        sum.season += f.season;
        sum.soil += f.soil;
        sum.wet += f.wet;
        sum.slope += f.slope;
        sum.woods += f.woods;
        sum.quickened += f.quickened;
        suitable[((f.suitability() * 4.) as usize).min(3)] += 1.;
    }
    let mean = |v: f64| (v / f64::max(dry, 1.) * 1000.).round() / 1000.;
    eprintln!(
        "{}",
        serde_json::json!({"event":"people.food","details":{
            "stage": stage,
            "cells": dry,
            "dryKm2": km2.round(),
            "people": people.round(),
            "farmedKm2": (farmed * 10.).round() / 10.,
            "fedUnderCropsPerKm2": (fed_full / km2.max(f64::EPSILON) * 10.).round() / 10.,
            "meanFactors": {"season": mean(sum.season), "soil": mean(sum.soil), "wet": mean(sum.wet),
                "slope": mean(sum.slope), "woods": mean(sum.woods), "quickened": mean(sum.quickened)},
            "suitabilityQuarters": suitable.map(mean),
            "soilReferenceM": length(field, 1.25e-7)?,
        }})
    );
    Ok(())
}
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    rivers: Query<Field, ReadBand<u32>>,
    dependencies: Vec<QueryDependency<Field>>,
) -> ExecutionResult<()> {
    book.respond(
        "season",
        Responder {
            by: "climate and ice".into(),
            queries: dependencies.clone(),
            kind: ResponseKind::Base(Box::new(|field, cell, _| Ok(season(field, cell)?))),
        },
    )?;
    let mut water_reads = dependencies.clone();
    water_reads.push(rivers.dependency());
    let crop_rivers = rivers.clone();
    book.respond(
        "cropYield",
        Responder {
            by: "soil, water and season".into(),
            queries: water_reads.clone(),
            kind: ResponseKind::Base(Box::new(move |field, cell, answers| {
                if field.water.borrow().kind_at(cell)? != 0 {
                    return Ok(0.0);
                }
                let watered = river(field, cell, answers.queries().get(&crop_rivers)?.as_ref())?;
                let factors = crop_factors(field, cell, watered)?;
                Ok(cultivated_yield(factors.suitability()) * factors.quickened)
            })),
        },
    )?;
    book.respond(
        "herdYield",
        Responder {
            by: "grass and season".into(),
            queries: dependencies,
            kind: ResponseKind::Base(Box::new(|field, cell, answers| {
                Ok(if field.water.borrow().kind_at(cell)? == 0 {
                    // Steep grazing carries fewer animals; herds tolerate slope better than crops.
                    // Grass grows on all the ground fields and buildings leave open.
                    let open = (1.0
                        - human(field, LayerId::Farmland, cell)?
                        - human(field, LayerId::BuiltUp, cell)?)
                    .clamp(0.0, 1.0);
                    5.0 * on_share(read(field, S::GrassCover, cell)?, open)
                        * answers.ask("season")?
                        * (-4.0 * read(field, S::Slope, cell)?).exp()
                        * quickened(field, cell, 0.5)?
                } else {
                    0.0
                })
            })),
        },
    )?;
    book.respond(
        "catchYield",
        Responder {
            by: "rivers and shores".into(),
            queries: water_reads.clone(),
            kind: ResponseKind::Base(Box::new(move |field, cell, answers| {
                if field.water.borrow().kind_at(cell)? != 0 {
                    return Ok(0.0);
                }
                let fished = river(field, cell, answers.queries().get(&rivers)?.as_ref())?
                    * (0.5 + 4.0 * read(field, S::AquaticFauna, cell)?)
                    + shore_catch(field, cell)?;
                Ok(fished * ice_free(field, cell)?)
            })),
        },
    )?;
    book.respond(
        "wildYield",
        Responder {
            by: "woods, game and water".into(),
            queries: water_reads,
            kind: ResponseKind::Base(Box::new(move |field, cell, answers| {
                if field.water.borrow().kind_at(cell)? != 0 {
                    return Ok(0.0);
                }
                // What the wild ground gives, per km² of wild ground: support counts only
                // that share of the cell. Its rivers and shores add their catch.
                Ok(gathered(field, cell)? * ice_free(field, cell)? + answers.ask("catchYield")?)
            })),
        },
    )?;
    book.respond(
        SUPPORT.id,
        Responder {
            by: "the land as it is used".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, answers| {
                let crop = field
                    .people
                    .view(HumanField::Layer(LayerId::Farmland))
                    .get(cell)?;
                let herd = field
                    .people
                    .view(HumanField::Layer(LayerId::Pasture))
                    .get(cell)?;
                let built = field
                    .people
                    .view(HumanField::Layer(LayerId::BuiltUp))
                    .get(cell)?;
                let worked = worked_farmland(crop, field.people.people(cell)?);
                Ok(harvest(field, cell, worked, answers.ask("cropYield")?)?
                    + herd * answers.ask("herdYield")?
                    + (1.0 - crop - herd - built).max(0.0) * answers.ask("wildYield")?)
            })),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::worked_farmland;

    #[test]
    fn abandoned_fields_cannot_provision_a_city() {
        assert_eq!(worked_farmland(0.8, 0.0), 0.0);
        assert_eq!(worked_farmland(0.8, 10.0), 0.2);
        assert_eq!(worked_farmland(0.8, 100.0), 0.8);
    }
}
