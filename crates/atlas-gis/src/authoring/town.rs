//! Town tools completed against the map around a change (ADR 0016). An unnamed street or
//! building takes a name from its settlement's naming culture; then every street the change
//! touches is renumbered and its buildings and plots readdressed, in the same undo step. A
//! moved or new building fronts the street of the plot it stands in, else the nearest street.
use super::{change::Scope, other, EditStore};
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{
        family, holds_address, in_locked_layer, is_building, is_street, is_yard, readdress,
        renumber, street_of, Draft, FRONTAGE_REACH, NAMING_WORK,
    },
    regions::point,
    spatial::Predicate,
    town::Use,
    Bounds, Geometry, MapDescriptor, MapFeature, Position,
};
use serde_json::Value;
use std::{collections::BTreeSet, io};

/// Names from a naming culture's vocabulary, supplied by the host that composes naming.
pub trait TownNames {
    /// A name of the naming work kind (`street`, `lane`, `inn`, `household`…) in a culture,
    /// chosen from `seed`; an unknown culture still gives a name.
    fn work(&self, culture: Option<&str>, work: &str, seed: &str) -> io::Result<String>;
}
/// For stores used without a naming host: town commands that need a name refuse.
pub struct NoNames;
impl TownNames for NoNames {
    fn work(&self, _: Option<&str>, _: &str, _: &str) -> io::Result<String> {
        Err(io::Error::other(
            "Name the street or building; naming is not available here",
        ))
    }
}
/// How far from its street a generated plot's building may stand, in metres.
const HOLDER_REACH: f64 = 100.0;

/// What a town command reads: drawable surface features in the bounds, and every settlement.
pub(super) fn around(
    store: &dyn EditStore,
    map: &MapDescriptor,
    bounds: Bounds,
) -> io::Result<Vec<MapFeature>> {
    let surface = |layers: Vec<String>, bounds: Option<Bounds>| FeatureQuery {
        space_id: map.primary_space_id.clone(),
        bounds,
        layer_ids: Some(layers),
        ..Default::default()
    };
    let settlements = map
        .layers
        .iter()
        .filter(|layer| family(&layer.id) == "settlements")
        .map(|layer| layer.id.clone())
        .collect();
    let mut found = store.all(map, surface(super::authorable(map), Some(bounds)))?;
    found.extend(store.all(map, surface(settlements, None))?);
    Ok(found)
}

/// Give unnamed new streets and buildings a name; the step's label names it too.
pub(super) fn name(draft: &mut Draft, map_id: &str, names: &dyn TownNames) -> io::Result<()> {
    let existing: BTreeSet<String> = draft.before.iter().map(|f| f.id.clone()).collect();
    let mut given = Vec::new();
    for feature in draft.after.iter_mut() {
        if existing.contains(&feature.id) {
            continue;
        }
        let Some(work) = feature.attributes.remove(NAMING_WORK) else {
            continue;
        };
        let work = work.as_str().unwrap_or("street").to_owned();
        let culture = feature
            .attributes
            .get("namingCulture")
            .and_then(Value::as_str);
        let name = names.work(culture, &work, &format!("{map_id}:{}:{work}", feature.id))?;
        if is_building(feature) {
            feature
                .attributes
                .insert(keeper(feature).into(), name.clone().into());
        }
        feature.name = Some(name.clone());
        given.push(name);
    }
    if let [name] = given.as_slice() {
        let verb = draft.label.split(' ').next().unwrap_or("Draw").to_owned();
        draft.label = format!("{verb} {name}");
    }
    Ok(())
}
fn keeper(building: &MapFeature) -> &'static str {
    let use_ = building
        .attributes
        .get("use")
        .and_then(Value::as_str)
        .and_then(Use::parse);
    if use_.is_some_and(Use::household) {
        "household"
    } else {
        "business"
    }
}

/// Readdress what the change moved, made or orphaned and renumber every street it touches.
pub(super) fn complete(scope: &Scope<'_>, mut draft: Draft) -> io::Result<Draft> {
    let real = atlas_map::authoring::editable(scope.map).map_err(other)?;
    let mut town = Town {
        scope,
        draft: &mut draft,
    };
    town.orphans()?;
    for index in 0..town.draft.after.len() {
        let feature = &town.draft.after[index];
        if holds_address(feature) && !in_locked_layer(feature, real) && town.moved(index) {
            town.refront(index)?;
        }
    }
    for id in town.touched() {
        if let Some(street) = town.current(&id)?.filter(is_street) {
            town.renumber(&street)?;
        }
    }
    Ok(draft)
}
struct Town<'a, 'd> {
    scope: &'a Scope<'a>,
    draft: &'d mut Draft,
}
impl Town<'_, '_> {
    fn ids(&self) -> BTreeSet<String> {
        self.draft
            .before
            .iter()
            .chain(&self.draft.after)
            .map(|f| f.id.clone())
            .collect()
    }
    fn removed(&self, id: &str) -> bool {
        self.draft.before.iter().any(|f| f.id == id) && !self.draft.after.iter().any(|f| f.id == id)
    }
    /// A new address holder, or one whose shape changed or whose street went.
    fn moved(&self, index: usize) -> bool {
        let feature = &self.draft.after[index];
        let shape_changed = self
            .draft
            .before
            .iter()
            .find(|old| old.id == feature.id)
            .is_none_or(|old| old.geometry != feature.geometry);
        shape_changed || street_of(feature).is_some_and(|id| self.removed(id))
    }
    /// Plots and buildings fronting a deleted street join the change to be readdressed.
    fn orphans(&mut self) -> io::Result<()> {
        let gone: Vec<MapFeature> = self
            .draft
            .before
            .iter()
            .filter(|f| is_street(f) && self.removed(&f.id))
            .cloned()
            .collect();
        for street in gone {
            let taken = self.ids();
            for holder in self.holders_near(&street.geometry)? {
                if street_of(&holder) == Some(street.id.as_str()) && !taken.contains(&holder.id) {
                    self.draft.before.push(holder.clone());
                    self.draft.after.push(holder);
                }
            }
        }
        Ok(())
    }
    /// Front a holder on the street of the plot it stands in, else the nearest street.
    fn refront(&mut self, index: usize) -> io::Result<()> {
        let feature = self.draft.after[index].clone();
        let centre = self
            .scope
            .spatial
            .interior_position(&feature.geometry)
            .map_err(other)?;
        let yard = match is_building(&feature) {
            true => self.yard_at(centre)?,
            false => None,
        };
        // A plot the command made records the street it fronts; a building takes its plot's.
        let made = !self.draft.before.iter().any(|old| old.id == feature.id);
        let planned = made.then(|| street_of(&feature)).flatten();
        let own = yard
            .as_ref()
            .and_then(street_of)
            .or(planned)
            .map(str::to_owned);
        let street = match own.map(|id| self.current(&id)).transpose()?.flatten() {
            Some(street) if is_street(&street) => Some(street),
            _ => self.nearest_street(centre)?,
        };
        self.draft.after[index] = readdress(&feature, street.as_ref().map(|s| (s, 0)));
        // A plot without an address takes the street of the building placed on it.
        if let (Some(yard), Some(street)) = (yard, &street) {
            if street_of(&yard).is_none() && !self.ids().contains(&yard.id) {
                self.draft.before.push(yard.clone());
                self.draft.after.push(readdress(&yard, Some((street, 0))));
            }
        }
        Ok(())
    }
    fn yard_at(&self, at: Position) -> io::Result<Option<MapFeature>> {
        let here = point(at);
        let mut yards: Vec<MapFeature> = self
            .draft
            .after
            .iter()
            .filter(|f| is_yard(f))
            .cloned()
            .collect();
        let taken = self.ids();
        let around = self.around(near(&here, 1.0, self.scope)?, &["plots"])?;
        yards.extend(
            around
                .into_iter()
                .filter(|f| is_yard(f) && !taken.contains(&f.id)),
        );
        for yard in yards {
            if self
                .scope
                .spatial
                .relation(&yard.geometry, &here, Predicate::Intersects)
                .map_err(other)?
            {
                return Ok(Some(yard));
            }
        }
        Ok(None)
    }
    fn nearest_street(&self, at: Position) -> io::Result<Option<MapFeature>> {
        let here = point(at);
        let taken = self.ids();
        let mut streets: Vec<MapFeature> = self
            .around(near(&here, FRONTAGE_REACH, self.scope)?, &["roads"])?
            .into_iter()
            .filter(|f| is_street(f) && !taken.contains(&f.id))
            .collect();
        streets.extend(self.draft.after.iter().filter(|f| is_street(f)).cloned());
        let mut best: Option<(MapFeature, f64)> = None;
        for street in streets {
            let gap = self
                .scope
                .spatial
                .distance(&here, &street.geometry)
                .map_err(other)?;
            if gap <= FRONTAGE_REACH && best.as_ref().is_none_or(|(_, d)| gap < *d) {
                best = Some((street, gap));
            }
        }
        Ok(best.map(|(street, _)| street))
    }
    /// Streets the change drew, moved, renamed or removed, and those its holders front.
    fn touched(&self) -> Vec<String> {
        let mut ids = BTreeSet::new();
        for feature in self.draft.before.iter().chain(&self.draft.after) {
            if is_street(feature) {
                ids.insert(feature.id.clone());
            }
            if let Some(street) = street_of(feature) {
                ids.insert(street.to_owned());
            }
        }
        ids.into_iter().collect()
    }
    /// A feature as it will stand: its changed version, else the stored one; none if removed.
    fn current(&self, id: &str) -> io::Result<Option<MapFeature>> {
        if let Some(feature) = self.draft.after.iter().find(|f| f.id == id) {
            return Ok(Some(feature.clone()));
        }
        if self.removed(id) {
            return Ok(None);
        }
        let query = FeatureQuery {
            space_id: self.scope.map.primary_space_id.clone(),
            feature_ids: Some(vec![id.into()]),
            ..Default::default()
        };
        Ok(self.scope.store.all(self.scope.map, query)?.pop())
    }
    fn renumber(&mut self, street: &MapFeature) -> io::Result<()> {
        let real = atlas_map::authoring::editable(self.scope.map).map_err(other)?;
        let taken = self.ids();
        let mut holders: Vec<MapFeature> = self
            .holders_near(&street.geometry)?
            .into_iter()
            .filter(|f| !taken.contains(&f.id))
            .collect();
        holders.extend(
            self.draft
                .after
                .iter()
                .filter(|f| holds_address(f))
                .cloned(),
        );
        holders.retain(|f| street_of(f) == Some(street.id.as_str()));
        let (groups, anchors) = self.groups(&holders)?;
        // A plot on a locked layer keeps its number and the others are numbered around it.
        let mut fixed = vec![None; anchors.len()];
        for (holder, &group) in holders.iter().zip(&groups) {
            if in_locked_layer(holder, real) {
                fixed[group] = fixed[group].or(holder
                    .attributes
                    .get("addressNumber")
                    .and_then(Value::as_u64)
                    .map(|n| n as u32));
            }
        }
        let numbers = renumber(street, &anchors, &fixed, self.scope.spatial).map_err(other)?;
        for (holder, group) in holders.iter().zip(groups) {
            let next = readdress(holder, Some((street, numbers[group])));
            if &next != holder && !in_locked_layer(holder, real) {
                self.apply(holder, next);
            }
        }
        Ok(())
    }
    /// One address per plot: a building takes the number of the plot its centre stands in,
    /// and a building on no plot is numbered alone. Returns each holder's group and each
    /// group's position.
    fn groups(&self, holders: &[MapFeature]) -> io::Result<(Vec<usize>, Vec<Position>)> {
        let spatial = self.scope.spatial;
        let mut anchors = Vec::new();
        let mut group = vec![usize::MAX; holders.len()];
        for (index, yard) in holders.iter().enumerate().filter(|(_, f)| is_yard(f)) {
            group[index] = anchors.len();
            anchors.push(spatial.interior_position(&yard.geometry).map_err(other)?);
        }
        for (index, building) in holders.iter().enumerate().filter(|(_, f)| !is_yard(f)) {
            let centre = spatial
                .interior_position(&building.geometry)
                .map_err(other)?;
            let mut plot = None;
            for (yard, member) in holders.iter().zip(&group) {
                if plot.is_none()
                    && is_yard(yard)
                    && spatial
                        .relation(&yard.geometry, &point(centre), Predicate::Intersects)
                        .map_err(other)?
                {
                    plot = Some(*member);
                }
            }
            group[index] = plot.unwrap_or_else(|| {
                anchors.push(centre);
                anchors.len() - 1
            });
        }
        Ok((group, anchors))
    }
    fn apply(&mut self, stored: &MapFeature, next: MapFeature) {
        match self.draft.after.iter_mut().find(|f| f.id == next.id) {
            Some(changed) => *changed = next,
            None => {
                self.draft.before.push(stored.clone());
                self.draft.after.push(next);
            }
        }
    }
    fn holders_near(&self, line: &Geometry) -> io::Result<Vec<MapFeature>> {
        let found = self.around(
            near(line, HOLDER_REACH, self.scope)?,
            &["plots", "structures"],
        )?;
        Ok(found.into_iter().filter(holds_address).collect())
    }
    fn around(&self, bounds: Bounds, families: &[&str]) -> io::Result<Vec<MapFeature>> {
        let layers = self
            .scope
            .map
            .layers
            .iter()
            .filter(|layer| families.contains(&family(&layer.id)))
            .map(|layer| layer.id.clone())
            .collect();
        let query = FeatureQuery {
            space_id: self.scope.map.primary_space_id.clone(),
            bounds: Some(bounds),
            layer_ids: Some(layers),
            ..Default::default()
        };
        self.scope.store.all(self.scope.map, query)
    }
}
fn near(geometry: &Geometry, by: f64, scope: &Scope<'_>) -> io::Result<Bounds> {
    let Bounds(w, s, e, n) = scope.spatial.bounds(geometry).map_err(other)?;
    Ok(Bounds(w - by, s - by, e + by, n + by))
}
