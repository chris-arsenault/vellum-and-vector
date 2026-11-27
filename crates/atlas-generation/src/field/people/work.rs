use super::{
    facts::Facts,
    feed::Market,
    questions::Questions,
    reach::Passage,
    travel::{length, Travel},
};
use crate::{
    execution::{CommandContext, ExecutionResult, Query},
    field::Field,
    scale::{AreaUnit, MapScale},
    storage::{Band, ReadBand},
};
use std::io;

pub struct Work {
    pub facts: Facts,
    pub going: Passage,
    pub land: Band<f64>,
    pub imports: Band<f64>,
    pub outside_market: Option<Market>,
    pub connections: std::rc::Rc<Vec<super::feed::Connection>>,
    pub(crate) markets: std::rc::Rc<Vec<crate::field::refinement::people::SettlementCensus>>,
    pub city: Option<std::rc::Rc<super::growth::Guidance>>,
    /// The people a built square kilometre holds at each cell, as settling last found it:
    /// zero until households have been placed in this pass.
    pub held: Band<f64>,
}
pub fn habitable(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.water.borrow().kind_at(cell)? == 0)
}
pub fn km2(field: &Field, cell: usize) -> f64 {
    MapScale::area_units(
        field.mesh.area(cell),
        AreaUnit::SquareMetre,
        AreaUnit::SquareKilometre,
    )
}
pub fn working(field: &Field) -> Band<f64> {
    field.coverage.borrow_mut().scratch(field.mesh.len(), 0.0)
}
impl Work {
    pub fn open(
        context: &CommandContext<'_, Field>,
        facts: Facts,
        questions: &Questions,
        rivers: &Query<Field, ReadBand<u32>>,
        city: Option<&super::growth::Guidance>,
    ) -> ExecutionResult<Self> {
        let friction = context.query(&questions.friction)?.values();
        let climbing = context.query(&questions.climbing)?.values();
        let rivers = context.query(rivers)?;
        let field = context.state();
        let travel = Travel::new(field, friction, climbing, rivers)?;
        let range = length(field, facts.range)?;
        let access = city.map_or(&[][..], |g| g.road_access.as_slice());
        let crossings: Vec<_> = field
            .place_offers()
            .map_or(&[][..], |o| o.links())
            .iter()
            .chain(city.into_iter().flat_map(|g| g.crossings.iter()))
            .map(|l| crate::links::Link {
                a: l.a,
                b: l.b,
                cost: l.cost,
            })
            .collect();
        let going = Passage::new(
            &field.mesh,
            &mut field.coverage.borrow_mut(),
            |a, b| Ok(travel.step(a, b)? * super::growth::travel_friction(access, a, b)),
            range,
        )?
        .with_links(&field.mesh, &crossings, range)?;
        Ok(Self::over(field, facts, going)?)
    }
    /// The work of a pass over `going`, with the land each cell reaches.
    pub fn over(field: &Field, facts: Facts, going: Passage) -> io::Result<Self> {
        let mut area = working(field);
        let mut land = working(field);
        for cell in 0..field.mesh.len() {
            if habitable(field, cell)? {
                area.set(cell, km2(field, cell))?;
            }
        }
        going.reach(
            &field.mesh,
            &mut field.coverage.borrow_mut(),
            &area.read_only(),
            &mut land,
            super::reach::REACH_SWEEPS,
        )?;
        Ok(Self {
            facts,
            going,
            land,
            imports: working(field),
            outside_market: None,
            connections: Default::default(),
            markets: Default::default(),
            city: None,
            held: working(field),
        })
    }
    /// The people built ground holds at ease at `cell`, as a multiple of ordinary ground:
    /// what the city's districts say of their households, and one anywhere else.
    pub fn dwelling(&self, cell: usize) -> f64 {
        self.city
            .as_ref()
            .and_then(|city| city.dwelling.get(cell))
            .copied()
            .unwrap_or(1.)
    }
    /// The protection walls give `cell`: every circuit round it, by the share that stands.
    pub fn enclosed(&self, cell: usize) -> f64 {
        self.city
            .as_ref()
            .and_then(|city| city.enclosed.get(cell))
            .copied()
            .unwrap_or(0.)
    }
    pub fn reach(
        &self,
        field: &Field,
        source: &Band<f64>,
        result: &mut Band<f64>,
    ) -> io::Result<()> {
        self.going.reach(
            &field.mesh,
            &mut field.coverage.borrow_mut(),
            &source.read_only(),
            result,
            super::reach::REACH_SWEEPS,
        )
    }
}
