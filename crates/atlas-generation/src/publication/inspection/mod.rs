//! Resolve rock and people descriptions while generation resources are still available.
mod format;
mod people;
mod rock;
#[cfg(test)]
mod tests;
use atlas_map::InspectionSection;
use serde_json::Value;
// hpc-exempt: published inspection records contain named map attributes.
use std::{collections::BTreeMap, io};

pub type Read<'a> = dyn Fn(&str) -> io::Result<f64> + 'a;
pub type ClassName<'a> = dyn Fn(&str, f64) -> Option<String> + 'a;
pub struct Cell<'a> {
    pub read: &'a Read<'a>,
    pub class_name: &'a ClassName<'a>,
    pub population: bool,
    pub measure: f64,
}
impl Cell<'_> {
    pub fn sections(&self) -> io::Result<Vec<InspectionSection>> {
        let mut sections = rock::sections(self)?;
        sections.extend(people::sections(self)?);
        Ok(sections)
    }
    fn class(&self, channel: &str, code: f64) -> String {
        (self.class_name)(channel, code).unwrap_or_else(|| format!("Kind {code}"))
    }
}
// hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
fn section(id: &str, title: &str, records: Vec<BTreeMap<String, Value>>) -> InspectionSection {
    InspectionSection {
        id: id.into(),
        title: title.into(),
        records,
    }
}
// hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
fn record<const N: usize>(pairs: [(&str, String); N]) -> BTreeMap<String, Value> {
    pairs
        .into_iter()
        .map(|(key, value)| (key.into(), value.into()))
        .collect()
}
