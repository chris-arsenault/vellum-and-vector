use super::{cargo::Cargo, channels::Quantity, values::Values, ProjectedChannel, Surface};
use crate::checkpoint::Archive;
use std::io;

impl Surface {
    pub(crate) fn checkpoint(&mut self, archive: &mut Archive<'_>) -> io::Result<()> {
        archive.label("surface")?;
        archive.band("active", &mut self.active)?;
        let mut count = self.channels.len();
        archive.value("channels", &mut count)?;
        if archive.loading() {
            self.channels.clear();
            for _ in 0..count {
                let mut name = String::new();
                archive.value("channel", &mut name)?;
                let mut channel = ProjectedChannel {
                    unit: String::new(),
                    quantity: Quantity::Intensive,
                    values: Values::F64(self.coverage.scratch(0, 0.0)),
                };
                archive.value("unit", &mut channel.unit)?;
                archive.value("quantity", &mut channel.quantity)?;
                channel.values.checkpoint(archive, &mut self.coverage)?;
                self.channels.insert(name, channel);
            }
        } else {
            for (name, channel) in &mut self.channels {
                archive.value("channel", &mut name.clone())?;
                archive.value("unit", &mut channel.unit)?;
                archive.value("quantity", &mut channel.quantity)?;
                channel.values.checkpoint(archive, &mut self.coverage)?;
            }
        }
        let mut cargo = self.cargo.is_some();
        archive.value("cargo", &mut cargo)?;
        if archive.loading() {
            self.cargo = cargo.then(|| Cargo::empty(&mut self.coverage));
        }
        if let Some(cargo) = &mut self.cargo {
            cargo.checkpoint(archive, &mut self.coverage)?;
        }
        let mut support = self.support.is_some();
        archive.value("surface-contributions", &mut support)?;
        if archive.loading() {
            self.support = support.then(|| super::support::Support::empty(&mut self.coverage));
        }
        if let Some(support) = &mut self.support {
            support.checkpoint(archive, &mut self.coverage)?;
        }
        Ok(())
    }
}
