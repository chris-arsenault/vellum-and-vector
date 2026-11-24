//! The city's commissioned works keep their sites through the numerical development rounds.
use crate::{
    atlas::state::State,
    field::{
        people::work::habitable,
        poi::{
            kinds::Kind,
            map_records::{generated, Record},
            values::Place,
        },
    },
    town::{major_works::city_works, templates::Selection},
};
use atlas_map::{Geometry, Position};
use std::io;

pub(super) fn site(state: &mut State, selection: &Selection, seed: i32) -> io::Result<()> {
    if state
        .regional
        .as_ref()
        .is_none_or(|r| r.round > 1 || !r.city.works.is_empty())
    {
        return Ok(());
    }
    let mesh = state.field().mesh();
    let extent = state.scope.settled_outline();
    let points: Vec<_> = (0..mesh.len())
        .map(|cell| {
            let [x, y] = position(state, cell);
            Position::xy(x, y)
        })
        .collect();
    let inside = state
        .spatial
        .covers_points(extent, &points)
        .map_err(io::Error::other)?;
    let mut available = inside;
    let field = state.field();
    let capital = field.people().view(crate::human::HumanField::Layer(
        crate::human::catalogue::LayerId::Standing,
    ));
    let ways = field.people().view(crate::human::HumanField::KeptLine);
    let mut population = 0.;
    for (cell, open) in available.iter_mut().enumerate() {
        *open &= habitable(field, cell)?;
        if !*open {
            continue;
        }
        population += state.field().people().people(cell)? * mesh.area(cell) / 1e6;
    }
    let total = super::settlement(state)?
        .and_then(|s| s.people)
        .unwrap_or(population);

    let town = super::captured_settlement(state)?;
    let radius =
        (state.spatial.area(extent).map_err(io::Error::other)? / std::f64::consts::PI).sqrt();
    let mut works = Vec::new();
    for (family, [x, y]) in city_works(&selection.site, total, seed) {
        let reach = family
            .definition()
            .sponsor_reach()
            .max(selection.quarter() * 2.);
        let [ox, oy] = mesh.origin();
        let mut best: Option<(usize, f64)> = None;
        let mut backing = 0.;
        for cell in mesh.cells_within([x - ox, y - oy], reach) {
            if !available[cell] {
                continue;
            }
            let funds = capital.get(cell)? * mesh.area(cell) / 1e6;
            backing += funds;
            let residents = field.people().people(cell)? * mesh.area(cell) / 1e6;
            if funds <= 0. || residents <= 0. {
                continue;
            }
            let [px, py, _] = points[cell].coordinates();
            let distance = (px - x).hypot(py - y);
            let score = (1. + funds.ln_1p()) * (1. + ways.get(cell)?.sqrt())
                / (1. + (distance / reach * 3.).powi(2));
            if best.is_none_or(|(_, b)| score > b) {
                best = Some((cell, score));
            }
        }
        let grounds_cost =
            family.city().ground / 1e6 * crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2;
        if backing < grounds_cost {
            continue;
        }
        if let Some((site, _)) = best {
            let anchor = position(state, site);
            let [cx, cy] = selection.site.centre;
            let established = town
                .as_ref()
                .and_then(|t| {
                    super::occupation_era(
                        t,
                        radius,
                        (anchor[0] - cx).hypot(anchor[1] - cy),
                        family.city().ground.sqrt(),
                    )
                })
                .map(str::to_owned);
            works.push(crate::town::major_works::CityWork {
                family,
                cell: site as u32,
                design: family.definition().design(
                    &selection.site,
                    anchor,
                    &[],
                    seed.wrapping_add(family as i32),
                ),
                established,
            });
            let separation = family.city().ground.sqrt() + mesh.spacing();
            for c in mesh.cells_within(mesh.position(site), separation) {
                available[c] = false;
            }
        }
    }
    state.regional.as_mut().unwrap().city.works = works;
    Ok(())
}
fn position(state: &State, cell: usize) -> [f64; 2] {
    let mesh = state.field().mesh();
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    [x + ox, y + oy]
}

/// Each major work at its site.
pub(super) fn work_records(state: &State) -> io::Result<Vec<Place>> {
    let Some(city) = state.regional.as_ref().map(|r| &r.city) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (index, work) in city.works.iter().enumerate() {
        let (family, cell) = (work.family, work.cell);
        let appearance = family.city();
        let [x, y] = position(state, cell as usize);
        let mut attributes = crate::features::records::Attributes::new();
        // District maps inherit captured works by this attribute (`atlas/town/founding_site`).
        attributes.insert("majorWorkFamily".into(), family.key().into());
        attributes.insert("symbol".into(), appearance.symbol.into());
        attributes.insert("groundM2".into(), appearance.ground.into());
        attributes.insert("workDesign".into(), serde_json::json!(work.design));
        if let Some(era) = &work.established {
            attributes.insert("establishedInEra".into(), era.clone().into());
        }
        let key = format!("major-work-{index}");
        let feature = generated(
            state,
            Record {
                key: &key,
                name: family.label(),
                kind: "majorWork",
                layer: "settlements",
                geometry: Geometry::Point {
                    coordinates: Position::xy(x, y),
                },
                attributes,
            },
        )?;
        let mut place = Place::at(Kind::MajorWork, cell as usize, vec![cell as usize]);
        place.id = key;
        place.feature = Some(feature);
        records.push(place);
    }
    Ok(records)
}
