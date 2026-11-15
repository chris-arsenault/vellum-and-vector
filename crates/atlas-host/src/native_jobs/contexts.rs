use super::{poisoned, Job, Jobs};
use crate::{
    context_files::{self, Cleanup, Retention},
    context_inventory::{self, Call, Inventory, Target},
    job_files::JobFiles,
    private_inputs::PrivateInputs,
};
use atlas_generation::GenerationState;
use atlas_gis::postgres_maps::PostgresMaps;
use serde_json::Value;
use std::{collections::BTreeMap, fs, io};

impl Jobs {
    pub fn contexts(&self, call: Call) -> io::Result<Value> {
        // Start/resume and deletion share this host lock; running workers retain their data.
        let mut jobs = self.jobs.lock().map_err(poisoned)?;
        let maps = PostgresMaps::connect(&self.settings.database_url)?;
        let inputs = PrivateInputs::connect(&self.settings.generation_url)?;
        if let Call::Delete(target) = call {
            self.delete_context(target, &mut jobs, &maps, &inputs)?;
        }
        serde_json::to_value(self.inventory(&jobs, &maps, &inputs)?).map_err(Into::into)
    }
    fn inventory(
        &self,
        jobs: &BTreeMap<String, Job>,
        maps: &PostgresMaps,
        inputs: &PrivateInputs,
    ) -> io::Result<Inventory> {
        let maps = maps.inventory()?;
        let jobs = jobs
            .values()
            .map(Job::status)
            .collect::<io::Result<Vec<_>>>()?;
        let documents = inputs.inventory()?;
        let retention = Retention::collect(
            &documents,
            &jobs,
            &self.settings.resources.join(".jobs"),
            &self.settings.resources,
        );
        let mut orphans: Vec<_> = documents.iter().filter_map(|d| d.orphan(&maps)).collect();
        let source = PostgresMaps::connect(&self.settings.database_url)?;
        orphans.extend(context_files::orphan_files(
            &retention,
            &self.settings.resources,
            &self.settings.assets,
            &source.asset_locations()?,
        )?);
        for key in inputs
            .geography_ids()?
            .into_iter()
            .filter(|k| !retention.geography.contains(k))
        {
            orphans.push(context_inventory::Orphan {
                kind: "geography".into(),
                id: serde_json::to_string(&key)?,
                reference: None,
                problem: None,
            });
        }
        Ok(Inventory {
            maps,
            jobs,
            orphans,
            cleanup: context_files::pending(&self.settings.resources.join(".cleanup"))?,
            problems: retention.problems,
        })
    }
    // owner-direction(2026-11-15): GIS and numerical data must stay in sync including deletion
    fn delete_context(
        &self,
        target: Target,
        jobs: &mut BTreeMap<String, Job>,
        maps: &PostgresMaps,
        inputs: &PrivateInputs,
    ) -> io::Result<()> {
        let root = self.settings.resources.join(".cleanup");
        let (files, cleanup) = if let Target::Cleanup { id } = target {
            let files = JobFiles::new(&root, &id)?;
            let cleanup = files
                .read::<Cleanup>("request.json")?
                .ok_or_else(|| io::Error::other("Cleanup request is missing"))?;
            (files, cleanup)
        } else {
            let selected = match &target {
                Target::Map { id, descendants } => {
                    context_inventory::selected_maps(&maps.inventory()?, id, *descendants)
                }
                _ => Default::default(),
            };
            self.require_unused(&target, &selected, jobs)?;
            let files = JobFiles::new(&root, &uuid::Uuid::new_v4().to_string())?;
            let cleanup = Cleanup {
                target,
                maps: selected,
            };
            files.write("request.json", &cleanup)?;
            (files, cleanup)
        };
        self.require_unused(&cleanup.target, &cleanup.maps, jobs)?;
        for id in &cleanup.maps {
            maps.delete_map(id)?;
            inputs.delete_map(id)?;
        }
        match &cleanup.target {
            Target::Job { id } => {
                let path = JobFiles::new(&self.settings.resources.join(".jobs"), id)?.directory;
                fs::remove_dir_all(path)?;
                jobs.remove(id);
            }
            Target::Orphan { orphan } => self.delete_orphan(orphan, jobs, maps, inputs)?,
            _ => {}
        }
        self.cleanup_files(jobs, maps, inputs)?;
        fs::remove_dir_all(files.directory)
    }
    fn require_unused(
        &self,
        target: &Target,
        selected: &std::collections::BTreeSet<String>,
        jobs: &BTreeMap<String, Job>,
    ) -> io::Result<()> {
        for (id, job) in jobs {
            let status = job.status()?;
            if matches!(target, Target::Job { id: selected } if selected == id)
                && status.state == GenerationState::Running
            {
                return Err(io::Error::other(
                    "Stop the generation job before deleting it",
                ));
            }
            if selected.is_empty() {
                continue;
            }
            if status.state == GenerationState::Completed {
                continue;
            }
            let parent = status.details.as_ref().and_then(|d| d.parent.as_ref());
            let action: Option<Value> = job.files.read("action.json")?;
            let world = action
                .as_ref()
                .and_then(|a| a["request"]["worldId"].as_str());
            if parent.is_some_and(|p| selected.contains(&p.map_id))
                || world.is_some_and(|id| selected.contains(id))
            {
                return Err(io::Error::other(format!(
                    "Job {id} still uses this map; finish or delete that job first"
                )));
            }
        }
        Ok(())
    }
    fn delete_orphan(
        &self,
        orphan: &context_inventory::Orphan,
        jobs: &BTreeMap<String, Job>,
        maps: &PostgresMaps,
        inputs: &PrivateInputs,
    ) -> io::Result<()> {
        let entries = maps.inventory()?;
        if orphan
            .reference
            .as_ref()
            .is_some_and(|r| entries.iter().any(|m| &m.reference == r))
        {
            return Err(io::Error::other("These inputs belong to a retained map"));
        }
        match orphan.kind.as_str() {
            "inputs" => match &orphan.reference {
                Some(r) => {
                    self.require_unused(
                        &Target::Map {
                            id: r.map_id.clone(),
                            descendants: false,
                        },
                        &std::collections::BTreeSet::from([r.map_id.clone()]),
                        jobs,
                    )?;
                    inputs.delete_revision(r)
                }
                None => inputs.delete_catalog(&orphan.id),
            },
            // Files and geography are removed only after current references have been checked.
            _ => Ok(()),
        }
    }
    fn cleanup_files(
        &self,
        jobs: &BTreeMap<String, Job>,
        maps: &PostgresMaps,
        inputs: &PrivateInputs,
    ) -> io::Result<()> {
        let statuses = jobs
            .values()
            .map(Job::status)
            .collect::<io::Result<Vec<_>>>()?;
        if statuses.iter().any(|s| s.state == GenerationState::Running) {
            return Err(io::Error::other("Metadata deletion finished; file cleanup waits for running jobs. Retry cleanup from the library when they finish"));
        }
        let retention = Retention::collect(
            &inputs.inventory()?,
            &statuses,
            &self.settings.resources.join(".jobs"),
            &self.settings.resources,
        );
        retention.require_known()?;
        for orphan in context_files::orphan_files(
            &retention,
            &self.settings.resources,
            &self.settings.assets,
            &maps.asset_locations()?,
        )? {
            context_files::remove_file(&orphan, &self.settings.resources, &self.settings.assets)?;
        }
        for key in inputs
            .geography_ids()?
            .into_iter()
            .filter(|k| !retention.geography.contains(k))
        {
            inputs.remove_geography(&key)?;
        }
        Ok(())
    }
}
