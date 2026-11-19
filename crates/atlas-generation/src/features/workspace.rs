use super::Feature;
use atlas_map::Id;
use std::{collections::BTreeSet, io};

#[derive(Default, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSelection<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'a str>,
}
impl FeatureSelection<'_> {
    pub fn matches(&self, feature: &Feature) -> bool {
        self.area_id.is_none_or(|id| feature.area_id == id)
            && self.layer_id.is_none_or(|id| feature.layer_id == id)
            && self.kind.is_none_or(|kind| feature.kind == kind)
    }
}

/// Reads are detached values; only workspace writes change authoritative records.
pub trait FeatureReader {
    fn get(&self, id: Id) -> io::Result<Option<Feature>>;
    fn values<'a>(
        &'a self,
        selection: FeatureSelection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Feature>> + 'a>>;
}
pub type Revisions<'a> = Box<dyn Iterator<Item = io::Result<(Id, u64)>> + 'a>;
pub trait FeatureWorkspace: FeatureReader {
    fn put(&mut self, feature: Feature) -> io::Result<()>;
    fn remove(&mut self, id: Id) -> io::Result<()>;
    fn revisions(&self) -> io::Result<Revisions<'_>>;
}

/// Only following relationships contribute to composed feature presentation.
pub fn following_records(
    workspace: &dyn FeatureReader,
    ids: impl IntoIterator<Item = Id>,
) -> io::Result<Vec<Feature>> {
    let mut pending = ids.into_iter().collect::<Vec<_>>();
    let mut visited = BTreeSet::new();
    let mut features = Vec::new();
    let mut index = 0;
    while index < pending.len() {
        let id = pending[index];
        index += 1;
        if !visited.insert(id) {
            continue;
        }
        let Some(feature) = workspace.get(id)? else {
            continue;
        };
        pending.extend(
            feature
                .relations
                .iter()
                .filter(|r| r.kind == "follows")
                .map(|r| r.target_id),
        );
        features.push(feature);
    }
    Ok(features)
}
