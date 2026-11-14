use super::State;
use crate::{
    atlas::history::Cause,
    execution::ExecutionResult,
    field::{
        poi::{landform_marks, publication::places_of},
        Field,
    },
};

impl State {
    pub fn begin_epoch(&mut self) -> ExecutionResult<()> {
        self.physical.executor.run(&Field::begin_atlas_epoch())?;
        if let Some(magic) = &mut self.physical.magic {
            magic.get_mut().begin_epoch()?;
        }
        Ok(())
    }
    pub fn mark_place_landforms(&self) -> ExecutionResult<()> {
        self.clear_queries();
        let catalogue = self.catalogue.clone();
        let mut entries = catalogue
            .entries()
            .iter()
            .filter_map(|entry| entry.recognition.landform.value().map(|mark| (entry, mark)))
            .collect::<Vec<_>>();
        // hpc-exempt: catalogue strategies, not cell data; yielding kinds run last.
        entries.sort_by_key(|(_, mark)| !mark.yields_to.is_empty());
        for (entry, mark) in entries {
            let anchors = places_of(self, entry)?
                .iter()
                .map(|place| place.anchor)
                .collect();
            self.field().mark_place_landforms(&landform_marks::Mark {
                anchors,
                code: mark.code,
                yields_to: mark.yields_to.clone(),
            })?;
        }
        self.clear_queries();
        Ok(())
    }
    pub fn after_physical_step(&mut self, step: &str, epoch: i32) -> ExecutionResult<()> {
        match step {
            "landform-classification" => self.mark_place_landforms()?,
            "physical-epoch-history" => self.causes.push(Cause::Domain {
                process: "atlas.physical-epoch-history".into(),
                subjects: Vec::new(),
                description: format!("Epoch {}: the selected geological, river, ice and coastal processes retained their material histories. Omitted processes added no new events.", epoch + 1),
            }),
            _ => {},
        }
        Ok(())
    }
}
