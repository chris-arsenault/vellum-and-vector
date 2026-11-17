//! Authoring real-scale maps over published GIS storage (ADR 0016). The same orchestration
//! serves the browser's SQLite/GEOS catalog and the LAN PostGIS schema; each store supplies
//! the edit-step table and the one-transaction rewrite of an edited revision.
//!
//! An authored map keeps its id and revision. An edit rewrites the features it touched, the
//! features attached to them by snapped junctions and the hexes their old or new ground
//! covers, and records the step so undo and redo write the other side through the same path.
mod caves;
mod change;
mod clearance;
mod links;
mod marks;
mod town;
pub use town::{NoNames, TownNames};

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
        self.edit_named(reference, command, &NoNames)
    }
    /// An edit whose new streets and buildings take a name from `names` when given none.
    pub fn edit_named(
        &self,
        reference: &MapRef,
        command: &EditCommand,
        names: &dyn TownNames,
    ) -> io::Result<EditOutcome> {
        let map = self.editable(reference)?;
        let spatial = self
            .geometry()
            .spatial(space(&map, &map.primary_space_id)?.precision)?;
        let before = atlas_map::authoring::SpaceLayout::of(&map);
        let (map, cave_hexes) = caves::opening(self, map, command)?;
        let targets = self.targets(&map, command)?;
        let mut ids = || format!("authored-{}", uuid::Uuid::new_v4());
        let mut draft = plan(&map, command, &targets, &mut ids, spatial.as_ref()).map_err(other)?;
        town::name(&mut draft, &map.reference.map_id, names)?;
        let scope = change::Scope {
            store: self,
            map: &map,
            spatial: spatial.as_ref(),
        };
        let mut draft = change::complete(&scope, draft)?;
        draft = town::complete(&scope, draft)?;
        clearance::check(&scope, &draft)?;
        links::release(self, &map, &mut draft)?;
        caves::read_walls(self, &map, &mut draft, spatial.as_ref())?;
        // An underground space the change opened, with its layers and hexes, is part of the
        // step, so undoing the first cave wall closes it again.
        let opened: Vec<String> = cave_hexes.iter().map(|hex| hex.id.clone()).collect();
        if map.layers.len() != before.layers.len() {
            draft.spaces = Some(atlas_map::authoring::SpaceLayout::of(&map));
            draft.after.extend(cave_hexes);
        }
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
                spaces: draft.spaces.as_ref().map(|_| before.clone()),
            },
            after: atlas_map::authoring::EditSide {
                features: draft.after.clone(),
                layers: draft.layers.clone(),
                spaces: draft.spaces.clone(),
            },
        };
        let mut outcome = self.commit(map, draft, StepWrite::Append(&record), spatial.as_ref())?;
        // The opened grid is not what the creator drew; the wall is the change to select.
        outcome.changed.retain(|id| !opened.contains(id));
        Ok(outcome)
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
            spaces: record.before.spaces,
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
            spaces: record.after.spaces,
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
    /// Undo and redo write over what a step touched; a locked layer refuses that too, by the
    /// rule every edit uses. Features of a published layer the step itself opens or closes
    /// (an underground grid, a building level) come and go with that layer, not with a lock.
    fn unlocked(&self, map: &MapDescriptor, draft: &Draft) -> io::Result<()> {
        let real = editable(map).map_err(other)?;
        let laid_out = |layer: &str| {
            draft.spaces.as_ref().is_none_or(|layout| {
                layout.layers.iter().any(|kept| kept.id == layer)
                    && map.layers.iter().any(|kept| kept.id == layer)
            })
        };
        let held = draft
            .before
            .iter()
            .chain(&draft.after)
            .filter(|feature| laid_out(&feature.layer_id))
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
        let created = draft
            .after
            .iter()
            .filter(|f| !draft.before.iter().any(|old| old.id == f.id))
            .filter(|f| !atlas_map::authoring::is_hex_layer(&f.layer_id))
            .map(|f| f.id.clone())
            .collect();
        // A hex the change carries and re-marks is written once, as re-marked.
        let mut features: Vec<MapFeature> = draft
            .after
            .into_iter()
            .filter(|f| !hexes.iter().any(|hex| hex.id == f.id))
            .collect();
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
            created,
        })
    }
    fn targets(&self, map: &MapDescriptor, command: &EditCommand) -> io::Result<Vec<MapFeature>> {
        use atlas_map::authoring::EditTargets;
        let query = match command.targets() {
            EditTargets::Nothing => return Ok(Vec::new()),
            // Generated places outside the drawable layers are not edited. Hexes are read so
            // that planning can take their ground or cover class and refuse every other edit.
            EditTargets::Ids(ids) => FeatureQuery {
                feature_ids: Some(ids),
                layer_ids: Some(authorable(map).into_iter().chain(hex_layers(map)).collect()),
                ..Default::default()
            },
            EditTargets::Authorable => FeatureQuery {
                layer_ids: Some(authorable(map)),
                ..Default::default()
            },
            EditTargets::Around(bounds) => return town::around(self, map, bounds),
            EditTargets::Space(space_id) => FeatureQuery {
                space_id,
                ..Default::default()
            },
            EditTargets::Family(family) => FeatureQuery {
                layer_ids: Some(
                    map.layers
                        .iter()
                        .filter(|layer| atlas_map::authoring::family(&layer.id) == family)
                        .map(|layer| layer.id.clone())
                        .collect(),
                ),
                ..Default::default()
            },
        };
        let mut found = self.all(map, query)?;
        found.extend(self.foreign_target(map, command)?);
        Ok(found)
    }
    /// The feature on another map a connection names, under the combined id planning reads.
    fn foreign_target(
        &self,
        map: &MapDescriptor,
        command: &EditCommand,
    ) -> io::Result<Option<MapFeature>> {
        let (target, connecting) = match command {
            EditCommand::Connect { target, .. } => (target, true),
            EditCommand::Disconnect { target, .. } => (target, false),
            _ => return Ok(None),
        };
        let Some(map_id) = target
            .map_id
            .as_deref()
            .filter(|id| *id != map.reference.map_id)
        else {
            return Ok(None);
        };
        let found = match self.find_head(map_id)? {
            Some(head) => {
                let other = self.open(&head)?;
                let query = FeatureQuery {
                    feature_ids: Some(vec![target.feature_id.clone()]),
                    ..Default::default()
                };
                self.all(&other, query)?.pop().ok_or(other.name)
            }
            None => Err("this catalogue".into()),
        };
        match found {
            Ok(mut feature) => {
                feature.id = atlas_map::structure::connection_target(map_id, &target.feature_id);
                Ok(Some(feature))
            }
            // A link to a map or feature that is gone can still be let go of.
            Err(_) if !connecting => Ok(None),
            Err(place) => Err(io::Error::other(format!("That feature is not on {place}"))),
        }
    }
    /// Every page of a query. A query naming a space reads that space only; otherwise it reads
    /// every located space holding one of its layers (each layer lies in one space), or every
    /// space when it names no layers, so cave and building-level features edit like the surface.
    fn all(&self, map: &MapDescriptor, query: FeatureQuery) -> io::Result<Vec<MapFeature>> {
        let mut items = Vec::new();
        for space in query_spaces(map, &query) {
            let mut query = FeatureQuery {
                space_id: space,
                ..query.clone()
            };
            loop {
                let Page { items: page, next } = match self.features(&map.reference, &query) {
                    Ok(page) => page,
                    // A space this change opens (a first cave wall's underground) holds no
                    // stored features yet.
                    Err(_) if !self.stored_space(map, &query.space_id)? => break,
                    Err(error) => return Err(error),
                };
                items.extend(page);
                if next.is_none() {
                    break;
                }
                query.cursor = next;
            }
        }
        Ok(items)
    }
    fn stored_space(&self, map: &MapDescriptor, space: &str) -> io::Result<bool> {
        let stored = self.open(&map.reference)?;
        Ok(stored.spaces.iter().any(|entry| entry.id == space))
    }
}
/// The located spaces a query reads, in descriptor order.
fn query_spaces(map: &MapDescriptor, query: &FeatureQuery) -> Vec<String> {
    if !query.space_id.is_empty() {
        return vec![query.space_id.clone()];
    }
    map.spaces
        .iter()
        .filter(|space| {
            query.layer_ids.as_ref().is_none_or(|layers| {
                map.layers
                    .iter()
                    .any(|layer| layer.space_id == space.id && layers.contains(&layer.id))
            })
        })
        .map(|space| space.id.clone())
        .collect()
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
/// The map's hex grids: the surface's and, under it, the caves'.
fn hex_layers(map: &MapDescriptor) -> impl Iterator<Item = String> + '_ {
    map.layers
        .iter()
        .filter(|layer| atlas_map::authoring::is_hex_layer(&layer.id))
        .map(|layer| layer.id.clone())
}
fn other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
