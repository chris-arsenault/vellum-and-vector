//! Bind captured City geography and policy to the ordinary Street development mechanisms.
use crate::{
    atlas::{state::State, town::site},
    features::{line_profile, network_parts::line_parts, Feature},
    field::{refinement::courses::cell_at, shared::Scalar, Field},
    processes::town::Candidate,
    spatial::{Predicate, SpatialKernel},
    town::{
        catalogue::Activity,
        fabric::{DistrictSite, DistrictTract, Town},
        network::{Arm, Class, Street},
        seat::Seat,
        templates::district::{Demands, DistrictLand, UseMix},
    },
};
use atlas_map::{regions::point, Geometry, Id, Position};
use std::io;

pub(crate) fn inherit(
    state: &State,
    district: &Feature,
    neighbours: &[Feature],
) -> io::Result<Town> {
    let spatial = state.spatial.as_ref();
    let outline = district.geometry.clone();
    let anchor = district
        .attributes
        .get("districtProgram")
        .and_then(|program| program.pointer("/evidence/anchor"))
        .and_then(|point| serde_json::from_value::<[f64; 2]>(point.clone()).ok());
    let centre = match anchor {
        Some([x, y])
            if spatial
                .relation(&outline, &point(Position::xy(x, y)), Predicate::Covers)
                .map_err(io::Error::other)? =>
        {
            [x, y]
        }
        _ => {
            let [x, y, _] = spatial
                .interior_position(&outline)
                .map_err(io::Error::other)?
                .coordinates();
            [x, y]
        }
    };
    let mut town = Town::new(
        Seat {
            key: district.id,
            name: district.name.clone(),
            centre,
            story: site::story(district, 0, false),
            arms: Vec::new(),
            culture: district
                .attributes
                .get("namingCulture")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
        },
        None,
    );
    if let Some(policy) = state
        .regional
        .as_ref()
        .and_then(|r| r.city.template.as_ref())
    {
        town.template = policy.clone();
    }
    let mut streets = Vec::new();
    let retained = approaches(state, neighbours, &outline, &mut town, &mut streets)?;
    town.set_approaches(streets);
    let (reserves, mut tracts) = land(state, neighbours, district)?;
    // City measures district-wide built land over all precincts; individual
    // tracts carry a local sample that locates that development.
    let sampled: f64 = tracts.iter().map(|t| t.developed_m2).sum();
    if let Some(built) = district.attributes.get("builtKm2").and_then(|v| v.as_f64()) {
        if sampled > 0. {
            for tract in &mut tracts {
                tract.developed_m2 *= built * 1e6 / sampled;
            }
        }
    }
    let tracts = super::neighbourhood::quarters(tracts, &town, spatial)?;
    let walls: Vec<_> = neighbours
        .iter()
        .filter(|f| {
            f.kind == "cityWall"
                && f.attributes.get("outgrown").and_then(|v| v.as_bool()) == Some(true)
        })
        .map(|f| f.geometry.clone())
        .collect();
    let old_walls = if walls.is_empty() {
        None
    } else {
        spatial.union_all(&walls).map_err(io::Error::other)?
    };
    town.district = Some(DistrictSite {
        outline,
        reserves,
        streets: retained,
        program: district
            .attributes
            .get("districtProgram")
            .map(|program| serde_json::from_value(program.clone()))
            .transpose()?,
        tracts,
        density_per_km2: district
            .attributes
            .get("densityPerKm2")
            .and_then(|v| v.as_f64()),
        old_walls,
    });
    Ok(town)
}

fn approaches(
    state: &State,
    neighbours: &[Feature],
    outline: &Geometry,
    town: &mut Town,
    streets: &mut Vec<Street>,
) -> io::Result<Vec<(Id, String)>> {
    let spatial = state.spatial.as_ref();
    let mut retained = Vec::new();
    let size = town.seat.story.size();
    let boundary = Geometry::MultiLineString {
        coordinates: atlas_map::regions::boundary_lines(outline),
    };
    let mut entries = std::collections::BTreeSet::new(); // hpc-exempt: geometric entries shared by clipped avenues.
    for route in neighbours.iter().filter(|f| f.kind == "thoroughfare") {
        if !spatial
            .relation(outline, &route.geometry, Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            continue;
        }
        let Some(route) = super::within_frame(spatial, route.clone(), outline)? else {
            continue;
        };
        let widths = line_profile::vertex_values(
            &route.attributes,
            "widths",
            &line_profile::pieces(&route.geometry),
        );
        let mut offset = 0;
        for line in line_parts(&route.geometry) {
            let start = offset;
            offset += line.len();
            if line.len() < 2 {
                continue;
            }
            let points: Vec<_> = line
                .iter()
                .map(|p| {
                    let [x, y, _] = p.coordinates();
                    [x, y]
                })
                .collect();
            let mut street = Street::new(points, Class::Main, size);
            if let Some(widths) = &widths {
                street.widths.copy_from_slice(&widths[start..offset]);
            }
            street.through_route = true;
            for (end, next, key) in [
                (0, 1, "from"),
                (line.len() - 1, line.len() - 2, "destination"),
            ] {
                let p = street.points[end];
                if spatial
                    .distance(&boundary, &point(line[end]))
                    .map_err(io::Error::other)?
                    <= crate::town::settings::JUNCTION_TOLERANCE
                    && entries.insert(crate::town::access::JunctionId::at(p))
                {
                    town.seat.arms.push(Arm {
                        points: vec![street.points[next], p],
                        destination: route
                            .attributes
                            .get(key)
                            .and_then(|v| v.as_str())
                            .map(str::to_owned),
                    });
                }
            }
            streets.push(street);
            retained.push((route.id, route.name.clone()));
        }
    }
    Ok(retained)
}

fn land(
    state: &State,
    neighbours: &[Feature],
    district: &Feature,
) -> io::Result<(Vec<Geometry>, Vec<DistrictTract>)> {
    let spatial = state.spatial.as_ref();
    let outline = &district.geometry;
    let mut reserves = Vec::new();
    let mut tracts = Vec::new();
    for kind in ["urbanGround", "cityBlock"] {
        for tract in neighbours.iter().filter(|f| f.kind == kind) {
            let Some(tract) = super::within_frame(spatial, tract.clone(), outline)? else {
                continue;
            };
            if tract.attributes.get("groundUse").and_then(|v| v.as_str()) == Some("Common ground") {
                reserves.push(tract.geometry);
            } else {
                let civic = tract.attributes.get("groundUse").and_then(|v| v.as_str())
                    == Some("Civic precinct");
                // Some civic precincts describe their sponsor and extent alone.
                // Their district still supplies measured occupation. Squares
                // and the sponsor's own footprint are separate reservations.
                let sample = |key, mean| {
                    tract
                        .attributes
                        .get(key)
                        .or_else(|| {
                            if civic {
                                district.attributes.get(mean)
                            } else {
                                None
                            }
                        })
                        .and_then(|v| v.as_f64())
                };
                let built_share = sample("builtShare", "builtShare");
                let density_per_km2 = sample("density", "densityPerKm2");
                let area = spatial.area(&tract.geometry).map_err(io::Error::other)?;
                tracts.push(DistrictTract {
                    civic,
                    developed_m2: if density_per_km2.is_some_and(|n| n > 0.) {
                        area * built_share.unwrap_or(0.)
                    } else {
                        0.
                    },
                    area: tract.geometry,
                    mix: tract
                        .attributes
                        .get("useMix")
                        .cloned()
                        .map(serde_json::from_value)
                        .transpose()?
                        .unwrap_or_default(),
                    built_share,
                    density_per_km2,
                });
            }
        }
    }
    for kind in ["park", "square", "building", "majorWork"] {
        for record in neighbours.iter().filter(|f| f.kind == kind) {
            let shape = record
                .footprint
                .clone()
                .unwrap_or_else(|| record.geometry.clone());
            if let Some(area) = atlas_map::regions::polygon(shape) {
                if spatial
                    .relation(outline, &area, Predicate::Intersects)
                    .map_err(io::Error::other)?
                {
                    reserves.push(area);
                }
            }
        }
    }
    Ok((reserves, tracts))
}

pub(crate) fn respond(
    town: &Town,
    candidates: &mut Vec<Candidate>,
    occupied: &mut [crate::town::influence::Conditions],
    spatial: &dyn SpatialKernel,
    field: &Field,
) -> io::Result<()> {
    let Some(site) = &town.district else {
        return Ok(());
    };
    let sites: Vec<_> = town
        .holdings()
        .iter()
        .map(|h| h.slot.front)
        .chain(candidates.iter().map(|c| c.slot.front))
        .map(|[x, y]| Position::xy(x, y))
        .collect();
    let mut positions = atlas_map::spatial::BoundsIndex::default();
    for p in &sites {
        let [x, y, _] = p.coordinates();
        positions.push(atlas_map::Bounds(x, y, x, y));
    }
    let mut assigned = vec![None; sites.len()];
    for tract in &site.tracts {
        let nearby: Vec<_> = positions
            .query(spatial.bounds(&tract.area).map_err(io::Error::other)?)
            .into_iter()
            .filter(|&i| assigned[i].is_none())
            .collect();
        if nearby.is_empty() {
            continue;
        }
        let points: Vec<_> = nearby.iter().map(|&i| sites[i]).collect();
        let inside = spatial
            .covers_points(&tract.area, &points)
            .map_err(io::Error::other)?;
        for (i, covered) in nearby.into_iter().zip(inside) {
            if covered {
                assigned[i] = Some(tract);
            }
        }
    }
    let (occupied_tracts, candidate_tracts) = assigned.split_at(town.holdings().len());
    let owned = spatial
        .covers_points(&site.outline, &sites[town.holdings().len()..])
        .map_err(io::Error::other)?;
    let demand_at = |slot: &crate::town::plots::Slot,
                     conditions: crate::town::influence::Conditions,
                     tract: Option<&DistrictTract>|
     -> io::Result<Demands> {
        let [x, y] = slot.front;
        if let Some(program) = &site.program {
            let mix = tract.map_or_else(UseMix::default, |t| t.use_mix(site.density_per_km2));
            let built_share = tract.and_then(|t| t.built_share);
            let civic = tract.is_some_and(|t| t.civic);
            let Some(cell) = cell_at(field.mesh(), [x, y]) else {
                return Ok(Demands::default());
            };
            let scalar = |id| field.shared().scalar(id).get(cell);
            let built = field
                .people()
                .view(crate::human::HumanField::Layer(
                    crate::human::catalogue::LayerId::BuiltUp,
                ))
                .get(cell)?;
            let mut demand = program.street_demand(
                DistrictLand {
                    wet: (scalar(Scalar::FloodplainIntensity)? / 1000.)
                        .max(scalar(Scalar::WetlandCover)?),
                    trees: scalar(Scalar::TreeCover)?,
                    slope: conditions.slope.max(0.),
                    built: built_share.unwrap_or(built).max(conditions.density).max(0.),
                    access: f64::from(slot.street.is_some()) + conditions.exchange.max(0.),
                    ruined: field
                        .people()
                        .view(crate::human::HumanField::RuinedBuiltUp)
                        .get(cell)?,
                    verdure: scalar(Scalar::Verdure)?.clamp(0., 1.),
                    tearing: scalar(Scalar::Tearing)?.clamp(0., 1.),
                    old_wall: site
                        .old_walls
                        .as_ref()
                        .map(|walls| {
                            spatial.relation(walls, &slot.occupied_shape(), Predicate::Intersects)
                        })
                        .transpose()
                        .map_err(io::Error::other)?
                        .unwrap_or(false),
                },
                mix,
            );
            demand.civic += f64::from(civic);
            return Ok(demand);
        }
        Ok(Demands::default())
    };
    for ((holding, local), &tract) in town.holdings().iter().zip(occupied).zip(occupied_tracts) {
        let demands = demand_at(&holding.slot, *local, tract)?;
        local.housing_demand = demands.housing;
        local.common_demand = demands.commons;
        local.garden_demand = demands.gardens;
        local.spaciousness = tract.and_then(DistrictTract::spaciousness);
    }
    let mut accepted = Vec::with_capacity(candidates.len());
    for ((mut candidate, owned), &tract) in candidates.drain(..).zip(owned).zip(candidate_tracts) {
        if owned {
            // How tightly the City found households living in this tract shapes the form a
            // new household takes and how readily its neighbours build upward.
            candidate.conditions.spaciousness = tract.and_then(DistrictTract::spaciousness);
            let demand = demand_at(&candidate.slot, candidate.conditions, tract)?;
            // How strongly the district's role shows beyond the usual town.
            let show = (town.order.character - 1.).max(0.);
            for (activity, asked) in [
                (Activity::Household, [demand.housing, demand.gardens]),
                (Activity::Trade, [demand.trade, -demand.access]),
                (Activity::Production, [demand.workshops, -demand.access]),
                (Activity::Service, [demand.civic, demand.commons]),
                (Activity::Agriculture, [demand.gardens, 0.]),
            ] {
                candidate.opportunities.add_local(activity, asked, show);
            }
            accepted.push(candidate);
        }
    }
    *candidates = accepted;
    Ok(())
}
