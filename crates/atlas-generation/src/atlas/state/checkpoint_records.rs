use super::Records;
use crate::{
    checkpoint::Archive,
    features::{
        network::{Node, Reach},
        Feature,
    },
};
use std::io;

impl Records {
    pub(super) fn checkpoint(&mut self, archive: &mut Archive<'_>) -> io::Result<()> {
        archive.label("records")?;
        archive.value("retained-names", &mut self.retained_names)?;
        if archive.loading() {
            let ids = self
                .features
                .values(Default::default())?
                .map(|item| item.map(|item| item.id))
                .collect::<io::Result<Vec<_>>>()?;
            for id in ids {
                self.features.remove(&id)?;
            }
            loop {
                let mut item: Option<Feature> = None;
                archive.value("feature", &mut item)?;
                let Some(item) = item else {
                    break;
                };
                self.features.put(item)?;
            }
            loop {
                let mut item: Option<Node> = None;
                archive.value("node", &mut item)?;
                let Some(item) = item else {
                    break;
                };
                self.networks.put_node(item)?;
            }
            let ids = self
                .networks
                .reaches(Default::default())?
                .map(|item| item.map(|item| item.id))
                .collect::<io::Result<Vec<_>>>()?;
            for id in ids {
                self.networks.remove_reach(&id)?;
            }
            loop {
                let mut item: Option<Reach> = None;
                archive.value("reach", &mut item)?;
                let Some(item) = item else {
                    break;
                };
                self.networks.put_reach(item)?;
            }
        } else {
            for item in self.features.values(Default::default())? {
                archive.value("feature", &mut Some(item?))?;
            }
            archive.value("feature", &mut Option::<Feature>::None)?;
            for item in self.networks.nodes()? {
                archive.value("node", &mut Some(item?))?;
            }
            archive.value("node", &mut Option::<Node>::None)?;
            for item in self.networks.reaches(Default::default())? {
                archive.value("reach", &mut Some(item?))?;
            }
            archive.value("reach", &mut Option::<Reach>::None)?;
        }
        Ok(())
    }
}
