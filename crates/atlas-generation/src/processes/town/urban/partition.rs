//! Join road-bounded precincts into city districts over shared, traversable edges.
use crate::spatial::{Overlay, SpatialKernel};
use atlas_map::Geometry;
// hpc-exempt: shared borders form a sparse graph between GIS precincts.
use std::{collections::BTreeMap, io};

pub(super) struct Precinct {
    pub shape: Geometry,
    pub area: f64,
    pub residents: f64,
    pub built: f64,
    pub service_load: f64,
    pub works: usize,
    pub character: f64,
    pub program: Option<usize>,
    pub anchor: Option<usize>,
}

pub(super) struct District {
    pub precincts: Vec<usize>,
    pub neighbors: Vec<usize>,
    pub program: Option<usize>,
}

pub(super) const CATCHMENT_BOUNDARY: crate::parameters::NumericParameter =
    crate::parameters::NumericParameter {
        name: "foundingCatchmentBoundaryWeight",
        unit: "weight",
        default: 1.,
        minimum: Some(0.),
        maximum: None,
        strategy: Some("district-partition"),
        map_types: &[crate::processes::strategies::MapType::City],
    };

/// A shared street can become an internal street of a district. A long shared edge
/// is an easier join than a narrow neck; a through approach is a stronger boundary.
pub(super) fn partition(
    kernel: &dyn SpatialKernel,
    precincts: &[Precinct],
    approaches: &[Geometry],
    boundary_weight: f64,
) -> io::Result<Vec<District>> {
    let shapes: Vec<_> = precincts.iter().map(|p| p.shape.clone()).collect();
    let index = kernel.index(&shapes).map_err(io::Error::other)?;
    let approach_index = kernel.index(approaches).map_err(io::Error::other)?;
    // hpc-exempt: only edge-sharing polygon neighbors have a contact length.
    let mut edges = vec![BTreeMap::<usize, f64>::new(); shapes.len()];
    for (i, shape) in shapes.iter().enumerate() {
        let bounds = kernel.bounds(shape).map_err(io::Error::other)?;
        for j in index
            .query(bounds)
            .map_err(io::Error::other)?
            .into_iter()
            .filter(|&j| j > i)
        {
            let Some(edge) = kernel
                .overlay(shape, &shapes[j], Overlay::Intersection)
                .map_err(io::Error::other)?
            else {
                continue;
            };
            // Two precincts can share a border and also touch at an isolated corner.
            // Only the linear contact can carry a through road or join the precincts.
            let coordinates = atlas_map::regions::boundary_lines(&edge);
            if coordinates.is_empty() {
                continue;
            }
            let edge = Geometry::MultiLineString { coordinates };
            let length = kernel.length(&edge).map_err(io::Error::other)?;
            if length <= 0. {
                continue;
            }
            let mut main: f64 = 0.;
            for road in approach_index
                .query(kernel.bounds(&edge).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
            {
                if let Some(shared) = kernel
                    .overlay(&edge, &approaches[road], Overlay::Intersection)
                    .map_err(io::Error::other)?
                {
                    main += kernel.length(&shared).map_err(io::Error::other)?;
                }
            }
            let contact = length - 0.85 * main.min(length);
            edges[i].insert(j, contact);
            edges[j].insert(i, contact);
        }
    }
    // Grow from established centres along the precinct graph. Merging unclaimed
    // ground first can give a whole neighborhood to the last centre it touches.
    let mut seeds: Vec<_> = (0..precincts.len())
        .filter(|&i| precincts[i].anchor.is_some())
        .collect();
    let mut seen = vec![false; precincts.len()];
    for start in 0..precincts.len() {
        if seen[start] {
            continue;
        }
        let mut stack = vec![start];
        seen[start] = true;
        let mut anchored = false;
        let mut strongest = start;
        while let Some(i) = stack.pop() {
            anchored |= precincts[i].anchor.is_some();
            if precincts[i].residents > precincts[strongest].residents {
                strongest = i;
            }
            for &j in edges[i].keys() {
                if !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        if !anchored {
            seeds.push(strongest);
        }
    }
    let centres = shapes
        .iter()
        .map(|shape| kernel.interior_position(shape))
        .collect::<Result<Vec<_>, _>>()
        .map_err(io::Error::other)?;
    let loads: Vec<_> = precincts
        .iter()
        .map(|p| ((p.residents + p.built * 3500. + p.service_load) / (p.area / 1e6)).ln_1p())
        .collect();
    let labels = crate::town::city::districts(
        &seeds,
        precincts.len(),
        |i, j| {
            let (a, b) = (&precincts[i], &precincts[j]);
            let distance = crate::town::geometry::distance(
                super::geometry::xy(centres[i]),
                super::geometry::xy(centres[j]),
            );
            let span = a.area.min(b.area).sqrt();
            let narrow = span / (span + edges[i][&j]);
            let boundary = f64::from(a.program != b.program);
            let civic = f64::from(a.works > 0 && b.works > 0);
            distance.max(span * 0.1)
                * (0.5 + narrow * narrow * 3.)
                * (1.
                    + boundary * boundary_weight
                    + civic * 0.3
                    + (a.character - b.character).abs() * 0.25)
                * (1. + (loads[i] + loads[j]) * 0.04)
        },
        |i| edges[i].keys().copied().map(Some),
    );
    let mut groups: Vec<District> = Vec::new();
    let mut seed_group = Vec::new();
    for i in seeds {
        let program = precincts[i].anchor.or(precincts[i].program);
        let id = program
            .and_then(|p| groups.iter().position(|g| g.program == Some(p)))
            .unwrap_or_else(|| {
                groups.push(District {
                    precincts: Vec::new(),
                    neighbors: Vec::new(),
                    program,
                });
                groups.len() - 1
            });
        seed_group.push(id);
    }
    for (i, &label) in labels.iter().enumerate() {
        let group = seed_group[label];
        groups[group].precincts.push(i);
        for &j in edges[i].keys() {
            let neighbor = seed_group[labels[j]];
            if neighbor != group && !groups[group].neighbors.contains(&neighbor) {
                groups[group].neighbors.push(neighbor);
            }
        }
    }
    Ok(groups)
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use atlas_gis::geometry::NativeGeos;
    use atlas_map::{regions::rectangle, Bounds};
    #[test]
    fn shared_border_and_separate_point_contact_can_carry_a_road() {
        use super::super::geometry::{line, ring};
        let kernel = NativeGeos::new(1e-6).unwrap();
        let shapes = [
            rectangle(Bounds(0., 0., 4., 4.)),
            ring(&[
                [4., 0.],
                [7., 0.],
                [7., 4.],
                [5., 4.],
                [4., 3.],
                [5., 2.],
                [4., 1.],
            ]),
        ];
        let precincts = shapes
            .into_iter()
            .map(|shape| Precinct {
                area: kernel.area(&shape).unwrap(),
                shape,
                residents: 0.,
                built: 0.,
                service_load: 0.,
                works: 0,
                character: 0.,
                program: None,
                anchor: None,
            })
            .collect::<Vec<_>>();
        let road = line(&[[4., -1.], [4., 4.]]);
        let groups = partition(&kernel, &precincts, &[road], CATCHMENT_BOUNDARY.default).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].precincts.len(), 2);
    }
    #[test]
    fn internal_streets_remain_inside_city_scale_districts() {
        let kernel = NativeGeos::new(1e-6).unwrap();
        let precincts: Vec<_> = (0..100)
            .map(|i| {
                let (x, y) = ((i % 10) as f64 * 100., (i / 10) as f64 * 100.);
                Precinct {
                    shape: rectangle(Bounds(x, y, x + 100., y + 100.)),
                    area: 10_000.,
                    residents: 300.,
                    built: 0.004,
                    service_load: 0.,
                    works: 0,
                    character: 0.,
                    program: None,
                    anchor: (i % 25 == 0).then_some(i / 25),
                }
            })
            .collect();
        let groups = partition(&kernel, &precincts, &[], CATCHMENT_BOUNDARY.default).unwrap();
        assert_eq!(groups.len(), 4);
        assert_eq!(
            groups.iter().map(|g| g.precincts.len()).sum::<usize>(),
            precincts.len()
        );
        for group in groups {
            assert!(group.precincts.len() > 1 && !group.neighbors.is_empty());
            let shapes: Vec<_> = group
                .precincts
                .iter()
                .map(|&i| precincts[i].shape.clone())
                .collect();
            assert!(matches!(
                kernel.union_all(&shapes).unwrap(),
                Some(Geometry::Polygon { .. })
            ));
        }
    }

    #[test]
    fn a_severed_precinct_stays_with_its_founding_catchment() {
        let kernel = NativeGeos::new(1e-6).unwrap();
        let precincts: Vec<_> = [0, 1, 2, 3, 6]
            .into_iter()
            .map(|x| Precinct {
                shape: rectangle(Bounds(x as f64, 0., x as f64 + 1., 1.)),
                area: 1.,
                residents: 12.,
                built: 0.,
                service_load: 0.,
                works: 0,
                character: 0.,
                program: Some(usize::from(x >= 2)),
                anchor: match x {
                    0 => Some(0),
                    3 => Some(1),
                    _ => None,
                },
            })
            .collect();
        let groups = partition(&kernel, &precincts, &[], CATCHMENT_BOUNDARY.default).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].precincts, [0, 1]);
        assert_eq!(groups[1].precincts, [2, 3, 4]);
        assert_eq!(groups[0].neighbors, [1]);
        assert_eq!(groups[1].neighbors, [0]);
    }
}
