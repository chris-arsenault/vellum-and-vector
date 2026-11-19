//! Map ownership and authored record checks from the working-map boundary.
pub mod boundary;
pub mod interfaces;
use super::state::{Scope, State};
use crate::features::{Feature, FeatureReader, FeatureSelection, State as RecordState};
use crate::{
    reconstruction::{
        extrema,
        traits::{Area, Trait},
    },
    spatial::Predicate,
    storage::{Coverage, SharedCache},
};
use serde::{Deserialize, Serialize};
// hpc-exempt: publication channel names and their domain facts, not cell-indexed state.
use std::collections::BTreeMap;
use std::{io, rc::Rc};

#[derive(Clone, Serialize, Deserialize)]
pub struct SurfaceRules {
    pub traits: Vec<Trait>,
    pub boundary: Vec<boundary::Sample>,
    // hpc-exempt: layer catalogue facts resolved by the domain application.
    pub facts: BTreeMap<String, String>,
}
impl SurfaceRules {
    fn validate(&self, state: &State, cache: SharedCache) -> io::Result<()> {
        if self.traits.is_empty() && self.boundary.is_empty() {
            return Ok(());
        }
        let surface = &state.physical.surface;
        let mut coverage = Coverage::samples(surface.grid().measures.len(), cache);
        let mut query = extrema::Query {
            spatial: state.spatial.as_ref(),
            precision: state.scope.precision,
            coverage: &mut coverage,
        };
        let area = Area {
            footprint: &state.scope.footprint,
            traits: &self.traits,
        };
        for (name, channel) in surface.channels() {
            let Some(fact) = self.facts.get(name) else {
                continue;
            };
            let field = extrema::Field {
                grid: surface.grid(),
                footprint: &state.physical.field_footprint,
                values: channel.values(),
                discrete: extrema::discrete(&channel.unit, channel.quantity),
                overlays: Vec::new(),
            };
            query.validate_traits(&area, &field, name, fact)?;
            boundary::validate(&self.boundary, state, &field, fact, query.coverage)?;
        }
        Ok(())
    }
}
pub struct Ownership {
    scope: Scope,
    original: Rc<dyn FeatureReader>,
    surface: SurfaceRules,
    cache: SharedCache,
    interfaces: interfaces::Rules,
}
fn authored(protected: bool, state: RecordState) -> bool {
    protected || matches!(state, RecordState::Authored | RecordState::Protected)
}
fn protection(before: &Feature, after: Option<&Feature>) -> io::Result<()> {
    if authored(before.protected, before.state) && after != Some(before) {
        return Err(io::Error::other(
            "Generation preserves authored feature content, ownership and protection",
        ));
    }
    for (area, detail) in &before.detail {
        if authored(detail.protected, detail.state)
            && after.and_then(|f| f.detail.get(area)) != Some(detail)
        {
            return Err(io::Error::other(
                "Generation preserves authored detail and its protection",
            ));
        }
    }
    Ok(())
}
impl Ownership {
    pub fn new(
        scope: &Scope,
        original: Rc<dyn FeatureReader>,
        surface: SurfaceRules,
        cache: SharedCache,
        interfaces: interfaces::Rules,
    ) -> io::Result<Self> {
        for rule in &surface.traits {
            rule.validate()?;
        }
        Ok(Self {
            scope: scope.clone(),
            original,
            surface,
            cache,
            interfaces,
        })
    }
    // owner-direction(2026-11-13): numerical accuracy and reproducibility are not goals of this repository, and guarding them is forbidden.
    pub fn validate(&self, state: &State) -> io::Result<()> {
        if self.scope != state.scope {
            return Err(io::Error::other(
                "Generation retains the pinned world, located context and spatial reference",
            ));
        }
        let grid = state.physical.surface.grid();
        let [w, s, e, n] = grid.bounds;
        let footprint = crate::features::chart::working(
            &self.scope.footprint,
            atlas_map::Bounds(w, s, e, n),
            grid.periodic_width,
            state.spatial.as_ref(),
        )
        .map_err(io::Error::other)?;
        if !state
            .spatial
            .relation(
                &footprint,
                &state.physical.field_footprint,
                Predicate::Covers,
            )
            .map_err(io::Error::other)?
        {
            return Err(io::Error::other(
                "Generation retains the pinned context and write extent",
            ));
        }
        for before in self.original.values(FeatureSelection::default())? {
            let before = before?;
            let after = state.records.features.get(before.id)?;
            protection(&before, after.as_ref())?;
            if Some(&before) != after.as_ref() {
                self.changed(Some(&before), after.as_ref())?;
            }
        }
        for after in state.records.features.values(FeatureSelection::default())? {
            let after = after?;
            if self.original.get(after.id)?.is_none() {
                self.changed(None, Some(&after))?;
            }
        }
        self.interfaces.validate(
            self.original.as_ref(),
            state.records.features.as_ref(),
            &self.scope,
            state.spatial.as_ref(),
        )?;
        self.surface.validate(state, self.cache.clone())
    }
    fn changed(&self, before: Option<&Feature>, after: Option<&Feature>) -> io::Result<()> {
        if self.scope.owns_map_geography
            && before
                .into_iter()
                .chain(after)
                .any(|f| f.area_id != self.scope.area)
        {
            return Err(io::Error::other(
                "Generation changes only geography owned by the active map",
            ));
        }
        Ok(())
    }
}
