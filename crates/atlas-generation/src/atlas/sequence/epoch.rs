use super::{operations, Composition, Sequence};
use std::io;

impl Composition<'_, '_> {
    // Arconis: docs/architecture/subsystems.arconis#item=lane_epoch — composes the epoch body that repeats for every epoch.
    pub(super) fn epoch(&self, inherited: bool) -> io::Result<Sequence> {
        let mut body = operations(&["atlas.begin-epoch"]);
        if !inherited {
            body.extend(self.geology(false)?);
            body.extend(self.peopled("human.land-watch"));
        }
        body.extend(self.climate("epoch.initial-climate", true)?);
        body.extend(self.contribute("epoch.climate-forcing")?);
        body.extend(self.contribute("epoch.material-forcing")?);
        body.extend(self.drainage("epoch.initial-water")?);
        body.extend(self.contribute("epoch.ecology-evolve")?);
        body.extend(self.drainage("epoch.after-ecology-water")?);
        body.extend(self.group("epoch.incision", "epoch", false, false)?);
        body.extend(self.group("epoch.after-incision.hillslopes", "epoch", false, false)?);
        body.extend(self.climate("epoch.after-incision-climate", false)?);
        body.extend(self.drainage("epoch.after-incision-water")?);
        body.extend(self.group("epoch.sediment", "epoch", false, false)?);
        body.extend(self.group("ice.model", "epoch.glaciation", false, false)?);
        for slot in ["epoch.ice-load", "climate.ocean", "ice.flow"] {
            body.extend(self.group(slot, "epoch.after-ice-balance", false, false)?);
        }
        body.extend(self.group("epoch.sculpting", "epoch", false, false)?);
        body.extend(self.group("epoch.ice-load", "epoch", false, false)?);
        body.extend(self.climate("epoch.after-glaciation-climate", false)?);
        body.extend(self.drainage("epoch.after-glaciation-water")?);
        body.extend(self.group("ice.flow", "epoch.post-glacial", false, false)?);
        body.extend(self.group("ice.meltwater", "epoch.post-glacial", false, false)?);
        body.extend(self.drainage("epoch.meltwater")?);
        body.extend(self.group("water.groundwater", "epoch", false, false)?);
        body.extend(self.contribute("epoch.post-glacial-forcing")?);
        body.extend(self.contribute("epoch.ecology-respond")?);
        body.extend(self.drainage("epoch.after-response-water")?);
        body.extend(self.contribute("epoch.coastal-forcing")?);
        body.extend(self.group("epoch.coasts", "epoch", false, false)?);
        body.extend(self.contribute("epoch.ecology-burial")?);
        body.extend(self.contribute("epoch.influence-history")?);
        body.extend(self.contribute("epoch.storage")?);
        body.extend(operations(&["poi.effects"]));
        if !inherited {
            body.extend(self.contribute("epoch.landmark-maintenance")?);
            body.extend(self.peopled("human.land-epoch"));
        }
        body.extend(self.group("water.routing", "epoch.final-courses", false, false)?);
        body.extend(self.group("epoch.history", "epoch", false, false)?);
        Ok(body)
    }
}
