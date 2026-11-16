//! Authoring real-scale maps over published GIS storage (ADR 0016). The same orchestration
//! serves the browser's SQLite/GEOS catalog and the LAN PostGIS schema; each store supplies
//! the edit-step table and the one-transaction rewrite of an edited revision.
//!
//! An authored map keeps its id and revision. An edit rewrites the features it touched, the
//! features attached to them by snapped junctions and the hexes their old or new ground
//! covers, and records the step so undo and redo write the other side through the same path.
mod change;
mod marks;

use crate::map_store::{space, FeatureQuery, MapAccess, Page};
use atlas_map::{
    authoring::{
        editable, in_locked_layer, plan, Draft, EditCommand, EditHistory, EditOutcome, EditRecord,
        EditStep,
    },
    MapDescriptor, MapFeature, MapRef, PublicationState,
};
use std::io;

/// Rewrite one edited revision. Every id in `removed` is deleted before `features` are
/// written; `map` replaces the stored descriptor.
pub struct EditWrite<'a> {
    pub map: &'a MapDescriptor,
    pub removed: &'a [String],
    pub features: Vec<MapFeature>,
    pub step: StepWrite<'a>,
}
pub enum StepWrite<'a> {
    /// A new step; steps that were undone are dropped first, as redo no longer applies.
    Append(&'a EditRecord),
    /// Undo or redo of a stored step.
    Mark { sequence: u32, undone: bool },
}
/// The storage an edit needs beyond map reads.
pub trait EditStore: MapAccess {
    fn edit_steps(&self, reference: &MapRef) -> io::Result<Vec<EditStep>>;
    fn edit_record(&self, reference: &MapRef, sequence: u32) -> io::Result<EditRecord>;
    fn write_edit(&self, write: EditWrite<'_>) -> io::Result<()>;
}

impl dyn EditStore + '_ {
    pub fn edit(&self, reference: &MapRef, command: &EditCommand) -> io::Result<EditOutcome> {
        let map = self.editable(reference)?;
        let spatial = self
            .geometry()
            .spatial(space(&map, &map.primary_space_id)?.precision)?;
        let targets = self.targets(&map, command)?;
        let mut ids = || format!("authored-{}", uuid::Uuid::new_v4());
        let draft = plan(&map, command, &targets, &mut ids, spatial.as_ref()).map_err(other)?;
        let scope = change::Scope {
            store: self,
            map: &map,
            spatial: spatial.as_ref(),
        };
        let draft = change::complete(&scope, draft)?;
        let record = EditRecord {
            label: draft.label.clone(),
            before: atlas_map::authoring::EditSide {
                features: draft.before.clone(),
                layers: draft
                    .layers
                    .as_ref()
                    .map(|_| editable(&map).map(|real| real.creator_layers.clone()))
                    .transpose()
                    .map_err(other)?,
            },
            after: atlas_map::authoring::EditSide {
                features: draft.after.clone(),
                layers: draft.layers.clone(),
            },
        };
        self.commit(map, draft, StepWrite::Append(&record), spatial.as_ref())
    }
    pub fn undo(&self, reference: &MapRef) -> io::Result<EditOutcome> {
        let map = self.editable(reference)?;
        let step = self
            .edit_steps(reference)?
            .into_iter()
            .rev()
            .find(|step| !step.undone)
            .ok_or_else(|| io::Error::other("Nothing to undo"))?;
        let record = self.edit_record(reference, step.sequence)?;
        let draft = Draft {
            label: record.label,
            before: record.after.features,
            after: record.before.features,
            layers: record.before.layers,
        };
        self.replay(map, draft, step.sequence, true)
    }
    pub fn redo(&self, reference: &MapRef) -> io::Result<EditOutcome> {
        let map = self.editable(reference)?;
        let step = self
            .edit_steps(reference)?
            .into_iter()
            .find(|step| step.undone)
            .ok_or_else(|| io::Error::other("Nothing to redo"))?;
        let record = self.edit_record(reference, step.sequence)?;
        let draft = Draft {
            label: record.label,
            before: record.before.features,
            after: record.after.features,
            layers: record.after.layers,
        };
        self.replay(map, draft, step.sequence, false)
    }
    pub fn edit_history(&self, reference: &MapRef) -> io::Result<EditHistory> {
        self.open(reference)?;
        Ok(EditHistory {
            steps: self.edit_steps(reference)?,
        })
    }
    fn editable(&self, reference: &MapRef) -> io::Result<MapDescriptor> {
        let map = self.open(reference)?;
        editable(&map).map_err(other)?;
        if map.state != PublicationState::Complete {
            return Err(io::Error::other(
                "Wait for the map to finish before editing it",
            ));
        }
        if self.find_head(&reference.map_id)?.as_ref() != Some(reference) {
            return Err(io::Error::other(
                "Edit this map's current revision; reopen the map first",
            ));
        }
        Ok(map)
    }
    /// Undo and redo write over what a step touched; a locked layer refuses that too.
    fn unlocked(&self, map: &MapDescriptor, draft: &Draft) -> io::Result<()> {
        let real = editable(map).map_err(other)?;
        let held = draft
            .before
            .iter()
            .chain(&draft.after)
            .find(|feature| in_locked_layer(feature, real));
        match held {
            Some(feature) => Err(io::Error::other(format!(
                "{} is on a locked layer; unlock it first",
                feature.name.as_deref().unwrap_or(&feature.kind)
            ))),
            None => Ok(()),
        }
    }
    fn replay(
        &self,
        map: MapDescriptor,
        draft: Draft,
        sequence: u32,
        undone: bool,
    ) -> io::Result<EditOutcome> {
        self.unlocked(&map, &draft)?;
        let spatial = self
            .geometry()
            .spatial(space(&map, &map.primary_space_id)?.precision)?;
        self.commit(
            map,
            draft,
            StepWrite::Mark { sequence, undone },
            spatial.as_ref(),
        )
    }
    /// Write a completed change with its re-marked hexes and the updated descriptor.
    fn commit(
        &self,
        map: MapDescriptor,
        draft: Draft,
        step: StepWrite<'_>,
        spatial: &dyn atlas_map::spatial::SpatialKernel,
    ) -> io::Result<EditOutcome> {
        let hexes = marks::remarked(self, &map, &draft, spatial)?;
        let next = change::descriptor(map, &draft)?;
        let mut removed: Vec<String> = draft
            .before
            .iter()
            .chain(&draft.after)
            .chain(&hexes)
            .map(|feature| feature.id.clone())
            .collect();
        removed.sort();
        removed.dedup();
        let changed = removed
            .iter()
            .filter(|id| !hexes.iter().any(|hex| &hex.id == *id))
            .cloned()
            .collect();
        let mut features = draft.after;
        features.extend(hexes);
        self.write_edit(EditWrite {
            map: &next,
            removed: &removed,
            features,
            step,
        })?;
        Ok(EditOutcome {
            history: EditHistory {
                steps: self.edit_steps(&next.reference)?,
            },
            map: next,
            changed,
        })
    }
    fn targets(&self, map: &MapDescriptor, command: &EditCommand) -> io::Result<Vec<MapFeature>> {
        use atlas_map::authoring::EditTargets;
        let query = match command.targets() {
            EditTargets::Nothing => return Ok(Vec::new()),
            // Hexes and generated places outside the drawable layers are not edited.
            EditTargets::Ids(ids) => FeatureQuery {
                feature_ids: Some(ids),
                layer_ids: Some(authorable(map)),
                ..Default::default()
            },
            EditTargets::Authorable => FeatureQuery {
                layer_ids: Some(authorable(map)),
                ..Default::default()
            },
        };
        self.all(map, query)
    }
    /// Every page of a query in the map's primary space.
    fn all(&self, map: &MapDescriptor, mut query: FeatureQuery) -> io::Result<Vec<MapFeature>> {
        query.space_id = map.primary_space_id.clone();
        let mut items = Vec::new();
        loop {
            let Page { items: page, next } = self.features(&map.reference, &query)?;
            items.extend(page);
            if next.is_none() {
                return Ok(items);
            }
            query.cursor = next;
        }
    }
}
/// Generation never replaces an authored map: its published layers are the authority.
pub fn refuse_authored(current: &MapDescriptor) -> io::Result<()> {
    if current
        .real_scale
        .as_ref()
        .is_some_and(|real| real.authored())
    {
        return Err(io::Error::other(
            "This map has been edited by hand; regenerating it would replace the authored features",
        ));
    }
    Ok(())
}
/// Published layers whose features a creator edits.
fn authorable(map: &MapDescriptor) -> Vec<String> {
    map.layers
        .iter()
        .filter(|layer| atlas_map::authoring::shape_of(&layer.id).is_some())
        .map(|layer| layer.id.clone())
        .collect()
}
fn other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
