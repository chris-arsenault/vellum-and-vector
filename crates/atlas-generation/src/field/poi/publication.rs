use super::{
    catalogue::Catalogue,
    contract::Entry,
    kinds::{AreaKind, Kind},
    values::{HostLink, Moment, Place},
};
use crate::features::{publication::Named, Feature, FeatureWorkspace};
use std::{io, rc::Rc};

/// The generation host supplies scoped records, independent naming and the existing area rules.
pub trait PublicationState<Schedule>: super::realized::RealizationState + Sized {
    fn features_mut(&mut self) -> &mut dyn FeatureWorkspace;
    fn link_on(&self, kind: AreaKind, cell: usize) -> io::Result<Option<HostLink>>;
    fn retained_name(&self, feature: &str) -> bool;
    fn name_feature(&self, feature: &Feature) -> io::Result<Option<Named>>;
    fn contracted(&self, feature: &str) -> bool;
    fn latest_wild_observation(&self) -> &[super::wild_history::Observation];
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Published {
    pub kind: Kind,
    pub place: Place,
    pub feature_id: String,
}
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Publication {
    pub written: Vec<Published>,
}
pub fn places_of<S: PublicationState<Schedule>, Schedule>(
    state: &S,
    entry: &Entry<S, Schedule>,
) -> io::Result<Rc<Vec<Place>>> {
    state
        .held()
        .get(&format!("realized:{}", entry.id.as_str()), || {
            let Some(find) = entry.existence.places.value() else {
                return Ok(Vec::new());
            };
            let mut places = Vec::new();
            for mut place in find(state)? {
                if !super::realized::realized(state, entry, &place)? {
                    continue;
                }
                if place.hosted_by.is_none() {
                    if let Some(kind) = entry.across_maps.stands_on.value() {
                        place.hosted_by = state.link_on(*kind, place.anchor)?;
                    }
                }
                places.push(place);
            }
            Ok(places)
        })
}
pub fn put_generated<S: PublicationState<Schedule>, Schedule>(
    state: &mut S,
    feature: Feature,
) -> io::Result<bool> {
    let contracted = state.contracted(&feature.id);
    crate::features::generated::put(state.features_mut(), feature, contracted)
}
impl Publication {
    pub fn kinds<S: PublicationState<Schedule>, Schedule>(
        &mut self,
        state: &mut S,
        catalogue: &Catalogue<S, Schedule>,
        moment: Moment,
        delivered: impl Fn(&Entry<S, Schedule>) -> bool,
    ) -> io::Result<()> {
        state.held().release();
        for entry in catalogue.publication_order() {
            if entry.publication.moment.value() == Some(&moment) && delivered(entry) {
                self.kind(state, entry, |_| true)?;
            }
        }
        Ok(())
    }
    fn kind<S: PublicationState<Schedule>, Schedule>(
        &mut self,
        state: &mut S,
        entry: &Entry<S, Schedule>,
        wanted: impl Fn(&Place) -> bool,
    ) -> io::Result<()> {
        let mut records = Vec::new();
        for place in places_of(state, entry)?.iter() {
            if !wanted(place) {
                continue;
            }
            let feature = entry
                .publication
                .record
                .value()
                .map(|record| record.record(state, place))
                .transpose()?
                .flatten();
            if let Some(feature) = feature {
                records.push((place.clone(), feature));
            }
        }
        if entry.id == Kind::WildZone {
            let current = records
                .iter()
                .map(|(_, f)| super::wild_history::Observation::from(f))
                .collect::<Vec<_>>();
            let linked = super::wild_history::link(
                state.spatial(),
                state.latest_wild_observation(),
                &current,
            )?;
            for ((_, feature), observation) in records.iter_mut().zip(linked) {
                feature.id = observation.id;
                feature.name = observation.name;
            }
        }
        for (place, mut feature) in records {
            self.attributes(state, entry, &place, &mut feature)?;
            super::names::apply_term(state, entry, &place, &mut feature)?;
            let feature_id = feature.id.clone();
            if put_generated(state, feature)? {
                self.written.push(Published {
                    kind: entry.id,
                    place,
                    feature_id,
                });
            }
        }
        if matches!(entry.id, Kind::Settlement | Kind::Ruin) {
            state.held().forget("settlementRecords");
        }
        Ok(())
    }
    fn attributes<S: super::state::State, Schedule>(
        &self,
        state: &S,
        entry: &Entry<S, Schedule>,
        place: &Place,
        feature: &mut Feature,
    ) -> io::Result<()> {
        feature
            .attributes
            .insert("poi".into(), entry.id.as_str().into());
        if let Some(size) = entry.roles.true_size.value() {
            let size_value = (size.size)(state, place)?;
            feature
                .attributes
                .insert("trueSize".into(), serde_json::to_value(size_value)?);
            feature
                .attributes
                .insert("members".into(), (size.represents)(state, place)?.into());
        }
        if let Some(origin) = &place.origin {
            feature
                .attributes
                .insert("origin".into(), origin.clone().into());
        }
        if let Some(host) = &place.hosted_by {
            feature
                .attributes
                .insert("hostedBy".into(), serde_json::to_value(host)?);
        }
        if let Some(variety) = entry.roles.variety.value() {
            let value = state.varieties().get(state, variety, place)?;
            if !value.is_empty() {
                feature.attributes.insert("variety".into(), value.into());
            }
        }
        Ok(())
    }
    pub fn late<S: PublicationState<Schedule>, Schedule>(
        &mut self,
        state: &mut S,
        catalogue: &Catalogue<S, Schedule>,
        moment: Moment,
    ) -> io::Result<()> {
        state.held().release();
        for entry in catalogue.publication_order() {
            let late = entry
                .existence
                .origins
                .value()
                .into_iter()
                .flatten()
                .filter(|origin| {
                    origin.reads.iter().any(|kind| {
                        catalogue.get(*kind).publication.moment.value() == Some(&moment)
                    })
                })
                .map(|origin| origin.id.as_str())
                .collect::<Vec<_>>();
            if !late.is_empty() && self.written.iter().any(|p| p.kind == entry.id) {
                self.kind(state, entry, |place| {
                    place.origin.as_deref().is_some_and(|id| late.contains(&id))
                })?;
            }
        }
        Ok(())
    }
}
