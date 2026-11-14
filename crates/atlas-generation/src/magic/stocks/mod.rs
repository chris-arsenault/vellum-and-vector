pub mod aging;
mod grains;
pub mod groundwater;
pub mod ice;
pub mod mobile;
pub mod organic;
pub mod run;
pub mod salt;
use crate::{magic::carriers::Costs, rock::load::MaterialLoad, storage::Coverage};
pub struct Transport<'a> {
    pub coverage: &'a mut Coverage,
    pub sea: &'a mut MaterialLoad,
    pub costs: &'a Costs,
}
