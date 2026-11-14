//! A generator reads the captured procedural baseline; map drawings retain separate authority.
use super::{
    network::{NetworkReader, NetworkWorkspace, Node, Reach, Selection},
    Feature, FeatureReader, FeatureSelection, FeatureWorkspace,
};
use crate::atlas::world::Sources;
use std::{io, rc::Rc};

pub fn feature(mut source: Feature) -> Option<Feature> {
    if source.map_only == Some(true) {
        return None;
    }
    if let Some(baseline) = source
        .detail
        .get(&source.area_id)
        .and_then(|detail| detail.map_baseline.as_ref())
    {
        source.relations.clone_from(&baseline.relations);
    }
    source.detail = source
        .detail
        .into_iter()
        .filter_map(|(area, detail)| {
            if detail.map_only == Some(true) {
                detail.map_source.map(|source| (area, *source))
            } else {
                Some((area, detail))
            }
        })
        .collect();
    Some(source)
}
pub struct Features(pub Rc<dyn FeatureReader>);
impl FeatureReader for Features {
    fn get(&self, id: &str) -> io::Result<Option<Feature>> {
        Ok(self.0.get(id)?.and_then(feature))
    }
    fn values<'a>(
        &'a self,
        selection: FeatureSelection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Feature>> + 'a>> {
        Ok(Box::new(
            self.0
                .values(selection)?
                .filter_map(|record| record.map(feature).transpose()),
        ))
    }
}
pub struct Networks {
    pub records: Rc<dyn NetworkReader>,
    pub features: Rc<dyn FeatureReader>,
}
impl Networks {
    fn visible(&self, reach: Reach) -> io::Result<Option<Reach>> {
        Ok((self
            .features
            .get(&reach.feature_id)?
            .is_none_or(|feature| feature.map_only != Some(true)))
        .then_some(reach))
    }
}
impl NetworkReader for Networks {
    fn node(&self, id: &str) -> io::Result<Option<Node>> {
        self.records.node(id)
    }
    fn nodes(&self) -> io::Result<Box<dyn Iterator<Item = io::Result<Node>> + '_>> {
        self.records.nodes()
    }
    fn reach(&self, id: &str) -> io::Result<Option<Reach>> {
        self.records
            .reach(id)?
            .map(|reach| self.visible(reach))
            .transpose()
            .map(Option::flatten)
    }
    fn reaches<'a>(
        &'a self,
        selection: Selection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Reach>> + 'a>> {
        Ok(Box::new(self.records.reaches(selection)?.filter_map(
            |reach| reach.and_then(|reach| self.visible(reach)).transpose(),
        )))
    }
}
pub fn initialize(
    source: Sources,
    features: &mut dyn FeatureWorkspace,
    networks: &mut dyn NetworkWorkspace,
) -> io::Result<Sources> {
    let original = Sources {
        features: Rc::new(Features(source.features.clone())),
        networks: Rc::new(Networks {
            records: source.networks,
            features: source.features,
        }),
        contracted: source.contracted,
    };
    for feature in original.features.values(FeatureSelection::default())? {
        features.put(feature?)?;
    }
    for node in original.networks.nodes()? {
        networks.put_node(node?)?;
    }
    for reach in original.networks.reaches(Selection::default())? {
        networks.put_reach(reach?)?;
    }
    Ok(original)
}
