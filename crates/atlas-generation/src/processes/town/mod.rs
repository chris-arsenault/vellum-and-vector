//! Settlement mechanisms; the atlas adapter binds field queries and retained owner operations.
pub mod competition;
pub mod construction;
mod crossroads;
pub mod economy;
pub mod investment;
pub mod movement;
mod patronage;
pub mod sanitation;
mod walks;
use crate::{
    spatial::SpatialKernel,
    town::{
        fabric::Town,
        ground::Ground,
        influence::{Conditions, OpportunitySource},
    },
};
use std::io;
pub struct Candidate {
    pub slot: crate::town::plots::Slot,
    pub conditions: Conditions,
    pub opportunities: crate::town::influence::Opportunities,
}
pub struct Frontage<'a> {
    pub walking_ground: &'a Ground,
    pub outlying: &'a [(&'a crate::town::founding::OutlyingSite, [Conditions; 2])],
    pub links: &'a [(
        crate::town::geometry::Point,
        crate::town::geometry::Point,
        f64,
    )],
    pub sources: &'a [OpportunitySource],
    pub ground: &'a mut Ground,
    pub spatial: &'a dyn SpatialKernel,
    pub candidates: &'a [Candidate],
    pub conditions: &'a [Conditions],
    pub exposure: f64,
}
pub struct Livelihood<'a> {
    pub walking_ground: &'a Ground,
    pub links: &'a [(
        crate::town::geometry::Point,
        crate::town::geometry::Point,
        f64,
    )],
    pub spatial: &'a dyn SpatialKernel,
    pub sources: &'a [OpportunitySource],
    pub conditions: &'a [Conditions],
    pub exposure: f64,
}
pub struct Exposure<'a> {
    pub spatial: &'a dyn SpatialKernel,
    pub conditions: &'a [Conditions],
    pub exposure: f64,
}
pub type Removals = Vec<(crate::town::geometry::Point, f64)>;
#[derive(Clone, Copy)]
pub enum Mechanism {
    Movement(fn(&mut Town, &mut Frontage<'_>) -> io::Result<()>),
    Frontage(fn(&mut Town, &mut Frontage<'_>) -> io::Result<()>),
    Livelihood(fn(&mut Town, &Livelihood<'_>) -> io::Result<()>),
    Exposure(fn(&mut Town, &Exposure<'_>) -> io::Result<()>),
    Clearance(fn(&Town, &Exposure<'_>) -> io::Result<Removals>),
}
pub type DevelopmentStrategy = fn(
    &Town,
    &crate::town::fabric::Purpose,
    crate::town::catalogue::Kind,
    &Exposure<'_>,
) -> Option<(f64, crate::town::fabric::FabricEdit)>;
pub struct Step {
    pub id: &'static str,
    pub run: Mechanism,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Reads {
    Frontage,
    Livelihood,
    Exposure,
}
pub const STEPS: &[Step] = &[
    Step {
        id: "town.movement",
        run: Mechanism::Movement(movement::advance),
    },
    Step {
        id: "town.livelihood",
        run: Mechanism::Livelihood(economy::advance),
    },
    Step {
        id: "town.sanitation",
        run: Mechanism::Clearance(sanitation::advance),
    },
    Step {
        id: "town.land-competition",
        run: Mechanism::Exposure(competition::advance),
    },
    Step {
        id: "town.collective-investment",
        run: Mechanism::Exposure(investment::advance),
    },
    Step {
        id: "town.construction",
        run: Mechanism::Frontage(construction::advance),
    },
    Step {
        id: "town.maintenance",
        run: Mechanism::Exposure(construction::maintain),
    },
];
pub fn operation_ids() -> Vec<&'static str> {
    let mut ids = STEPS.iter().map(|step| step.id).collect::<Vec<_>>();
    ids.insert(1, "town.signals");
    ids
}
