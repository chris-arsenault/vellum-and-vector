//! Establish significant river identities during explicit evolution, before presentation reads.
use super::{captured::DrainageReach, reaches::ReachStore, significance::course_judgments};
use crate::{lattice::TriangularLattice, scale::MapScale, storage::ReadBand};
use atlas_map::Position;
use std::io;
pub struct VisibilityInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub targets: &'a ReadBand<i32>,
    pub water_kind: &'a ReadBand<u8>,
    pub body: &'a ReadBand<i32>,
    pub flood: &'a ReadBand<f64>,
    pub catchment: &'a ReadBand<f64>,
}
pub fn unwrap(coordinates: &mut [Position], width: Option<f64>) {
    let Some(width) = width else {
        return;
    };
    for at in 1..coordinates.len() {
        let [x, y, z] = coordinates[at].coordinates();
        let previous = coordinates[at - 1].coordinates()[0];
        let x = x - ((x - previous) / width + 0.5).floor() * width;
        coordinates[at] = if matches!(coordinates[at], Position::XYZ(_)) {
            Position::XYZ([x, y, z])
        } else {
            Position::xy(x, y)
        };
    }
}
impl ReachStore {
    pub fn establish_identities(&mut self, input: VisibilityInputs<'_>) -> io::Result<()> {
        let ids: Vec<_> = self
            .reaches()
            .filter(|reach| !reach.dry && reach.river.is_none())
            .map(|reach| reach.id)
            .collect();
        let mut indices = vec![None; self.next()];
        for (at, &id) in ids.iter().enumerate() {
            indices[id] = Some(at);
        }
        let records = self.course_records(&ids, &indices, &input)?;
        for judgment in course_judgments(&records, input.scale).map_err(io::Error::other)? {
            if !judgment.publish {
                continue;
            }
            let Some(&last) = judgment.course.last() else {
                continue;
            };
            let river = self.identity_of(ids[last], &input)?;
            for at in judgment.course {
                let reach = self.get_mut(ids[at]).unwrap();
                reach.river = Some(river.clone());
                reach
                    .record
                    .get_or_insert_with(|| format!("river:{river}:0"));
                reach.drawn = true;
            }
        }
        Ok(())
    }
    fn course_records(
        &self,
        ids: &[usize],
        indices: &[Option<usize>],
        input: &VisibilityInputs<'_>,
    ) -> io::Result<Vec<DrainageReach>> {
        let reader = self.reader();
        ids.iter()
            .map(|&id| {
                let reach = self.get(id).unwrap();
                let end = reach
                    .cells
                    .last()
                    .map(|&cell| input.targets.get(cell))
                    .transpose()?
                    .and_then(|target| usize::try_from(target).ok());
                let members: Vec<_> = reach.cells.iter().copied().chain(end).collect();
                let mut coordinates: Vec<_> = members
                    .iter()
                    .map(|&cell| {
                        let [x, y] = input.mesh.position(cell);
                        Position::xy(x, y)
                    })
                    .collect();
                unwrap(&mut coordinates, input.mesh.periodic_width());
                let water_body = match end {
                    Some(cell) if input.water_kind.get(cell)? != 0 => {
                        usize::try_from(input.body.get(cell)?).ok()
                    }
                    _ => None,
                };
                Ok(DrainageReach {
                    downstream: reach
                        .downstream
                        .and_then(|next| indices.get(next).copied().flatten()),
                    water_body,
                    order: reach.order,
                    basin: 0,
                    feature_ids: Vec::new(),
                    coordinates,
                    discharges: members
                        .iter()
                        .map(|&cell| Ok(reader.water_at(cell, true, input.flood.get(cell)?)))
                        .collect::<io::Result<_>>()?,
                    catchment_areas: members
                        .iter()
                        .map(|&cell| input.catchment.get(cell))
                        .collect::<io::Result<_>>()?,
                })
            })
            .collect()
    }
    fn identity_of(&self, id: usize, input: &VisibilityInputs<'_>) -> io::Result<String> {
        let reach = self.get(id).unwrap();
        let end = reach
            .cells
            .last()
            .map(|&cell| input.targets.get(cell))
            .transpose()?
            .and_then(|target| usize::try_from(target).ok());
        let [ox, oy] = input.mesh.origin();
        let mut line: Vec<_> = reach
            .cells
            .iter()
            .copied()
            .chain(end)
            .map(|cell| {
                let [x, y] = input.mesh.position(cell);
                Position::xy((x + ox + 0.5).floor(), (y + oy + 0.5).floor())
            })
            .collect();
        unwrap(&mut line, input.mesh.periodic_width());
        let key = |position: Position| {
            let [x, y, _] = position.coordinates();
            format!(
                "{:.6}:{:.6}",
                if x == 0.0 { 0.0 } else { x },
                if y == 0.0 { 0.0 } else { y }
            )
        };
        let end = line
            .last()
            .ok_or_else(|| io::Error::other("An established river needs a course"))?;
        let from = line[line.len().saturating_sub(2)];
        Ok(format!("river:{}:{}", key(*end), key(from)))
    }
}
