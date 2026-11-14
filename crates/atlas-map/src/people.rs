//! Described residents carried by GIS feature attributes, without numerical people state.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct LanguageShare {
    pub knowledge: f64,
    pub r#use: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PopulationGroup {
    pub people: String,
    pub culture: Option<String>,
    pub languages: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub naming_language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub language_shares: Option<BTreeMap<String, LanguageShare>>,
    pub religions: Vec<String>,
    pub practices: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub practice_shares: Option<BTreeMap<String, f64>>,
    pub count: f64,
}

impl crate::MapFeature {
    pub fn validate_people(&self) -> Result<(), crate::MapError> {
        let Some(value) = self.attributes.get("groups") else {
            return Ok(());
        };
        let invalid = |message| crate::MapError::new(crate::MapErrorCode::InvalidMap, message);
        let groups: Vec<PopulationGroup> = serde_json::from_value(value.clone())
            .map_err(|error| invalid(format!("Invalid described residents: {error}")))?;
        for group in groups {
            if !group.valid() {
                return Err(invalid(
                    "Population groups need valid residents, listed languages and practice shares"
                        .into(),
                ));
            }
        }
        Ok(())
    }
}
impl PopulationGroup {
    fn valid(&self) -> bool {
        let fraction = |value: f64| value.is_finite() && (0.0..=1.0).contains(&value);
        !self.people.is_empty()
            && self.count.is_finite()
            && self.count >= 0.0
            && self
                .naming_language
                .as_ref()
                .is_none_or(|id| self.languages.contains(id))
            && self.language_shares.as_ref().is_none_or(|shares| {
                shares.iter().all(|(id, share)| {
                    !id.is_empty()
                        && self.languages.contains(id)
                        && fraction(share.knowledge)
                        && fraction(share.r#use)
                        && share.r#use <= share.knowledge + 1e-12
                }) && self.languages.iter().all(|id| shares.contains_key(id))
                    && shares.values().map(|share| share.r#use).sum::<f64>() <= 1.0 + 1e-12
            })
            && self.practice_shares.as_ref().is_none_or(|shares| {
                shares.iter().all(|(id, share)| {
                    !id.is_empty() && self.practices.contains(id) && fraction(*share)
                }) && self.practices.iter().all(|id| shares.contains_key(id))
                    && shares
                        .iter()
                        .filter(|(id, _)| {
                            ["farming", "grazing", "gathering", "fishing"].contains(&id.as_str())
                        })
                        .map(|(_, share)| share)
                        .sum::<f64>()
                        <= 1.0 + 1e-12
            })
    }
}
