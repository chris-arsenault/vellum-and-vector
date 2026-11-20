//! Resolve following relationships and authored representations before GIS publication.
mod geometry;
mod presentation;
pub use presentation::present;

use super::{context::Context, Feature, FeatureReader, Representation, State};
use crate::{
    atlas::resolution::Profile,
    spatial::{Overlay, SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Id};
use geometry::{combine, dimension};

pub struct Composition<'a> {
    pub context: &'a Context,
    pub features: &'a dyn FeatureReader,
    pub spatial: &'a dyn SpatialKernel,
    pub area: Id,
    pub profile: Profile,
}
impl Composition<'_> {
    fn eligible(
        &self,
        feature: &Feature,
        area: Id,
        detail: &Representation,
        all: bool,
    ) -> SpatialResult<bool> {
        Ok((all || self.context.descendant(self.area, area)?)
            && (all || self.context.area(area)?.profile <= self.profile)
            && !detail.needs_reconciliation
            && !matches!(detail.state, State::Stale | State::Unmaterialized)
            && self.context.space(area)? == self.context.space(feature.area_id)?)
    }
    pub fn geometry(&self, feature: &Feature) -> SpatialResult<Option<Geometry>> {
        self.compose(feature, &[], false)
    }
    pub fn geometry_all(&self, feature: &Feature) -> SpatialResult<Option<Geometry>> {
        self.compose(feature, &[], true)
    }
    fn compose(
        &self,
        feature: &Feature,
        path: &[Id],
        all: bool,
    ) -> SpatialResult<Option<Geometry>> {
        if path.contains(&feature.id) {
            return Err("Following relationships must be acyclic".into());
        }
        let own_area = self.context.area(feature.area_id)?;
        let dim = dimension(&feature.geometry);
        let follows = feature
            .relations
            .iter()
            .filter(|r| r.kind == "follows")
            .collect::<Vec<_>>();
        let mut geometry = Some(feature.geometry.clone());
        if !follows.is_empty() {
            if dim != 1 {
                return Err("Following relationships require line geometry".into());
            }
            let mut parts = Vec::new();
            let mut path = path.to_vec();
            path.push(feature.id);
            for relation in follows {
                let target = self
                    .features
                    .get(relation.target_id)
                    .map_err(|e| e.to_string())?
                    .ok_or("A following relationship needs its source feature")?;
                if self.context.space(target.area_id)? != self.context.space(feature.area_id)? {
                    return Err("A line can follow geography in its own located space".into());
                }
                if let Some(shape) = self.compose(&target, &path, all)? {
                    parts.extend(self.spatial.overlay(
                        &shape,
                        &own_area.footprint,
                        Overlay::Intersection,
                    )?);
                }
            }
            geometry = combine(parts, dim, self.spatial)?;
        }
        let mut details = Vec::new();
        for (&id, detail) in &feature.detail {
            if self.eligible(feature, id, detail, all)? {
                details.push((self.context.lineage(id)?.len(), id, detail));
            }
        }
        // hpc-exempt: feature representation ancestry, not numerical cell ordering.
        details.sort_by_key(|a| (a.0, a.1));
        for (_, id, detail) in details {
            let footprint = &self.context.area(id)?.footprint;
            let mut parts = Vec::new();
            if let Some(shape) = geometry {
                parts.extend(
                    self.spatial
                        .overlay(&shape, footprint, Overlay::Difference)?,
                );
            }
            if detail.state != State::IntentionallyEmpty {
                parts.extend(self.spatial.overlay(
                    &detail.geometry,
                    footprint,
                    Overlay::Intersection,
                )?);
            }
            geometry = combine(parts, dim, self.spatial)?;
        }
        Ok(geometry)
    }
    pub fn footprint(&self, feature: &Feature) -> SpatialResult<Option<Geometry>> {
        self.compose_footprint(feature, false)
    }
    pub fn footprint_all(&self, feature: &Feature) -> SpatialResult<Option<Geometry>> {
        self.compose_footprint(feature, true)
    }
    fn compose_footprint(&self, feature: &Feature, all: bool) -> SpatialResult<Option<Geometry>> {
        let mut base = feature.footprint.clone();
        if base.is_none() {
            for (&id, detail) in &feature.detail {
                if detail.footprint.is_some()
                    && detail.state != State::IntentionallyEmpty
                    && self.eligible(feature, id, detail, all)?
                {
                    base = detail.footprint.clone();
                    break;
                }
            }
        }
        let Some(base) = base else { return Ok(None) };
        let mut footprint = feature.clone();
        footprint.geometry = base.clone();
        footprint.relations.clear();
        footprint.detail.retain(|_, detail| {
            if detail.footprint.is_none() && detail.state != State::IntentionallyEmpty {
                return false;
            }
            detail.geometry = detail.footprint.clone().unwrap_or_else(|| base.clone());
            true
        });
        self.compose(&footprint, &[], all)
    }
}
