use super::{environment::environment, unit, Forcing, Habitat};
use crate::{field::shared::Scalar as S, rock::ground::GroundField};
use std::io;
#[derive(Clone, Copy, PartialEq)]
pub enum Id {
    Grass,
    Broadleaf,
    Conifer,
    Wetland,
}
#[derive(Clone, Copy)]
pub enum Carrier {
    Wind,
    Current,
}
pub struct Group {
    pub id: Id,
    pub cover: S,
    pub seed: S,
    pub juvenile: Option<S>,
    pub mass: f64,
    pub maturity: f64,
    pub lifespan: f64,
    pub spread: f64,
    pub nitrogen: f64,
    pub shade: f64,
    pub waterlogging: f64,
    pub carrier: Carrier,
    pub reach: f64,
    pub interval: f64,
    pub flood_sensitivity: f64,
}
pub const GROUPS: [Group; 4] = [
    Group {
        id: Id::Grass,
        cover: S::GrassCover,
        seed: S::GrassSeed,
        juvenile: None,
        mass: 0.9,
        maturity: 3.0,
        lifespan: 10.0,
        spread: 0.0001,
        nitrogen: 45.0,
        shade: 0.15,
        waterlogging: 0.65,
        carrier: Carrier::Wind,
        reach: 0.1,
        interval: 20.0,
        flood_sensitivity: 0.05,
    },
    Group {
        id: Id::Broadleaf,
        cover: S::BroadleafCover,
        seed: S::BroadleafSeed,
        juvenile: Some(S::BroadleafSaplings),
        mass: 10.0,
        maturity: 45.0,
        lifespan: 250.0,
        spread: 0.000045,
        nitrogen: 90.0,
        shade: 0.65,
        waterlogging: 0.35,
        carrier: Carrier::Current,
        reach: 0.0625,
        interval: 20.0,
        flood_sensitivity: 0.2,
    },
    Group {
        id: Id::Conifer,
        cover: S::ConiferCover,
        seed: S::ConiferSeed,
        juvenile: Some(S::ConiferSaplings),
        mass: 8.0,
        maturity: 65.0,
        lifespan: 350.0,
        spread: 0.000035,
        nitrogen: 110.0,
        shade: 0.5,
        waterlogging: 0.85,
        carrier: Carrier::Current,
        reach: 0.0375,
        interval: 20.0,
        flood_sensitivity: 0.3,
    },
    Group {
        id: Id::Wetland,
        cover: S::WetlandCover,
        seed: S::WetlandSeed,
        juvenile: None,
        mass: 1.8,
        maturity: 5.0,
        lifespan: 8.0,
        spread: 0.000075,
        nitrogen: 55.0,
        shade: 0.5,
        waterlogging: 0.0,
        carrier: Carrier::Wind,
        reach: 0.075,
        interval: 20.0,
        flood_sensitivity: 0.0,
    },
];
pub fn plant_cover(map: &Habitat<'_>, group: &Group, cell: usize) -> io::Result<f64> {
    Ok(map.get(group.cover, cell)? + group.juvenile.map_or(Ok(0.0), |name| map.get(name, cell))?)
}
pub fn canopy(map: &Habitat<'_>, cell: usize) -> io::Result<f64> {
    Ok(map.get(S::BroadleafCover, cell)? + map.get(S::ConiferCover, cell)?)
}
pub fn living_carbon(map: &Habitat<'_>, cell: usize) -> io::Result<f64> {
    let mut sum = 0.0;
    for group in &GROUPS {
        sum += (map.get(group.cover, cell)?
            + 0.2 * group.juvenile.map_or(Ok(0.0), |name| map.get(name, cell))?)
            * group.mass;
    }
    Ok(sum)
}
pub fn suitability(map: &Habitat<'_>, group: &Group, cell: usize, f: &Forcing) -> io::Result<f64> {
    let e = environment(map, cell, f)?;
    if e.submerged || e.frozen {
        return Ok(0.0);
    }
    let cold = match group.id {
        Id::Conifer => -28.0,
        Id::Grass => -20.0,
        _ => -12.0,
    };
    let warmth = unit((e.summer + 4.0) / 18.0) * unit((55.0 - e.summer) / 15.0);
    let frost = unit((e.winter - cold) / 15.0);
    let drought = unit(1.0 - e.drought);
    let wet = if group.id == Id::Wetland {
        e.wetness
    } else {
        1.0 - e.wetness * group.waterlogging
    };
    let shade = unit(1.0 - canopy(map, cell)? * (1.0 - group.shade));
    let soil = unit(
        map.substrate(GroundField::SoilDepth, cell)?
            / map.length(if group.juvenile.is_some() {
                7.5e-8
            } else {
                1.5e-8
            })?,
    );
    let heat = if group.id == Id::Conifer {
        unit((25.0 - e.temperature) / 12.0)
    } else {
        1.0
    };
    Ok((warmth * frost * drought * wet * soil * heat).max(f.verdure) * shade)
}
pub fn respond(
    book: &mut crate::answers::QuestionBook<crate::field::Field, &'static str>,
) -> crate::execution::ExecutionResult<()> {
    use crate::{
        answers::{Responder, ResponseKind},
        execution::ExecutionError,
    };
    book.respond(
        "rootHold",
        Responder {
            by: "plants".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                let read = |name| {
                    field
                        .shared()
                        .scalar(name)
                        .get(cell)
                        .map_err(|e| ExecutionError::Failed(e.to_string()))
                };
                Ok(read(S::TreeCover)? * 1.2
                    + read(S::GrassCover)? * 0.45
                    + read(S::WetlandCover)? * 0.7)
            })),
        },
    )?;
    book.respond(
        "wetness",
        Responder {
            by: "wetlands".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(|field, cell, _| {
                field
                    .shared()
                    .scalar(S::WetlandCover)
                    .get(cell)
                    .map(|v| v * 0.5)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            })),
        },
    )
}
