use super::Ground;
use crate::checkpoint::Archive;
use std::io;

impl Ground {
    pub(crate) fn checkpoint(&mut self, archive: &mut Archive<'_>) -> io::Result<()> {
        archive.label("ground")?;
        for field in super::GroundField::ALL {
            archive.band(field.name(), &mut self.storage.bands[field as usize])?;
        }
        self.columns.checkpoint(archive)?;
        archive.value("cargo-identities", &mut self.identities)?;
        archive.value("sea-level", &mut self.sea_level)?;
        archive.value("epoch", &mut self.epoch)?;
        archive.value("crust-initialized", &mut self.crust_initialized)?;
        archive.value("support-initialized", &mut self.support_initialized)?;
        archive.value("crust-budget", &mut self.crust_budget)?;
        archive.value("transfers", &mut self.transfers)?;
        archive.value("produced", &mut self.produced)?;
        archive.value("deposited", &mut self.deposited)?;
        archive.value("exported", &mut self.exported)?;
        // History bands are bound from the field during initialization; retain their aliases.
        for (name, band) in &mut self.history {
            archive.band(name, band)?;
        }
        if archive.loading() {
            self.inventory_cache = Default::default();
        }
        Ok(())
    }
}
