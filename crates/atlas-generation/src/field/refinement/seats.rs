use super::{
    super::{shared::Scalar, Field},
    courses::cell_at,
    topology::distance,
};
use crate::water::{network::RiverReader, WaterView};
use std::io;
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Situation {
    Coast,
    Lake,
    River,
    Inland,
}
impl Situation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coast => "coast",
            Self::Lake => "lake",
            Self::River => "river",
            Self::Inland => "inland",
        }
    }
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Seat {
    pub feature_id: String,
    pub cell: usize,
    pub situation: Situation,
    pub radius: f64,
    pub gradient: f64,
}
pub enum Support {
    Footprint,
    Moved,
    Unsupported,
}
impl Support {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Footprint => "footprint",
            Self::Moved => "moved",
            Self::Unsupported => "unsupported",
        }
    }
}
pub struct Siting {
    pub cell: usize,
    pub situation: Situation,
    pub support: Support,
}
pub fn radius(parent_span: f64, span: f64) -> f64 {
    (parent_span * 0.12 / span + 0.5).floor().clamp(1.0, 3.0)
}
impl Field {
    pub fn known_seat(
        &self,
        feature_id: String,
        position: [f64; 2],
        river_side: bool,
        parent_span: f64,
    ) -> io::Result<Option<Seat>> {
        let Some(cell) = cell_at(&self.mesh, position) else {
            return Ok(None);
        };
        Ok(Some(Seat {
            feature_id,
            cell,
            situation: if river_side {
                Situation::River
            } else {
                self.seat_situation(cell)?
            },
            radius: radius(parent_span, self.scale.cells(1.0)),
            gradient: 0.03,
        }))
    }
    pub fn seat_situation(&self, cell: usize) -> io::Result<Situation> {
        let water = self.water.borrow();
        let reader = water.river_reader();
        let view = water.read_only();
        self.seat_situation_with(cell, &reader, &view)
    }
    fn seat_situation_with(
        &self,
        cell: usize,
        reader: &RiverReader<'_>,
        view: &WaterView,
    ) -> io::Result<Situation> {
        let cells = std::iter::once(cell)
            .chain((0..3).filter_map(|edge| self.mesh.neighbor(cell, edge)))
            .collect::<Vec<_>>();
        let mut lake = false;
        let mut river = false;
        for cell in cells {
            let kind = view.column.kind.get(cell)?;
            if kind == 1 {
                return Ok(Situation::Coast);
            }
            lake |= kind == 2;
            river |= reader.order_at(cell, kind) > 0;
        }
        Ok(if lake {
            Situation::Lake
        } else if river {
            Situation::River
        } else {
            Situation::Inland
        })
    }
    pub fn usable_seat(&self, cell: usize) -> io::Result<bool> {
        Ok(self.water().column.kind.get(cell)? == 0
            && self.shared.scalar(Scalar::Slope).get(cell)? <= 0.12
            && self.shared.scalar(Scalar::Temperature).get(cell)? / 10.0 - 30.0 >= -5.0)
    }
    pub fn retain_seat_stream(
        &mut self,
        seat: &Seat,
        river: Option<&str>,
        identity: &str,
        receiver: &[i32],
    ) -> io::Result<()> {
        if seat.situation != Situation::River {
            return Ok(());
        }
        let course = {
            let water = self.water.borrow();
            self.seat_course(seat.cell, river, receiver, &water.river_reader())?
        };
        let ground = self.ground();
        // owner-direction(2026-11-12): the stream a parent's river-side town stands on continues on a finer map whatever its water there.
        self.water
            .borrow_mut()
            .retain_course(&course, identity, None, |cell| {
                super::super::water::drainage::bed(&ground, cell)
            })?;
        Ok(())
    }
    fn seat_course(
        &self,
        cell: usize,
        river: Option<&str>,
        receiver: &[i32],
        reader: &RiverReader<'_>,
    ) -> io::Result<Vec<usize>> {
        let adjacent = std::iter::once(cell)
            .chain((0..3).filter_map(|edge| self.mesh.neighbor(cell, edge)))
            .find(|&candidate| {
                reader
                    .at(candidate)
                    .is_some_and(|reach| river.is_none_or(|id| reach.river() == Some(id)))
            });
        if let Some(adjacent) = adjacent {
            return Ok(vec![adjacent]);
        }
        let kind = self.water().column.kind;
        let mut course = Vec::new();
        let mut at = cell as i32;
        while at >= 0 && kind.get(at as usize)? == 0 {
            let cell = at as usize;
            course.push(cell);
            if reader.at(cell).is_some() {
                break;
            }
            at = receiver[cell];
        }
        Ok(course)
    }
    pub fn settle_seat(
        &mut self,
        seat: &mut Seat,
        parent_span: f64,
        channel: &[u8],
        basin: &[u8],
    ) -> io::Result<Siting> {
        let held = self.usable_seat(seat.cell)?;
        let target = if held {
            seat.cell
        } else {
            self.best_seat(seat, parent_span)?
        };
        if target != seat.cell {
            seat.cell = target;
            self.grade_seat(target, seat.radius, seat.gradient, channel, basin)?;
        }
        Ok(Siting {
            cell: target,
            situation: self.seat_situation(target)?,
            support: if held {
                Support::Footprint
            } else if self.usable_seat(target)? {
                Support::Moved
            } else {
                Support::Unsupported
            },
        })
    }
    fn best_seat(&self, seat: &Seat, parent_span: f64) -> io::Result<usize> {
        let reach = parent_span * 0.6;
        let mut best = seat.cell;
        let mut best_score = f64::NEG_INFINITY;
        let slopes = self.shared.scalar(Scalar::Slope);
        let water = self.water.borrow();
        let reader = water.river_reader();
        let view = water.read_only();
        for cell in 0..self.mesh.len() {
            let d = distance(&self.mesh, seat.cell, cell);
            if d > reach || !self.usable_seat(cell)? {
                continue;
            }
            let score =
                f64::from(self.seat_situation_with(cell, &reader, &view)? == seat.situation)
                    - slopes.get(cell)? * 10.0
                    - d / reach;
            if score > best_score {
                best_score = score;
                best = cell;
            }
        }
        Ok(best)
    }
}
