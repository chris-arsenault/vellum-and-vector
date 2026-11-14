use crate::{
    execution::{Command, CommandKind},
    field::{shared::CellCode, Field},
};

pub struct Mark {
    pub anchors: Vec<usize>,
    pub code: i32,
    pub yields_to: Vec<i32>,
}
pub fn operation() -> Command<Field, Mark> {
    Command::with_inputs(
        "places.landform-marks",
        CommandKind::Work,
        vec![],
        |scope, mark: &Mark| {
            scope.state().mark_place_landforms(mark)?;
            Ok(())
        },
    )
}
impl Field {
    pub fn mark_place_landforms(&self, mark: &Mark) -> std::io::Result<()> {
        let water = self.water();
        let mut codes = self.shared.derive_code(CellCode::LandformCodes);
        for &cell in &mark.anchors {
            if water.column.kind.get(cell)? == 0 && !mark.yields_to.contains(&codes.get(cell)?) {
                codes.set(cell, mark.code)?;
            }
        }
        Ok(())
    }
}
