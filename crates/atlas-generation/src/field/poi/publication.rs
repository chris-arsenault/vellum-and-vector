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
    fn retained_name(&self, feature: atlas_map::Id) -> bool;
    fn name_feature(&self, feature: &Feature) -> io::Result<Option<Named>>;
    fn contracted(&self, feature: atlas_map::Id) -> bool;
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Published {
    pub kind: Kind,
    pub place: Place,
    pub feature_id: atlas_map::Id,
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
    let contracted = state.contracted(feature.id);
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
        let Some(writer) = entry.publication.record.value() else {
            return Ok(());
        };
        for place in places_of(state, entry)?.iter() {
            if !wanted(place) {
                continue;
            }
            let feature = writer.record(state, place)?;
            if let Some(feature) = feature {
                records.push((place.clone(), feature));
            }
        }
        writer.prepare_batch(state, &mut records)?;
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
        writer.published(state);
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
        let mut size_text = None;
        if let Some(size) = entry.roles.true_size.value() {
            let size_value = (size.size)(state, place)?;
            size_text = super::true_sizes::size_text(&size_value);
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
        if let Some(account) = entry.roles.account.value() {
            let text = Self::key_text(state, entry, place, feature, size_text, account)?;
            feature.attributes.insert("account".into(), text.into());
        }
        Ok(())
    }
    /// The map-key entry: what the place is, its true size, and why it is here — its origin's
    /// statement when it was claimed by one, otherwise its own account.
    fn key_text<S: super::state::State, Schedule>(
        state: &S,
        entry: &Entry<S, Schedule>,
        place: &Place,
        feature: &Feature,
        size: Option<String>,
        account: &super::contract::OnPlace<S, String>,
    ) -> io::Result<String> {
        let origin = place.origin.as_deref().and_then(|id| {
            entry
                .existence
                .origins
                .value()?
                .iter()
                .find(|origin| origin.id == id)
        });
        let why = match origin {
            Some(origin) => origin.statement.clone(),
            None => account(state, place)?,
        };
        let what = match feature.attributes.get("variety").and_then(|v| v.as_str()) {
            Some(variety) => format!("{} ({variety})", entry.name),
            None => entry.name.clone(),
        };
        Ok(match size {
            Some(size) => format!("{what}, {size}. {why}"),
            None => format!("{what}. {why}"),
        })
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
