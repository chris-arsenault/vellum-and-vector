//! A planned change completed against the map around it: footprints, the junctions a moved
//! shape now makes, and the attached features that follow a moved or removed line.
use super::{other, EditStore};
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{
        attach, crosses, editable, follow, footprint, is_junction, junctions, shape_of, Draft,
        Shape,
    },
    spatial::SpatialKernel,
    Bounds, MapDescriptor, MapFeature,
};
use std::{collections::BTreeSet, io};

/// The store, map and geometry kernel one edit reads through.
pub(super) struct Scope<'a> {
    pub store: &'a dyn EditStore,
    pub map: &'a MapDescriptor,
    pub spatial: &'a dyn SpatialKernel,
}

pub(super) fn complete(scope: &Scope<'_>, mut draft: Draft) -> io::Result<Draft> {
    let tolerance = editable(scope.map).map_err(other)?.across_flats / 100.0;
    let planned = draft.after.len();
    for index in 0..planned {
        scope.settle(&mut draft, index, tolerance)?;
    }
    scope.follow_hosts(&mut draft, tolerance)?;
    // A follower's junctions are read again from where it now lies.
    for index in planned..draft.after.len() {
        scope.settle(&mut draft, index, tolerance)?;
    }
    scope.crossings_over(&mut draft, tolerance)?;
    Ok(draft)
}
/// Whether a changed feature now has a new shape (or is new).
fn reshaped(draft: &Draft, feature: &MapFeature) -> bool {
    draft
        .before
        .iter()
        .find(|old| old.id == feature.id)
        .is_none_or(|old| old.geometry != feature.geometry)
}
impl Scope<'_> {
    /// Footprint, and for a new shape its junctions with the lines it now meets.
    fn settle(&self, draft: &mut Draft, index: usize, tolerance: f64) -> io::Result<()> {
        draft.after[index].footprint =
            footprint(&draft.after[index], self.spatial).map_err(other)?;
        if reshaped(draft, &draft.after[index]) {
            let lines = self.lines_near(draft, &draft.after[index], tolerance)?;
            attach(&mut draft.after[index], &lines, tolerance, self.spatial).map_err(other)?;
        }
        Ok(())
    }
    /// Features attached to a moved or removed line follow it, and so on down the junctions.
    fn follow_hosts(&self, draft: &mut Draft, tolerance: f64) -> io::Result<()> {
        let mut queue: Vec<(MapFeature, Option<MapFeature>)> = draft
            .before
            .iter()
            .filter(|old| shape_of(&old.layer_id) == Some(Shape::Line))
            .filter_map(|old| {
                let new = draft.after.iter().find(|new| new.id == old.id);
                (new.is_none_or(|new| new.geometry != old.geometry))
                    .then(|| (old.clone(), new.cloned()))
            })
            .collect();
        while let Some((old, new)) = queue.pop() {
            for dependent in self.dependents(draft, &old, tolerance)? {
                let next = self.followed(draft, &dependent, &old, new.as_ref())?;
                let line = shape_of(&next.layer_id) == Some(Shape::Line);
                if line && next.geometry != dependent.geometry {
                    queue.push((dependent.clone(), Some(next.clone())));
                }
                draft.before.push(dependent);
                draft.after.push(next);
            }
        }
        Ok(())
    }
    /// Crossings over a new or reshaped line that are not in the change read their junctions
    /// again: a stream drawn under a bridge is spanned by it.
    fn crossings_over(&self, draft: &mut Draft, tolerance: f64) -> io::Result<()> {
        let lines: Vec<MapFeature> = draft
            .after
            .iter()
            .filter(|f| shape_of(&f.layer_id) == Some(Shape::Line) && reshaped(draft, f))
            .cloned()
            .collect();
        for line in lines {
            let query = FeatureQuery {
                bounds: Some(self.near(&line.geometry, tolerance)?),
                layer_ids: Some(super::authorable(self.map)),
                ..Default::default()
            };
            for crossing in self.store.all(self.map, query)? {
                if !crosses(&crossing) || ids(draft).contains(crossing.id.as_str()) {
                    continue;
                }
                let mut next = crossing.clone();
                let around = self.lines_near(draft, &next, tolerance)?;
                attach(&mut next, &around, tolerance, self.spatial).map_err(other)?;
                if junctions(&next) != junctions(&crossing) {
                    draft.before.push(crossing);
                    draft.after.push(next);
                }
            }
        }
        Ok(())
    }
    /// The attached feature after its host line moved, or without its junction when it went.
    fn followed(
        &self,
        draft: &Draft,
        dependent: &MapFeature,
        old: &MapFeature,
        new: Option<&MapFeature>,
    ) -> io::Result<MapFeature> {
        let mut next = dependent.clone();
        let Some(new) = new else {
            next.relations
                .retain(|relation| relation.target_id != old.id);
            return Ok(next);
        };
        let partner = dependent
            .relations
            .iter()
            .find(|relation| relation.target_id != old.id && is_junction(&relation.kind))
            .map(|relation| self.current(draft, &relation.target_id))
            .transpose()?
            .flatten();
        let moved = follow(
            dependent,
            &old.id,
            &old.geometry,
            &new.geometry,
            partner.as_ref().map(|p| &p.geometry),
            self.spatial,
        )
        .map_err(other)?;
        if let Some(moved) = moved {
            next = moved;
            next.geometry = self.spatial.canonical(&next.geometry).map_err(other)?;
        }
        Ok(next)
    }
    /// Features near a line that hold a junction with it and are not already in the change.
    fn dependents(
        &self,
        draft: &Draft,
        host: &MapFeature,
        tolerance: f64,
    ) -> io::Result<Vec<MapFeature>> {
        let taken = ids(draft);
        let around = self.store.all(
            self.map,
            FeatureQuery {
                bounds: Some(self.near(&host.geometry, tolerance)?),
                layer_ids: Some(super::authorable(self.map)),
                footprints: true,
                ..Default::default()
            },
        )?;
        Ok(around
            .into_iter()
            .filter(|feature| !taken.contains(feature.id.as_str()))
            .filter(|feature| {
                feature
                    .relations
                    .iter()
                    .any(|relation| relation.target_id == host.id && is_junction(&relation.kind))
            })
            .collect())
    }
    /// Line features a shape may meet, as they will stand after the change.
    fn lines_near(
        &self,
        draft: &Draft,
        feature: &MapFeature,
        tolerance: f64,
    ) -> io::Result<Vec<MapFeature>> {
        let layers: Vec<String> = super::authorable(self.map)
            .into_iter()
            .filter(|id| shape_of(id) == Some(Shape::Line))
            .collect();
        let found = self.store.all(
            self.map,
            FeatureQuery {
                bounds: Some(self.near(&feature.geometry, tolerance)?),
                layer_ids: Some(layers.clone()),
                ..Default::default()
            },
        )?;
        let changed = ids(draft);
        let mut lines: Vec<MapFeature> = found
            .into_iter()
            .filter(|line| !changed.contains(line.id.as_str()))
            .collect();
        lines.extend(
            draft
                .after
                .iter()
                .filter(|line| layers.contains(&line.layer_id))
                .cloned(),
        );
        Ok(lines)
    }
    /// A feature as it will stand: its changed version, else the stored one.
    fn current(&self, draft: &Draft, id: &str) -> io::Result<Option<MapFeature>> {
        if let Some(feature) = draft.after.iter().find(|feature| feature.id == id) {
            return Ok(Some(feature.clone()));
        }
        if draft.before.iter().any(|feature| feature.id == id) {
            return Ok(None);
        }
        let query = FeatureQuery {
            feature_ids: Some(vec![id.into()]),
            ..Default::default()
        };
        Ok(self.store.all(self.map, query)?.pop())
    }
    fn near(&self, geometry: &atlas_map::Geometry, by: f64) -> io::Result<Bounds> {
        let Bounds(w, s, e, n) = self.spatial.bounds(geometry).map_err(other)?;
        Ok(Bounds(w - by, s - by, e + by, n + by))
    }
}
fn ids(draft: &Draft) -> BTreeSet<&str> {
    draft
        .before
        .iter()
        .chain(&draft.after)
        .map(|feature| feature.id.as_str())
        .collect()
}
/// The descriptor after a change: one more edit, its creator layers and its kind counts.
pub(super) fn descriptor(mut map: MapDescriptor, draft: &Draft) -> io::Result<MapDescriptor> {
    let real = map
        .real_scale
        .as_mut()
        .ok_or_else(|| io::Error::other("Only real-scale maps can be edited"))?;
    real.edits = real.edits.saturating_add(1);
    if let Some(layers) = &draft.layers {
        real.creator_layers = layers.clone();
    }
    let kept = |list: &[MapFeature], id: &str| list.iter().any(|feature| feature.id == id);
    let removed = draft.before.iter().filter(|f| !kept(&draft.after, &f.id));
    let created = draft.after.iter().filter(|f| !kept(&draft.before, &f.id));
    for (feature, delta) in removed.map(|f| (f, -1)).chain(created.map(|f| (f, 1))) {
        let entry = map
            .layers
            .iter_mut()
            .filter(|layer| layer.id == feature.layer_id)
            .flat_map(|layer| layer.catalog.feature_types.iter_mut())
            .find(|kind| kind.id == feature.type_id);
        if let Some(kind) = entry {
            kind.count = kind.count.saturating_add_signed(delta);
        }
    }
    Ok(map)
}
