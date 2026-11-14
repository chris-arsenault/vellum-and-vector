use super::{
    facts::Facts,
    questions::Questions,
    reach::Passage,
    travel::{length, Travel},
};
use crate::{
    execution::{CommandContext, ExecutionResult, Query},
    field::Field,
    lattice::Membership,
    scale::{AreaUnit, MapScale},
    storage::{Band, ReadBand},
};
use std::io;

pub struct Work {
    pub facts: Facts,
    pub going: Passage,
    pub land: Band<f64>,
    pub imports: Band<f64>,
    pub market: Band<f64>,
}
pub fn habitable(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.mesh.membership(cell) == Membership::Content
        && field.water().column.kind.get(cell)? == 0)
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
    ) -> ExecutionResult<Self> {
        let friction = context.query(&questions.friction)?.values();
        let climbing = context.query(&questions.climbing)?.values();
        let rivers = context.query(rivers)?;
        let field = context.state();
        let travel = Travel::new(field, friction, climbing, rivers)?;
        let going = Passage::new(
            &field.mesh,
            &mut field.coverage.borrow_mut(),
            |a, b| travel.step(a, b),
            length(field, facts.range)?,
        )?;
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
            48,
        )?;
        Ok(Self {
            facts,
            going,
            land,
            imports: working(field),
            market: working(field),
        })
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
            48,
        )
    }
}
