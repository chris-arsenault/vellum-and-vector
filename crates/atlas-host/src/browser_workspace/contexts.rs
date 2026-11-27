use super::{
    error, BrowserWorkspace, Database, LocalInputs, ASSETS, JOBS, RESOURCES, SAVED_INPUTS,
};
use crate::{
    context_files::{self, Cleanup, Retention},
    context_inventory::{self, Call, Inventory, Target},
    job_files::JobFiles,
};
use atlas_generation::{GenerationState, GenerationStatus};
use atlas_gis::map_files::MapFiles;
use atlas_gis::map_store::{MapEntry, MapStore};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io,
    path::Path,
    rc::Rc,
};
use wasm_bindgen::prelude::*;
const CLEANUP: &str = "/atlas/pending-cleanup";

#[wasm_bindgen]
impl BrowserWorkspace {
    pub fn contexts(&self, request: &str) -> Result<String, JsValue> {
        let call: Call = serde_json::from_str(request).map_err(error)?;
        if matches!(call, Call::Maps) {
            return serde_json::to_string(&self.map_entries(MapStore::map_index).map_err(error)?)
                .map_err(error);
        }
        if let Call::Delete(target) = call {
            self.delete_context(target).map_err(error)?;
        }
        serde_json::to_string(&self.inventory().map_err(error)?).map_err(error)
    }
}
impl BrowserWorkspace {
    fn input_stores(&self) -> io::Result<Vec<LocalInputs>> {
        [SAVED_INPUTS, self.input_path.as_str()]
            .into_iter()
            .map(|path| LocalInputs::open(Rc::new(Database::open(path)?)))
            .collect()
    }
    fn entries(&self) -> io::Result<Vec<context_inventory::InputEntry>> {
        let mut entries = BTreeMap::new();
        for inputs in self.input_stores()? {
            for entry in inputs.inventory()? {
                entries.insert(entry.catalog.clone(), entry);
            }
        }
        Ok(entries.into_values().collect())
    }
    fn map_entries(
        &self,
        read: fn(&MapStore) -> io::Result<Vec<MapEntry>>,
    ) -> io::Result<Vec<MapEntry>> {
        let mut maps = BTreeMap::new();
        for entry in read(&self.maps)?.into_iter().chain(read(&self.saved()?)?) {
            maps.insert(
                (
                    entry.reference.map_id.clone(),
                    entry.reference.revision.clone(),
                ),
                entry,
            );
        }
        Ok(maps.into_values().collect())
    }
    fn inventory(&self) -> io::Result<Inventory> {
        let maps = self.map_entries(MapStore::inventory)?;
        let jobs: Vec<GenerationStatus> = serde_json::from_str(
            &self
                .generation_jobs()
                .map_err(|e| io::Error::other(format!("{e:?}")))?,
        )?;
        let documents = self.entries()?;
        let retention =
            Retention::collect(&documents, &jobs, Path::new(JOBS), Path::new(RESOURCES));
        let mut orphans: Vec<_> = documents.iter().filter_map(|d| d.orphan(&maps)).collect();
        let assets = self
            .maps
            .asset_locations()?
            .into_iter()
            .chain(self.saved()?.asset_locations()?)
            .collect::<Vec<_>>();
        orphans.extend(context_files::orphan_files(
            &retention,
            Path::new(RESOURCES),
            &MapFiles::new(ASSETS),
            &assets,
        )?);
        for key in self
            .input_stores()?
            .iter()
            .map(LocalInputs::geography_ids)
            .collect::<io::Result<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect::<BTreeSet<_>>()
        {
            if !retention.geography.contains(&key) {
                orphans.push(context_inventory::Orphan {
                    kind: "geography".into(),
                    id: serde_json::to_string(&key)?,
                    reference: None,
                    problem: None,
                });
            }
        }
        Ok(Inventory {
            maps,
            jobs,
            orphans,
            cleanup: context_files::pending(Path::new(CLEANUP))?,
            problems: retention.problems,
        })
    }
    // owner-direction(2026-11-15): GIS and numerical data must stay in sync including deletion
    fn delete_context(&self, target: Target) -> io::Result<()> {
        let (files, cleanup) = if let Target::Cleanup { id } = target {
            let files = JobFiles::new(Path::new(CLEANUP), &id)?;
            let cleanup = files
                .read::<Cleanup>("request.json")?
                .ok_or_else(|| io::Error::other("Cleanup request is missing"))?;
            (files, cleanup)
        } else {
            let selected = match &target {
                Target::Map { id, descendants } => {
                    context_inventory::selected_maps(&self.inventory()?.maps, *id, *descendants)
                }
                _ => Default::default(),
            };
            self.require_unused(&target, &selected)?;
            let files = JobFiles::new(Path::new(CLEANUP), &uuid::Uuid::new_v4().to_string())?;
            let cleanup = Cleanup {
                target,
                maps: selected,
            };
            files.write("request.json", &cleanup)?;
            (files, cleanup)
        };
        self.require_unused(&cleanup.target, &cleanup.maps)?;
        for &id in &cleanup.maps {
            self.saved()?.delete_map(id)?;
            self.maps.delete_map(id)?;
            for inputs in self.input_stores()? {
                inputs.delete_map(id)?;
            }
        }
        match &cleanup.target {
            Target::Job { id } => {
                fs::remove_dir_all(JobFiles::new(Path::new(JOBS), id)?.directory)?
            }
            Target::Orphan { orphan } if orphan.kind == "inputs" => {
                if let Some(reference) = &orphan.reference {
                    if self
                        .inventory()?
                        .maps
                        .iter()
                        .any(|m| &m.reference == reference)
                    {
                        return Err(io::Error::other("These inputs belong to a retained map"));
                    }
                    self.require_unused(&cleanup.target, &BTreeSet::from([reference.map_id]))?;
                    for inputs in self.input_stores()? {
                        inputs.unbind(reference)?;
                    }
                }
            }
            _ => {}
        }
        self.cleanup_files()?;
        fs::remove_dir_all(files.directory)
    }
    fn require_unused(
        &self,
        target: &Target,
        selected: &BTreeSet<atlas_map::Id>,
    ) -> io::Result<()> {
        if let Target::Job { id } = target {
            if self.running.borrow().contains(id) {
                return Err(io::Error::other(
                    "Stop the generation job before deleting it",
                ));
            }
        }
        if selected.is_empty() {
            return Ok(());
        }
        for files in self.job_files()? {
            let status = self.status(&files)?;
            if status.state == GenerationState::Completed {
                continue;
            }
            let parent = status.details.as_ref().and_then(|d| d.parent.as_ref());
            let action: Option<serde_json::Value> = files.read("action.json")?;
            let world: Option<atlas_map::Id> = action
                .as_ref()
                .and_then(|a| serde_json::from_value(a["request"]["worldId"].clone()).ok());
            if parent.is_some_and(|p| selected.contains(&p.map_id))
                || world.is_some_and(|id| selected.contains(&id))
            {
                return Err(io::Error::other(format!(
                    "Job {} still uses this map; finish or delete that job first",
                    status.job_id
                )));
            }
        }
        Ok(())
    }
    fn cleanup_files(&self) -> io::Result<()> {
        if !self.running.borrow().is_empty() {
            return Err(io::Error::other("Metadata deletion finished; file cleanup waits for running jobs. Retry cleanup from the library when they finish"));
        }
        let inventory = self.inventory()?;
        let retention = Retention::collect(
            &self.entries()?,
            &inventory.jobs,
            Path::new(JOBS),
            Path::new(RESOURCES),
        );
        retention.require_known()?;
        for orphan in inventory
            .orphans
            .iter()
            .filter(|o| matches!(o.kind.as_str(), "resource" | "asset"))
        {
            context_files::remove_file(orphan, Path::new(RESOURCES), &MapFiles::new(ASSETS))?;
        }
        for inputs in self.input_stores()? {
            for key in inputs
                .geography_ids()?
                .into_iter()
                .filter(|k| !retention.geography.contains(k))
            {
                inputs.remove_geography(&key)?;
            }
        }
        Ok(())
    }
}
