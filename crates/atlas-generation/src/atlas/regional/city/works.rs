//! The city's commissioned works keep their sites through the numerical development rounds.
use crate::{
    atlas::state::State,
    field::shared::Scalar,
    field::{
        people::work::habitable,
        poi::{
            kinds::Kind,
            map_records::{generated, Record},
            values::Place,
        },
    },
    town::catalogue::works::CitySite,
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
    let Some(settlement) = super::settlement(state)? else {
        return Ok(());
    };
    let census = settlement.people;
    let mut surroundings = super::survey(state, settlement, true)?;
    surroundings.guarded |= selection.site.guarded;
    surroundings.seat |= selection.site.seat;
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
    // owner-direction(2026-11-24): major works choose sites early across the known City extent and each work defines its own influence.
    let mut available = inside;
    let field = state.field();
    let capital = field.people().view(crate::human::HumanField::Layer(
        crate::human::catalogue::LayerId::Standing,
    ));
    let ways = field.people().view(crate::human::HumanField::KeptLine);
    let mut population = 0.;
    let mut backing = 0.;
    let mut sites = vec![CitySite::default(); mesh.len()];
    let mut low = f64::INFINITY;
    let mut high = f64::NEG_INFINITY;
    let mut steep: f64 = 0.;
    let mut busiest: f64 = 0.;
    for (cell, open) in available.iter_mut().enumerate() {
        *open &= habitable(field, cell)?;
        if !*open {
            continue;
        }
        population += state.field().people().people(cell)? * mesh.area(cell) / 1e6;
        backing += capital.get(cell)? * mesh.area(cell) / 1e6;
        let read = |band| field.shared().scalar(band).get(cell);
        let height = field
            .ground()
            .view(crate::rock::ground::GroundField::Elevation)
            .get(cell)?;
        let slope = read(Scalar::Slope)?.max(0.);
        let access = ways.get(cell)?.max(0.).ln_1p();
        low = low.min(height);
        high = high.max(height);
        steep = steep.max(slope);
        busiest = busiest.max(access);
        let mut lake = false;
        let mut shore = false;
        for other in (0..3).filter_map(|e| mesh.neighbor(cell, e)) {
            lake |= field.water().column.kind.get(other)? == 2;
            shore |= !habitable(field, other)?;
        }
        sites[cell] = CitySite {
            height,
            slope,
            access,
            lake,
            shore,
            built: field
                .people()
                .view(crate::human::HumanField::Layer(
                    crate::human::catalogue::LayerId::BuiltUp,
                ))
                .get(cell)?
                .clamp(0., 1.),
            woods: read(Scalar::TreeCover)?,
            flood: read(Scalar::FloodplainIntensity)?.max(read(Scalar::FloodFrequency)?),
            salt: read(Scalar::Salting)?,
            near_door: surroundings.door.map_or(0., |p| {
                let [x, y] = position(state, cell);
                (1. - (x - p[0]).hypot(y - p[1]) / (mesh.spacing() * 2.)).max(0.)
            }),
        };
    }
    let total = census.unwrap_or(population);

    let town = super::captured_settlement(state)?;
    let radius =
        (state.spatial.area(extent).map_err(io::Error::other)? / std::f64::consts::PI).sqrt();
    let mut works = Vec::new();
    let established = reserve_existing_works(state, &mut available)?;
    for s in &mut sites {
        s.height = (s.height - low) / (high - low).max(1.);
        s.slope /= steep.max(1e-9);
        s.access /= busiest.max(1e-9);
    }
    for family in city_works(&surroundings, total, seed) {
        if established.iter().any(|key| key == family.key()) {
            continue;
        }
        let best = best_work_site(state, seed, &available, &sites, family)?;
        let grounds_cost =
            family.city().ground / 1e6 * crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2;
        if backing < grounds_cost {
            continue;
        }
        if let Some((site, _)) = best {
            backing -= grounds_cost;
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
                    &surroundings,
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

fn best_work_site(
    state: &State,
    seed: i32,
    available: &[bool],
    sites: &[CitySite],
    family: crate::town::major_works::WorkFamily,
) -> io::Result<Option<(usize, f64)>> {
    let mesh = state.field().mesh();
    let capital = state.field().people().view(crate::human::HumanField::Layer(
        crate::human::catalogue::LayerId::Standing,
    ));
    let mut best: Option<(usize, f64)> = None;
    for cell in 0..mesh.len() {
        if !available[cell] {
            continue;
        }
        let funds = capital.get(cell)? * mesh.area(cell) / 1e6;
        let [px, py] = position(state, cell);
        let score = family.suitability(sites[cell])
            * (1. + 0.10 * funds.ln_1p())
            * (0.95 + 0.05 * crate::noise::hash_unit(seed ^ family as i32, px, py));
        if score <= 0. {
            continue;
        }
        if best.is_none_or(|(_, b)| score > b) {
            best = Some((cell, score));
        }
    }
    Ok(best)
}

fn reserve_existing_works(state: &State, available: &mut [bool]) -> io::Result<Vec<String>> {
    let mesh = state.field().mesh();
    let mut established = Vec::new();
    let source = state.records.source_features.as_deref();
    let query = crate::features::FeatureSelection {
        area_id: source.is_none().then_some(state.scope.area),
        kind: Some("majorWork"),
        layer_id: None,
    };
    let records = match source {
        Some(reader) => reader.values(query)?,
        None => state.records.features.values(query)?,
    };
    for record in records {
        let record = record?;
        let at = state
            .spatial
            .interior_position(&record.geometry)
            .map_err(io::Error::other)?;
        let [x, y, _] = at.coordinates();
        let Some(c) = crate::field::refinement::courses::cell_at(mesh, [x, y]) else {
            continue;
        };
        if !available[c] {
            continue;
        }
        if let Some(key) = record
            .attributes
            .get("majorWorkFamily")
            .and_then(|v| v.as_str())
        {
            established.push(key.to_owned());
        }
        let ground = record
            .attributes
            .get("groundM2")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.);
        for other in mesh.cells_within(mesh.position(c), ground.sqrt() + mesh.spacing()) {
            available[other] = false;
        }
    }
    Ok(established)
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
