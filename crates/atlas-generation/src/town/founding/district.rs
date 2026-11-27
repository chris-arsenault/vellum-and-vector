use super::*;
use crate::town::templates::district::{Demands, DistrictLand};
use atlas_map::{regions::point, Position};

/// Found each tract the City records as inhabited with a kernel of premises, as a town is
/// founded, at the place its street survey chose. The development rounds raise the rest of
/// the district from these kernels. A tract without an avenue starts round its own site.
pub(crate) fn occupy_district(
    town: &mut Town,
    origins: Vec<Option<TractAccess>>,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    conditions: impl Fn(Point) -> io::Result<Option<Conditions>>,
) -> io::Result<()> {
    let Some(district) = town.district.as_ref() else {
        return Ok(());
    };
    let scale = town.scale();
    let frontage = scale.length(FOUNDING_FRONTAGE, Measure::Plot);
    let depth = town.plot().1;
    let fronts: Vec<_> = town
        .streets()
        .iter()
        .enumerate()
        .flat_map(|(i, s)| slots(i, s, frontage, depth, scale))
        .collect();
    let positions: Vec<_> = fronts
        .iter()
        .map(|s| Position::xy(s.front[0], s.front[1]))
        .collect();
    let shapes: Vec<_> = positions.iter().copied().map(point).collect();
    let index = spatial.index(&shapes).map_err(io::Error::other)?;
    let tracts = district.tracts.clone();
    let program = district.program.clone();
    let district_density = district.density_per_km2;
    // A tract's kernel is as many premises as its template founds a town with.
    let kernel = town.template.kernel().len().max(1);
    for (tract, origin) in tracts.into_iter().zip(origins) {
        let Some(TractAccess { origin, streets }) = origin else {
            continue;
        };
        let built = tract.built_share.unwrap_or(0.);
        let spaciousness = tract.spaciousness();
        let local_conditions = |p| {
            Ok(conditions(p)?.map(|c| Conditions {
                density: built,
                spaciousness,
                ..c
            }))
        };
        let nearby = index
            .query(spatial.bounds(&tract.area).map_err(io::Error::other)?)
            .map_err(io::Error::other)?;
        let points: Vec<_> = nearby.iter().map(|&i| positions[i]).collect();
        let inside = spatial
            .covers_points(&tract.area, &points)
            .map_err(io::Error::other)?;
        let mut sites: Vec<_> = nearby
            .into_iter()
            .zip(inside)
            .filter(|(_, yes)| *yes)
            .map(|(i, _)| fronts[i].clone())
            .collect();
        let developed = tract.developed_m2;
        if developed <= 0. {
            continue;
        }
        // No more than the ground the City records as developed has room for.
        let room = (developed / (frontage * depth)).ceil() as usize;
        let target = kernel.min(room);
        let order = |sites: &mut Vec<Slot>| {
            // hpc-exempt: geometric parcels ranked within one City tract.
            let first_row = |s: &Slot| {
                s.street
                    .is_some_and(|id| streets.binary_search(&id).is_ok())
            };
            sites.sort_by(|a, b| {
                first_row(b)
                    .cmp(&first_row(a))
                    .then_with(|| distance(origin, a.front).total_cmp(&distance(origin, b.front)))
            });
        };
        order(&mut sites);
        let mut occupied = 0;
        let demands = |access| {
            let mut demand = program
                .as_ref()
                .map(|p| {
                    p.street_demand(
                        DistrictLand {
                            built,
                            access,
                            ..Default::default()
                        },
                        tract.use_mix(district_density),
                    )
                })
                .unwrap_or_default();
            demand.civic += f64::from(tract.civic);
            demand
        };
        let demand = demands(1.);
        for slot in sites {
            if occupy(town, ground, spatial, &local_conditions, slot, demand)? {
                occupied += 1;
                if occupied >= target {
                    break;
                }
            }
        }
        if occupied == 0 {
            let radius = (developed / std::f64::consts::PI).sqrt().max(depth);
            let mut sites = crate::town::land_sites::around([origin], radius, frontage, depth, 0);
            order(&mut sites);
            let points: Vec<_> = sites
                .iter()
                .map(|s| Position::xy(s.front[0], s.front[1]))
                .collect();
            let inside = spatial
                .covers_points(&tract.area, &points)
                .map_err(io::Error::other)?;
            let demand = demands(0.);
            for (slot, inside) in sites.into_iter().zip(inside) {
                if inside && occupy(town, ground, spatial, &local_conditions, slot, demand)? {
                    occupied += 1;
                    if occupied >= target {
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

fn occupy(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    conditions: &impl Fn(Point) -> io::Result<Option<Conditions>>,
    slot: Slot,
    demand: Demands,
) -> io::Result<bool> {
    let Some(mut slot) = survey_slot(town, ground, slot) else {
        return Ok(false);
    };
    let Some(mut local) = conditions(slot.front)? else {
        return Ok(false);
    };
    local.housing_demand = demand.housing;
    local.institutions = demand.civic;
    local.garden_demand = demand.gardens;
    local.workshops = demand.workshops;
    local.exchange = demand.trade;
    local.common_demand = demand.commons;
    let kind = district_livelihood(town, &slot, local, demand).unwrap_or_else(|| {
        founding_household(
            local,
            slot.front,
            distance(town.seat.centre, slot.front),
            demand.trade,
            town.scale(),
        )
    });
    let activity = kind.definition().activity;
    if town.template.affinity(activity, slot.front, town.plot().1) <= 0. {
        return Ok(false);
    }
    slot.tenure = town.template.tenure(activity, slot.front, town.plot().1);
    let scale = town.scale();
    let definition = kind.definition();
    let width = scale.range(definition.frontage);
    let depth = scale.range(definition.depth);
    let size = (
        slot.frontage.clamp(width.low, width.high),
        slot.depth.clamp(depth.low, depth.high),
    );
    let Some(edit) = sized_placement(&slot, kind, local, ground, scale, size)
        .or_else(|| placement(&slot, kind, local, ground, scale))
    else {
        return Ok(false);
    };
    if let EditOutcome::Premises(id) = town.apply(edit, spatial)? {
        town.occupy(id, 0.5, 0.45, 0.75, 0.);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Resolve the City's existing workshops, trade and services at their frontages.
/// Named City landmarks already have reserved sites on this map.
fn district_livelihood(
    town: &Town,
    slot: &Slot,
    local: Conditions,
    demand: Demands,
) -> Option<super::super::catalogue::Kind> {
    use crate::town::catalogue::{palette, Activity, PLACES};
    let [x, y] = slot.front;
    let total = demand.trade + demand.workshops + demand.civic;
    let draw = crate::noise::hash_unit(311, x, y) * (1. + demand.housing + total);
    if draw >= total {
        return None;
    }
    let activity = if draw < demand.trade {
        Activity::Trade
    } else if draw < demand.trade + demand.workshops {
        Activity::Production
    } else {
        Activity::Service
    };
    let road = slot.street.map(|id| &town.streets()[id]);
    let site = crate::town::siting::Location::at(local, road, slot.along, 0., town.scale());
    PLACES
        .iter()
        .enumerate()
        .filter_map(|(i, &family)| {
            let kind = palette(family, crate::noise::hash_unit(67, x, y));
            let def = kind.definition();
            if def.activity != activity
                || kind.open()
                || def.city.appearance().is_some()
                || !crate::town::siting::feasible(kind, local, slot.street)
                || town.template.affinity(activity, slot.front, town.plot().1) <= 0.
            {
                return None;
            }
            let fit = site.attraction(def) / (1. + def.demand);
            let sample = crate::noise::hash_unit(701 + i as i32, x, y).max(f64::EPSILON);
            Some((fit / -sample.ln(), kind))
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, kind)| kind)
}
