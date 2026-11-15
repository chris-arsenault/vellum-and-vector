use super::{
    channels::Channel, confluences, inventory::Inventory, state::MagicField, workspace::Workspace,
};
use crate::{checkpoint::Archive, storage::Coverage};
use std::io;

impl MagicField {
    fn checkpoint(&mut self, archive: &mut Archive<'_>, coverage: &mut Coverage) -> io::Result<()> {
        archive.label(&self.definition.id)?;
        for channel in Channel::ALL {
            archive.band(channel.definition().name, self.channels.band_mut(*channel))?;
        }
        for (index, origin) in self.origins.iter_mut().enumerate() {
            archive.label(&format!("origin-{index}"))?;
            archive.band("source", &mut origin.source)?;
            archive.value("inherited-sites", &mut origin.inherited_sites)?;
            for (index, stock) in origin.stocks.iter_mut().enumerate() {
                archive.label(&format!("stock-{index}"))?;
                match stock {
                    Inventory::Mobile(band) => archive.band("mobile", band)?,
                    Inventory::Ground(_) => archive.label("ground-owned")?,
                }
            }
        }
        archive.value("located", &mut self.located)?;
        archive.value("seeded", &mut self.seeded)?;
        archive.value("supplied-epoch", &mut self.supplied_epoch)?;
        archive.value("lost", &mut self.lost)?;
        archive.band("drawn", &mut self.drawn)?;
        archive.band("fresh", &mut self.fresh)?;
        archive.value("doors", &mut self.doors)?;
        for (index, feature) in self.features.iter_mut().enumerate() {
            archive.label(&format!("feature-{index}"))?;
            archive.band("members", &mut feature.members)?;
            archive.band("coverage", &mut feature.coverage)?;
        }
        archive.band("system-coverage", &mut self.system_coverage)?;
        archive.optional_band("parents", &mut self.parents, coverage)?;
        archive.value("wake-paths", &mut self.wake_paths)
    }
}

impl Workspace {
    pub(crate) fn checkpoint(
        &mut self,
        archive: &mut Archive<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        archive.label("magic")?;
        for field in &mut self.fields {
            field.checkpoint(archive, coverage)?;
        }
        archive.label("meetings")?;
        let mut count = self.meetings.states.len();
        archive.value("count", &mut count)?;
        if archive.loading() {
            self.meetings.states = (0..count)
                .map(|_| confluences::State {
                    definition: 0,
                    members: coverage.allocate(0.0),
                    coverage: coverage.allocate(0.0),
                })
                .collect();
        }
        for state in &mut self.meetings.states {
            archive.value("definition", &mut state.definition)?;
            archive.band("members", &mut state.members)?;
            archive.band("coverage", &mut state.coverage)?;
        }
        archive.band("strain", &mut self.meetings.strain)?;
        archive.band("heat", &mut self.forcing.heat)?;
        archive.band("melt", &mut self.forcing.melt)?;
        archive.band("upwelling", &mut self.forcing.upwelling)?;
        archive.band("sea-surface", &mut self.forcing.sea_surface)?;
        archive.band("fog", &mut self.forcing.fog)?;
        archive.band("coastal", &mut self.forcing.coastal)?;
        archive.band("natural", &mut self.surfaces.natural)?;
        archive.band("final-surface", &mut self.surfaces.final_surface)?;
        archive.band("second", &mut self.surfaces.second)?;
        self.rims.checkpoint(archive)?;
        archive.optional_read("cost-river", &mut self.carrier_costs.river, coverage)?;
        archive.optional_read("cost-wind", &mut self.carrier_costs.wind, coverage)?;
        archive.optional_read("cost-ice", &mut self.carrier_costs.ice, coverage)
    }
}
