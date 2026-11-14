use super::{contract::Entry, kinds::Kind};
use std::io;

pub trait CatalogueState<Schedule>: super::carry::CarryState<Schedule> {
    fn catalogue(&self) -> &Catalogue<Self, Schedule>;
    fn parent_cell_span(&self) -> f64;
    fn settlement_places(&self) -> io::Result<Vec<super::values::Place>>;
}

pub struct Catalogue<S, Schedule> {
    entries: Vec<Entry<S, Schedule>>,
    index: Vec<usize>,
}
impl<S, Schedule> Catalogue<S, Schedule> {
    pub fn new(entries: Vec<Entry<S, Schedule>>) -> io::Result<Self> {
        let mut index = vec![usize::MAX; Kind::ALL.len()];
        for (at, entry) in entries.iter().enumerate() {
            if index[entry.id as usize] != usize::MAX {
                return Err(io::Error::other(format!(
                    "Duplicate POI kind: {}",
                    entry.id.as_str()
                )));
            }
            index[entry.id as usize] = at;
        }
        for &kind in Kind::ALL {
            if index[kind as usize] == usize::MAX {
                return Err(io::Error::other(format!(
                    "Missing POI kind: {}",
                    kind.as_str()
                )));
            }
        }
        Ok(Self { entries, index })
    }
    pub fn get(&self, kind: Kind) -> &Entry<S, Schedule> {
        &self.entries[self.index[kind as usize]]
    }
    pub fn entries(&self) -> &[Entry<S, Schedule>] {
        &self.entries
    }
    pub fn publication_order(&self) -> impl Iterator<Item = &Entry<S, Schedule>> {
        let first = |e: &&Entry<S, Schedule>| matches!(e.id, Kind::Settlement | Kind::Ruin);
        self.entries
            .iter()
            .filter(first)
            .chain(self.entries.iter().filter(move |e| !first(e)))
    }
}
