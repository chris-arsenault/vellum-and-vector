use super::{
    catalogue::Catalogue,
    contract::{Entry, NameRelation},
    publication::{PublicationState, Published},
    values::Place,
};
use crate::{
    chance::Chance,
    features::{Feature, State as FeatureState},
};
// hpc-exempt: feature identities that have lent a name in this publication pass.
use std::{collections::BTreeSet, io};

pub fn stem_of<'a>(name: &'a str, term: Option<&str>) -> Option<&'a str> {
    let term = term.filter(|term| !term.is_empty())?;
    let stem = name.strip_suffix(&format!(" {term}"))?.trim();
    (!stem.is_empty()).then_some(stem)
}
pub fn apply_term<S: PublicationState<Schedule>, Schedule>(
    state: &S,
    entry: &Entry<S, Schedule>,
    place: &Place,
    feature: &mut Feature,
) -> io::Result<()> {
    let Some(term) = entry.roles.naming.term.value() else {
        return Ok(());
    };
    feature.attributes.insert(
        "nameTerm".into(),
        serde_json::to_value(term(state, place)?)?,
    );
    if state.retained_name(feature.id) {
        return Ok(());
    }
    if let Some(named) = state.name_feature(feature)? {
        feature.name = named.name;
        feature.attributes.extend(named.metadata);
    }
    Ok(())
}
fn can_rename<S: PublicationState<Schedule>, Schedule>(state: &S, feature: &Feature) -> bool {
    feature.state == FeatureState::Generated
        && !feature.protected
        && !state.retained_name(feature.id)
        && (!state.regional()
            || feature
                .attributes
                .get("developedBy")
                .and_then(|v| v.as_str())
                == Some("regional"))
}
fn lender_for<S: PublicationState<Schedule>, Schedule>(
    state: &S,
    relation: &NameRelation<S>,
    taker: &Published,
    all: &[Published],
    // hpc-exempt: named feature identities, never per-cell simulation state.
    lent: &BTreeSet<atlas_map::Id>,
) -> io::Result<Option<(Feature, String)>> {
    for lender in all {
        if lender.kind != relation.relation.kind
            || lent.contains(&lender.feature_id)
            || !(relation.relation.holds)(state, &taker.place, &lender.place)?
        {
            continue;
        }
        let Some(feature) = state.features().get(lender.feature_id)? else {
            continue;
        };
        let term = feature
            .attributes
            .get("nameTerm")
            .and_then(|v| v.get("term"))
            .and_then(|v| v.as_str());
        if let Some(stem) = stem_of(&feature.name, term) {
            let stem = stem.to_owned();
            return Ok(Some((feature, stem)));
        }
    }
    Ok(None)
}
fn take_one<S: PublicationState<Schedule>, Schedule>(
    state: &mut S,
    catalogue: &Catalogue<S, Schedule>,
    taker: &Published,
    all: &[Published],
    // hpc-exempt: named feature identities, never per-cell simulation state.
    lent: &mut BTreeSet<atlas_map::Id>,
) -> io::Result<()> {
    let Some(mut feature) = state.features().get(taker.feature_id)? else {
        return Ok(());
    };
    if !can_rename(state, &feature) {
        return Ok(());
    }
    for relation in catalogue
        .get(taker.kind)
        .roles
        .naming
        .takes_name_from
        .value()
        .into_iter()
        .flatten()
    {
        let Some(chance) = relation.chance else {
            continue;
        };
        if !Chance::of(0, 0x7031).happens([taker.place.anchor as f64, 0.0], chance) {
            continue;
        }
        let Some((lender, stem)) = lender_for(state, relation, taker, all, lent)? else {
            continue;
        };
        lent.insert(lender.id);
        feature.name = stem;
        feature
            .attributes
            .insert("namedAfter".into(), lender.id.into());
        feature.causes.push(format!("Named after {}.", lender.name));
        state.features_mut().put(feature)?;
        return Ok(());
    }
    Ok(())
}
pub fn take_names<S: PublicationState<Schedule>, Schedule>(
    state: &mut S,
    catalogue: &Catalogue<S, Schedule>,
    all: &[Published],
) -> io::Result<()> {
    // hpc-exempt: sparse set of features that lent their name.
    let mut lent = BTreeSet::new();
    for taker in all {
        take_one(state, catalogue, taker, all, &mut lent)?;
    }
    Ok(())
}
