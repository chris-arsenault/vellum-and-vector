use super::{
    network::{NetworkWorkspace, Selection},
    FeatureReader, FeatureSelection, FeatureWorkspace, State,
};
use std::{collections::BTreeSet, io};

/// Earlier products of selected domains leave; captured, protected and authored records stay.
pub fn clear_products(
    features: &mut dyn FeatureWorkspace,
    networks: &mut dyn NetworkWorkspace,
    area: &str,
    domains: &[String],
    removed: &mut BTreeSet<String>,
) -> io::Result<()> {
    let products = features
        .values(FeatureSelection {
            area_id: Some(area),
            ..Default::default()
        })?
        .filter_map(|result| match result {
            Err(error) => Some(Err(error)),
            Ok(f)
                if f.state == State::Generated
                    && !f.protected
                    && f.attributes.get("developedBy").and_then(|v| v.as_str())
                        == Some("regional")
                    && f.generation_domain
                        .as_ref()
                        .is_none_or(|d| d.is_empty() || domains.contains(d)) =>
            {
                Some(Ok(f.id))
            }
            Ok(_) => None,
        })
        .collect::<io::Result<Vec<_>>>()?;
    for id in products {
        removed.insert(id.clone());
        features.remove(&id)?;
        let reaches = networks
            .reaches(Selection {
                feature_id: Some(&id),
                ..Default::default()
            })?
            .map(|r| r.map(|r| r.id))
            .collect::<io::Result<Vec<_>>>()?;
        for id in reaches {
            networks.remove_reach(&id)?;
        }
    }
    Ok(())
}

pub fn tag_products(
    features: &mut dyn FeatureWorkspace,
    source: &dyn FeatureReader,
    area: &str,
    removed: &BTreeSet<String>,
) -> io::Result<()> {
    let candidates = features
        .values(FeatureSelection {
            area_id: Some(area),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    for mut feature in candidates {
        if feature.state != State::Generated
            || feature.protected
            || feature
                .attributes
                .get("developedBy")
                .and_then(|v| v.as_str())
                == Some("regional")
        {
            continue;
        }
        if !removed.contains(&feature.id) && source.get(&feature.id)?.is_some() {
            continue;
        }
        feature
            .attributes
            .insert("developedBy".into(), "regional".into());
        features.put(feature)?;
    }
    Ok(())
}
