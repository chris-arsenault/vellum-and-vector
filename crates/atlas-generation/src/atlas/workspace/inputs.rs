//! Input selection stays scoped to the map's captured geography and explicit reopen intent.
use crate::{
    atlas::state::Scope,
    field::inheritance::{resources::Resource, Inputs},
    spatial::{Predicate, SpatialKernel},
};
use atlas_map::Geometry;
use std::{collections::BTreeMap, io, rc::Rc};

pub struct Record {
    pub area: atlas_map::Id,
    pub space: atlas_map::Id,
    pub input: bool,
    pub resolution: Option<f64>,
    pub footprint: Geometry,
    pub resource: Rc<Resource>,
}
pub struct Selection<'a> {
    pub scope: &'a Scope,
    pub owned_geography: bool,
    pub reopened: bool,
    pub ancestors: &'a [atlas_map::Id],
}
impl Selection<'_> {
    /// Pinned parent context seeds the child's added margin through the resource sampler's
    /// existing edge support. Ordinary present fields still need complete coverage.
    pub fn supports(
        &self,
        input: bool,
        footprint: &Geometry,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        if self.owned_geography && input {
            let overlap = spatial
                .overlay(
                    footprint,
                    &self.scope.footprint,
                    crate::spatial::Overlay::Intersection,
                )
                .map_err(io::Error::other)?;
            return overlap.map_or(Ok(false), |shape| {
                spatial
                    .area(&shape)
                    .map(|area| area > 0.0)
                    .map_err(io::Error::other)
            });
        }
        spatial
            .relation(footprint, &self.scope.footprint, Predicate::Covers)
            .map_err(io::Error::other)
    }
    pub fn accepts(&self, area: atlas_map::Id, space: atlas_map::Id, input: bool) -> bool {
        space == self.scope.space
            && if self.owned_geography {
                area == self.scope.area && (input || self.reopened)
            } else {
                area != self.scope.area && self.ancestors.contains(&area)
            }
    }
    fn prefer(&self, candidate: &Record, previous: &Record) -> bool {
        let present = self.owned_geography && !candidate.input;
        let was_present = self.owned_geography && !previous.input;
        if present != was_present {
            present
        } else {
            candidate.resolution.unwrap_or(f64::INFINITY)
                < previous.resolution.unwrap_or(f64::INFINITY)
        }
    }
    pub fn resolve(
        &self,
        records: &[Record],
        surface: Rc<Resource>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Inputs> {
        let parent = self.channels(records, surface.grid.periodic_width, spatial)?;
        Ok(Inputs { surface, parent })
    }
    pub fn channels(
        &self,
        records: &[Record],
        periodic_width: Option<f64>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<BTreeMap<String, Rc<Resource>>> {
        let mut chosen: BTreeMap<String, &Record> = BTreeMap::new();
        for record in records {
            if !self.accepts(record.area, record.space, record.input)
                || !self.supports(record.input, &record.footprint, spatial)?
            {
                continue;
            }
            for name in record.resource.channels.keys() {
                if chosen
                    .get(name)
                    .is_none_or(|previous| self.prefer(record, previous))
                {
                    chosen.insert(name.clone(), record);
                }
            }
        }
        // One captured resource per selected record, shared by all its channels.
        let mut resources: Vec<(&Record, Rc<Resource>)> = Vec::new();
        Ok(chosen
            .into_iter()
            .map(|(name, record)| {
                let resource = if let Some((_, resource)) = resources
                    .iter()
                    .find(|(candidate, _)| std::ptr::eq(*candidate, record))
                {
                    resource.clone()
                } else {
                    let mut resource = record.resource.in_chart(periodic_width);
                    resource.resolution = record.resolution;
                    let resource = Rc::new(resource);
                    resources.push((record, resource.clone()));
                    resource
                };
                (name, resource)
            })
            .collect())
    }
}
