use super::State;
use crate::{
    atlas::magic::Inputs,
    features::FeatureSelection,
    field::magic::current::Current,
    magic::{
        configuration::Phase,
        hallowed::{Seat, Way},
    },
};
use atlas_map::Geometry;
use std::io;

impl State {
    fn magic_seats(&self) -> io::Result<Vec<Seat>> {
        if self.regional.is_none() {
            return Ok(self
                .people
                .places
                .borrow()
                .known
                .iter()
                .filter(|p| p.abandoned.is_none() && p.absorbed_by.is_none())
                .map(|p| Seat {
                    id: p.id.clone(),
                    cell: p.anchor,
                })
                .collect());
        }
        let mut seats = Vec::new();
        let mesh = self.field().mesh();
        let [ox, oy] = mesh.origin();
        for feature in self.records.features.values(FeatureSelection {
            area_id: Some(self.scope.area),
            kind: Some("settlement"),
            ..Default::default()
        })? {
            let feature = feature?;
            if feature
                .attributes
                .get("status")
                .and_then(serde_json::Value::as_str)
                != Some("inhabited")
            {
                continue;
            }
            if let Geometry::Point { coordinates } = feature.geometry {
                let [x, y, _] = coordinates.coordinates();
                let cell = mesh.cell_at(x - ox, y - oy).ok_or_else(|| {
                    io::Error::other("Captured living seat is outside its map lattice")
                })?;
                seats.push(Seat {
                    id: feature.id.to_string(),
                    cell,
                });
            }
        }
        Ok(seats)
    }
    pub fn refresh_magic(
        &self,
        input: &Inputs,
        bound_epoch: i32,
        phase: Option<Phase>,
    ) -> io::Result<()> {
        let Some(magic) = &self.physical.magic else {
            return Ok(());
        };
        let epoch = input.epoch(bound_epoch)?;
        let activity = input.activity(epoch);
        self.clear_queries();
        let costs = self.carrier_costs()?;
        let seats = self.magic_seats()?;
        let ways = self
            .people
            .ways
            .borrow()
            .iter()
            .map(|w| Way {
                from: w.from.clone(),
                to: w.to.clone(),
            })
            .collect::<Vec<_>>();
        let mut magic = magic.borrow_mut();
        magic.carrier_costs = costs;
        self.field().refresh_magic(
            &mut magic,
            &Current {
                seed: input.seed,
                epoch,
                phase,
                activity: &activity,
                placed: &input.placed,
                space: self.scope.space,
                seats: &seats,
                ways: &ways,
                spatial: self.spatial.as_ref(),
            },
        )?;
        self.clear_queries();
        Ok(())
    }
}
