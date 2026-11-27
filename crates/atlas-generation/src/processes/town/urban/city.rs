//! Final partition of the principal settlement, after its broad geography has developed.
use super::{
    fields::{policy, position},
    geometry::{self, faces, pos, xy},
    Element, Urban,
};
use crate::spatial::SpatialKernel;
use crate::{
    atlas::state::State,
    field::refinement::courses::cell_at,
    human::{catalogue::LayerId, HumanField},
    spatial::Overlay,
    town::city::hot_spots,
};
use atlas_map::{regions::parts, Geometry, Position};
use std::io;

pub(super) fn districts(
    state: &State,
    urban: &mut Urban,
    retained: Vec<crate::features::Feature>,
    boundary_weight: f64,
) -> io::Result<()> {
    let kernel = state.spatial.as_ref();
    urban.districts.clear();
    let frame = state
        .scope
        .outline
        .as_ref()
        .unwrap_or(&state.scope.footprint);
    for f in retained {
        if let Some(f) = super::within_frame(kernel, f, frame)? {
            urban.captured.push(f);
        }
    }
    let Some(domain) = urban.domain.clone() else {
        return Ok(());
    };
    let domain = &domain;
    let mesh = state.field().mesh();
    let points: Vec<_> = (0..mesh.len()).map(|c| position(mesh, c)).collect();
    let positions: Vec<_> = points.iter().copied().map(pos).collect();
    let polygons = divide_precincts(state, urban, domain, &points, &positions)?;
    if polygons.is_empty() {
        return Ok(());
    }
    let mut precincts = measure_precincts(state, urban, polygons)?;
    let approaches: Vec<_> = urban
        .routes
        .iter()
        .filter(|r| r.attributes.get("class").and_then(|v| v.as_str()) == Some("Approach"))
        .map(|r| r.geometry.clone())
        .collect();
    if urban.programs.is_empty() {
        return Ok(());
    }
    let seats: Vec<_> = urban.programs.iter().map(|p| positions[p.cell]).collect();
    assign_founders(kernel, &seats, policy(state)?.quarter(), &mut precincts)?;
    let origin = crate::atlas::regional::city::captured_settlement(state)?;
    let culture = origin
        .as_ref()
        .and_then(|s| s.attributes.get("namingCulture"))
        .and_then(|v| v.as_str());
    let districts = super::partition::partition(kernel, &precincts, &approaches, boundary_weight)?;
    for (i, group) in districts.into_iter().enumerate() {
        let members = group.precincts.iter().map(|&j| &precincts[j]);
        let residents: f64 = members.clone().map(|p| p.residents).sum();
        let developed: f64 = members.clone().map(|p| p.built).sum();
        let area: f64 = members.clone().map(|p| p.area).sum();
        let shapes: Vec<_> = members.map(|p| p.shape.clone()).collect();
        let g = kernel
            .union_all(&shapes)
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("District precincts require polygonal ground"))?;
        let program = group
            .program
            .and_then(|j| urban.programs.get(j))
            .ok_or_else(|| io::Error::other("District lost its founding program"))?;
        let name = state
            .naming
            .work(
                &state.scope,
                &format!("district-{}", program.cell),
                "ward",
                points[program.cell],
                culture,
            )?
            .name;
        let origins = super::programs::district_origins(state, program, &g, &positions, culture)?;
        let mut district = Element::new(g, "district", &name);
        district.attributes.insert("districtProgram".into(),
            serde_json::json!({"economic":program.economic,"social":program.social,"traits":program.traits,"origins":origins,"evidence":program.evidence,"demands":program.demands}),
        );
        district.attributes.insert(
            "settlementTemplate".into(),
            policy(state)?.selected.name().into(),
        );
        district.attributes.insert(
            "templatePolicy".into(),
            serde_json::to_value(policy(state)?).map_err(io::Error::other)?,
        );
        district
            .attributes
            .insert("districtNumber".into(), (i + 1).into());
        district.attributes.insert(
            "adjoiningDistricts".into(),
            serde_json::json!(group
                .neighbors
                .into_iter()
                .map(|n| n + 1)
                .collect::<Vec<_>>()),
        );
        district
            .attributes
            .insert("population".into(), residents.round().into());
        district
            .attributes
            .insert("builtKm2".into(), developed.into());
        district
            .attributes
            .insert("builtShare".into(), (developed * 1e6 / area).into());
        district
            .attributes
            .insert("densityPerKm2".into(), (residents * 1e6 / area).into());
        district.attributes.insert("urbanPlan".into(), true.into());
        urban.districts.push(district);
    }
    Ok(())
}

fn assign_founders(
    kernel: &dyn SpatialKernel,
    seats: &[Position],
    quarter: f64,
    precincts: &mut [super::partition::Precinct],
) -> io::Result<()> {
    let shapes: Vec<_> = precincts.iter().map(|p| p.shape.clone()).collect();
    let index = kernel.index(&shapes).map_err(io::Error::other)?;
    for (number, &seat) in seats.iter().enumerate() {
        let [x, y, _] = seat.coordinates();
        let b = atlas_map::Bounds(x - quarter, y - quarter, x + quarter, y + quarter);
        let closest = index
            .distances(b, seat)
            .map_err(io::Error::other)?
            .into_iter()
            .filter(|&(i, d)| {
                d <= quarter
                    && precincts[i].anchor.is_none()
                    && precincts[i].residents > 0.
                    && (d == 0. || precincts[i].program == Some(number))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        if let Some((i, _)) = closest {
            precincts[i].anchor = Some(number);
        }
    }
    // A severed block can still belong to an established district. A provisional
    // catchment which never established a seat cannot create another district there.
    let established: Vec<_> = precincts.iter().filter_map(|p| p.anchor).collect();
    if !established.is_empty() {
        let centres: Vec<_> = established
            .iter()
            .map(|&i| atlas_map::regions::point(seats[i]))
            .collect();
        let accepted = kernel.index(&centres).map_err(io::Error::other)?;
        for p in precincts
            .iter_mut()
            .filter(|p| !p.program.is_some_and(|i| established.contains(&i)))
        {
            let at = kernel
                .interior_position(&p.shape)
                .map_err(io::Error::other)?;
            p.program = accepted
                .nearest(at)
                .map_err(io::Error::other)?
                .map(|i| established[i]);
        }
    }
    Ok(())
}

fn measure_precincts(
    state: &State,
    urban: &Urban,
    polygons: Vec<Geometry>,
) -> io::Result<Vec<super::partition::Precinct>> {
    let kernel = state.spatial.as_ref();
    let claims = &urban.fields.claims;
    let f = state.field();
    let mesh = f.mesh();
    let built = f.people().view(HumanField::Layer(LayerId::BuiltUp));
    let cells: Vec<_> = (0..mesh.len())
        .map(|c| geometry::ring(&crate::lattice::hexes::triangle_corners(mesh, c)))
        .collect();
    let index = kernel.index(&cells).map_err(io::Error::other)?;
    let [ox, oy] = mesh.origin();
    let works: Vec<_> = state
        .regional
        .iter()
        .flat_map(|r| &r.city.works)
        .map(|work| {
            let [x, y] = mesh.position(work.cell as usize);
            Position::xy(ox + x, oy + y)
        })
        .collect();
    let mut precincts = Vec::new();
    for g in polygons {
        let ids = index
            .query(kernel.bounds(&g).map_err(io::Error::other)?)
            .map_err(io::Error::other)?;
        let support: Vec<_> = ids.iter().map(|&c| cells[c].clone()).collect();
        let areas = kernel
            .intersection_areas(&g, &support)
            .map_err(io::Error::other)?;
        let mut residents = 0.;
        let mut developed = 0.;
        let mut service_load = 0.;
        for (cell, m2) in ids.into_iter().zip(areas) {
            let local_people = f.people().people(cell)?;
            residents += local_people * m2 / 1e6;
            developed += built.get(cell)? * m2 / 1e6;
            service_load += (urban.fields.access[cell] * local_people
                + 1600. * (claims[cell].work + urban.fields.civic[cell]))
                * m2
                / 1e6;
        }
        let area = kernel.area(&g).map_err(io::Error::other)?;
        if area <= 0. {
            continue;
        }
        let works = kernel
            .covers_points(&g, &works)
            .map_err(io::Error::other)?
            .into_iter()
            .filter(|yes| *yes)
            .count();
        precincts.push(super::partition::Precinct {
            anchor: None,
            program: cell_at(
                mesh,
                xy(kernel.interior_position(&g).map_err(io::Error::other)?),
            )
            .and_then(|c| urban.fields.program.get(c).copied()),
            shape: g.clone(),
            area,
            residents,
            built: developed,
            service_load,
            character: {
                let loc = kernel.interior_position(&g).map_err(io::Error::other)?;
                cell_at(mesh, xy(loc)).map_or(0., |c| {
                    claims[c].work - claims[c].crowd + 2. * urban.fields.civic[c]
                })
            },
            works,
        });
    }
    Ok(precincts)
}

fn divide_precincts(
    state: &State,
    urban: &Urban,
    domain: &Geometry,
    points: &[[f64; 2]],
    positions: &[Position],
) -> io::Result<Vec<Geometry>> {
    let kernel = state.spatial.as_ref();
    let ways = urban
        .routes
        .iter()
        .map(|r| r.geometry.clone())
        .collect::<Vec<_>>();
    let mesh = state.field().mesh();
    let inside = kernel
        .covers_points(domain, positions)
        .map_err(io::Error::other)?;
    let claims = &urban.fields.claims;
    let load: Vec<_> = inside
        .iter()
        .enumerate()
        .map(|(c, on)| {
            if *on {
                0.1 + claims[c].home + claims[c].work + urban.fields.civic[c]
            } else {
                0.
            }
        })
        .collect();
    let desired = urban.programs.len().max(1);
    let spacing = (kernel.area(domain).map_err(io::Error::other)? / (desired * 5) as f64).sqrt();
    let mut sites: Vec<_> = hot_spots(&load, points, spacing.max(mesh.spacing()), usize::MAX)
        .into_iter()
        .map(|c| positions[c])
        .collect();
    if sites.is_empty() {
        sites.push(kernel.interior_position(domain).map_err(io::Error::other)?);
    }
    let zones = if sites.len() == 1 {
        vec![domain.clone()]
    } else {
        kernel
            .voronoi_cells(&sites, kernel.bounds(domain).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .into_iter()
            .flatten()
            .collect()
    };
    let mut polygons = Vec::new();
    let mut barriers = ways;
    for f in super::values(state, "cityWall")?
        .into_iter()
        .chain(super::values(state, "river")?)
    {
        barriers.push(f.geometry);
    }
    for wall in crate::atlas::regional::city::wall_lines(state)? {
        barriers.push(geometry::line(&wall));
    }
    let divisions = faces(kernel, domain, &barriers)?;
    let divisions_index = kernel.index(&divisions).map_err(io::Error::other)?;
    for zone in zones {
        for j in divisions_index
            .query(kernel.bounds(&zone).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
        {
            if let Some(g) = kernel
                .overlay(&zone, &divisions[j], Overlay::Intersection)
                .map_err(io::Error::other)?
            {
                polygons.extend(parts(&g));
            }
        }
    }
    exclude_existing_districts(kernel, polygons, urban)
}

fn exclude_existing_districts(
    kernel: &dyn SpatialKernel,
    mut polygons: Vec<Geometry>,
    urban: &Urban,
) -> io::Result<Vec<Geometry>> {
    for f in urban.captured.iter().filter(|f| f.kind == "district") {
        let mut vacant = Vec::new();
        for face in polygons {
            if let Some(g) = kernel
                .overlay(&face, &f.geometry, Overlay::Difference)
                .map_err(io::Error::other)?
            {
                vacant.extend(parts(&g));
            }
        }
        polygons = vacant;
    }
    Ok(polygons)
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::super::partition::{partition, Precinct};
    use super::*;
    use atlas_map::{regions::rectangle, Bounds};

    #[test]
    fn an_outlying_founder_cannot_claim_a_distant_city_precinct_or_revive_on_an_island() {
        let k = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let seats = [[-5., 50.], [820., 50.]].map(pos);
        let mut blocks: Vec<_> = [(0., 0), (100., 1), (360., 1)]
            .map(|(x, program)| Precinct {
                shape: rectangle(Bounds(x, 0., x + 100., 100.)),
                area: 10_000.,
                residents: 100.,
                built: 0.009,
                service_load: 0.,
                works: 0,
                character: 0.,
                program: Some(program),
                anchor: None,
            })
            .into();
        assign_founders(&k, &seats, 50., &mut blocks).unwrap();
        assert_eq!(
            blocks.iter().map(|p| p.anchor).collect::<Vec<_>>(),
            [Some(0), None, None]
        );
        let districts = partition(&k, &blocks, &[], 1.).unwrap();
        assert_eq!(districts.len(), 1);
        assert_eq!(districts[0].precincts, [0, 1, 2]);
    }
}
