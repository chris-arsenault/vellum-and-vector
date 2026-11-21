//! Founders read the same ground, captured institutions and maintained routes as later townsfolk.
use super::providers;
use crate::{
    atlas::state::State,
    features::Feature,
    field::{people::crafts, poi::values::Benefit, refinement::courses::cell_at, shared::Scalar},
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    town::{
        geometry::{add, distance, Point},
        ground::{Ground, FREE, WATER},
        major_works::{InheritedWork, WorkFamily},
        seat::Seat,
        templates::SiteEvidence,
    },
};
use atlas_map::{spatial::SpatialIndex, Bounds, Geometry, Position};
use std::io;

pub(super) struct Context<'a> {
    records: Vec<Feature>,
    index: Box<dyn SpatialIndex + 'a>,
    seats: Box<dyn SpatialIndex + 'a>,
    inherited: Vec<Vec<InheritedWork>>,
    doors: Vec<crate::links::Link>,
}
fn observe_landscape(
    land: &mut crate::town::major_works::WorkLandscape,
    field: &crate::field::Field,
    cell: usize,
    ground: u32,
    point: crate::town::geometry::Point,
) -> io::Result<()> {
    let read = |band| field.shared().scalar(band).get(cell);
    let water = field.water();
    if ground == WATER {
        let held = water
            .column
            .store(crate::water::column::Store::Standing)
            .held(cell)?;
        // The submerged sounding station requires a real descent.
        if held >= 12. {
            land.deep_water.get_or_insert(point);
        }
        return Ok(());
    }
    if ground != FREE {
        return Ok(());
    }
    land.frost |= read(Scalar::Snowfall)? > 0. || read(Scalar::IceThickness)? > 0.;
    if read(Scalar::FloodplainIntensity)? > 0. || read(Scalar::FloodFrequency)? > 0. {
        land.floodplain.get_or_insert(point);
    }
    if read(Scalar::TreeCover)? > 0. {
        land.timber.get_or_insert(point);
    }
    if read(Scalar::IceThickness)? > 0. && read(Scalar::Stillness)? > 0. {
        land.ice_record.get_or_insert(point);
    }
    if read(Scalar::Salting)? > 0. && crafts::practised(field, crafts::CRAFTS[4], cell)? > 0. {
        land.salt_pan.get_or_insert(point);
    }
    if land.lake_shore.is_none() {
        for neighbor in (0..3).filter_map(|edge| field.mesh().neighbor(cell, edge)) {
            if water.column.kind.get(neighbor)? == 2 {
                land.lake_shore = Some(point);
                break;
            }
        }
    }
    Ok(())
}
impl<'a> Context<'a> {
    pub fn new(state: &'a State, seats: &[Seat]) -> io::Result<Self> {
        let records = providers::contextual_features(state)?
            .into_iter()
            .filter(|feature| {
                state.catalogue.offers_for(feature).is_some()
                    || feature.attributes.contains_key("majorWorkFamily")
                    || feature.attributes.contains_key("tenure")
                    || feature.attributes.contains_key("habitat")
            })
            .collect::<Vec<_>>();
        let geometries = records
            .iter()
            .map(|f| f.geometry.clone())
            .collect::<Vec<_>>();
        let centres = seats
            .iter()
            .map(|seat| Geometry::Point {
                coordinates: Position::xy(seat.centre[0], seat.centre[1]),
            })
            .collect::<Vec<_>>();
        let seat_index = state.spatial.index(&centres).map_err(io::Error::other)?;
        let mut inherited = vec![Vec::new(); seats.len()];
        for feature in records.iter().filter(|f| f.kind == "majorWork") {
            let Some(family) = feature
                .attributes
                .get("majorWorkFamily")
                .and_then(|v| v.as_str())
                .and_then(WorkFamily::from_key)
            else {
                continue;
            };
            let point = state
                .spatial
                .interior_position(&feature.geometry)
                .map_err(io::Error::other)?;
            let [x, y, _] = point.coordinates();
            if cell_at(state.field().mesh(), [x, y]).is_none() {
                continue;
            }
            let owner = match feature
                .attributes
                .get("settlementId")
                .cloned()
                .and_then(|v| serde_json::from_value::<atlas_map::Id>(v).ok())
            {
                Some(id) => seats.iter().position(|s| s.key == id),
                None => seat_index.nearest(point).map_err(io::Error::other)?,
            };
            if let Some(i) = owner {
                let design = feature
                    .attributes
                    .get("workDesign")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(io::Error::other)?;
                inherited[i].push(InheritedWork {
                    family,
                    id: feature.id,
                    anchor: [x, y],
                    design,
                });
            }
        }
        Ok(Self {
            records,
            index: state.spatial.index(&geometries).map_err(io::Error::other)?,
            seats: seat_index,
            inherited,
            doors: providers::kept_links(state)?,
        })
    }
    pub fn survey(
        &self,
        state: &State,
        seat: &Seat,
        seat_index: usize,
        ground: &Ground,
        scale: crate::town::scale::TownScale,
    ) -> io::Result<(SiteEvidence, Vec<InheritedWork>)> {
        let field = state.field();
        let mesh = field.mesh();
        let centre = seat.centre;
        let founding = crate::town::founding::reach(scale, seat.story.size());
        let reach = (founding * 3.).max(mesh.cell_span() * 3.);
        let [x, y] = centre;
        let bounds = Bounds(x - reach, y - reach, x + reach, y + reach);
        let position = |cell| add(mesh.origin(), mesh.position(cell));
        let mut evidence = SiteEvidence {
            centre,
            seat: seat.story.seat,
            old: seat.story.old(),
            planned: seat.story.planned(),
            guarded: seat.story.guarded,
            approaches: seat
                .arms
                .iter()
                .filter_map(|a| crate::town::geometry::at(&a.points, founding).map(|(p, _)| p))
                .collect(),
            ..Default::default()
        };
        let bed = survey_ground(state, ground, bounds, &mut evidence)?;
        evidence.door = self
            .doors
            .iter()
            .flat_map(|link| [position(link.a), position(link.b)])
            .filter(|p| distance(*p, centre) <= reach)
            .min_by(|a, b| distance(*a, centre).total_cmp(&distance(*b, centre)));
        evidence.works.paired_door = evidence.door.and_then(|door| {
            self.doors.iter().find_map(|link| {
                let (a, b) = (position(link.a), position(link.b));
                if a == door {
                    Some(b)
                } else if b == door {
                    Some(a)
                } else {
                    None
                }
            })
        });
        let inherited = self.inherited[seat_index].clone();
        let mut nearby = self
            .index
            .distances(bounds, Position::xy(x, y))
            .map_err(io::Error::other)?;
        nearby.sort_by(|a, b| a.1.total_cmp(&b.1));
        for (index, gap) in nearby {
            if gap > reach {
                continue;
            }
            let f = &self.records[index];
            let point = state
                .spatial
                .interior_position(&f.geometry)
                .map_err(io::Error::other)?;
            let [px, py, _] = point.coordinates();
            let p = [px, py];
            if self.seats.nearest(point).map_err(io::Error::other)? != Some(seat_index) {
                continue;
            }
            observe_feature(state, ground, f, p, &mut evidence)?;
        }
        if evidence.industry.is_some() && evidence.shore.is_some() && evidence.submerged.is_none() {
            // A shore crew can build a vented lock on shallow bed held free of water by local divers.
            evidence.submerged =
                bed.filter(|p| distance(*p, evidence.shore.unwrap()) <= mesh.cell_span() * 2.);
        }
        Ok((evidence, inherited))
    }
}

fn observe_feature(
    state: &State,
    ground: &Ground,
    f: &Feature,
    p: Point,
    evidence: &mut SiteEvidence,
) -> io::Result<()> {
    let mesh = state.field().mesh();
    if f.attributes
        .get("habitat")
        .and_then(|v| v.as_str())
        .is_some_and(|h| h.eq_ignore_ascii_case("submerged"))
        && ground.owner(p) == WATER
    {
        evidence.submerged.get_or_insert(p);
    }
    if f.attributes
        .get("tenure")
        .and_then(|v| v.as_str())
        .is_some_and(|t| matches!(t, "freehold" | "household" | "common"))
    {
        evidence.free_tenure = true;
    }
    if let (Some(offers), Some(cell)) = (state.catalogue.offers_for(f), cell_at(mesh, p)) {
        for (benefit, strength) in offers(state, cell)? {
            if strength <= 0. {
                continue;
            }
            match benefit {
                Benefit::Sanctity | Benefit::Rule => {
                    evidence.institution.get_or_insert(p);
                }
                Benefit::Materials | Benefit::Power => {
                    evidence.industry.get_or_insert(p);
                }
                _ => {}
            }
        }
    }
    Ok(())
}
fn survey_magic(
    field: &crate::field::Field,
    cell: usize,
    p: Point,
    dry: bool,
    evidence: &mut SiteEvidence,
) -> io::Result<()> {
    for (i, craft) in crafts::CRAFTS.iter().copied().enumerate() {
        let medium = crafts::medium_at(field, craft, cell)?;
        let practice = crafts::practised(field, craft, cell)?;
        evidence.medium[i] = evidence.medium[i].max(medium);
        evidence.practice[i] = evidence.practice[i].max(practice);
        if practice > 0. && dry {
            match craft.system {
                "salt" | "aurora" => {
                    evidence.witness.get_or_insert(p);
                }
                "hallowed" => evidence.vowed = true,
                "greenwood" if field.shared().scalar(Scalar::TreeCover).get(cell)? > 0. => {
                    evidence.grove.get_or_insert(p);
                }
                _ => {}
            }
        }
    }
    Ok(())
}
fn survey_ground(
    state: &State,
    ground: &Ground,
    bounds: Bounds,
    evidence: &mut SiteEvidence,
) -> io::Result<Option<Point>> {
    let field = state.field();
    let mesh = field.mesh();
    let centre = evidence.centre;
    let position = |cell| add(mesh.origin(), mesh.position(cell));
    let mut cells = mesh.window_cells(bounds);
    cells.sort_by(|&a, &b| distance(position(a), centre).total_cmp(&distance(position(b), centre)));
    let mut heights = Vec::new();
    let mut bed = None;
    for cell in cells {
        let p = position(cell);
        observe_landscape(&mut evidence.works, field, cell, ground.owner(p), p)?;
        let h = MapScale::metres(
            field.ground().view(GroundField::Elevation).get(cell)?,
            LengthUnit::Native,
        );
        survey_magic(field, cell, p, ground.owner(p) == FREE, evidence)?;
        match ground.owner(p) {
            FREE => {
                heights.push((h, p));
                evidence.cultivated |= super::site::worked_shares(field, cell)?.0 > 0.;
                if super::development::shore(field, cell, false)? {
                    evidence.shore.get_or_insert(p);
                }
            }
            WATER => {
                evidence.afloat.get_or_insert(p);
                if bed.is_none()
                    && crafts::sea_held_off(field, cell)? > 0.
                    && field.shared().scalar(Scalar::Slope).get(cell)? < 0.15
                {
                    bed = Some(p);
                }
            }
            _ => {}
        }
    }
    if let (Some(low), Some(high)) = (
        heights.iter().min_by(|a, b| a.0.total_cmp(&b.0)),
        heights.iter().max_by(|a, b| a.0.total_cmp(&b.0)),
    ) {
        // Two near-level working surfaces separated by at least a storey and a steep rise.
        if high.0 - low.0 > 4. && high.0 - low.0 > 0.12 * distance(high.1, low.1) {
            evidence.lower = Some(low.1);
            evidence.upper = Some(high.1);
        }
    }
    if let Some(landing) = evidence.shore {
        evidence.far_shore = opposite_landing(ground, landing, &heights);
    }
    Ok(bed)
}
fn opposite_landing(ground: &Ground, landing: Point, dry: &[(f64, Point)]) -> Option<Point> {
    // Each dry candidate is a landable lattice site. A ferry needs a single intervening
    // reach of open water with a short overland approach on both ends.
    dry.iter().map(|(_, p)| *p).find(|&p| {
        let length = distance(landing, p);
        if length < 2. * ground.cell {
            return false;
        }
        let runs = ground.wet_runs(&[landing, p]);
        matches!(runs.as_slice(), [(start,end)] if end-start > length * 0.5)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_landing_requires_crossing_open_water() {
        let mut ground = Ground::new([0., 0., 60., 30.], 1.);
        for i in 0..ground.count() {
            if (20.0..40.0).contains(&ground.centre(i)[0]) {
                ground.withhold(i, WATER);
            }
        }
        let near = [18., 12.];
        let same = [18., 22.];
        let far = [41., 12.];
        assert_eq!(opposite_landing(&ground, near, &[(0., same)]), None);
        assert_eq!(
            opposite_landing(&ground, near, &[(0., same), (0., far)]),
            Some(far)
        );
    }
}
