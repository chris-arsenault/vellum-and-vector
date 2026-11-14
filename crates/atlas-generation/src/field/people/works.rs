use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Work {
    pub id: String,
    pub kind: String,
    pub cell: usize,
    pub place: String,
    pub built: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
    pub holds: usize,
}
#[derive(Default)]
pub struct Works {
    next: usize,
    pub known: Vec<Work>,
    tried: Vec<usize>,
    moved: bool,
}
impl Works {
    pub fn standing(&self) -> impl Iterator<Item = &Work> {
        self.known.iter().filter(|w| w.failed.is_none())
    }
    pub fn tried(&self, cell: usize) -> bool {
        self.tried.contains(&cell) || self.known.iter().any(|w| w.cell == cell)
    }
    pub fn record(&mut self, cell: usize, place: String, built: String, holds: usize) {
        self.known.push(Work {
            id: format!("work:{}", self.next),
            kind: "dam".into(),
            cell,
            place,
            built,
            failed: None,
            holds,
        });
        self.next += 1;
        self.moved = true;
    }
    pub fn fail(&mut self, id: &str, era: &str) {
        if let Some(work) = self.known.iter_mut().find(|w| w.id == id) {
            work.failed = Some(era.into());
            self.moved = true;
        }
    }
    pub fn note_water_moved(&mut self) {
        self.moved = true;
    }
    pub fn take_water_moved(&mut self) -> bool {
        std::mem::take(&mut self.moved)
    }
    pub fn record_dry(&mut self, cell: usize) {
        self.tried.push(cell);
    }
}
