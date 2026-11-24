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
}

// owner-direction(2026-11-23): cities should have 7-14 districts
pub(super) const DISTRICT_COUNT: std::ops::RangeInclusive<usize> = 7..=14;

pub(super) fn target(residents: f64) -> usize {
    // A larger settled population supports more district centres.
    let scale = residents / (residents + 100_000.);
    DISTRICT_COUNT.start()
        + (scale * (DISTRICT_COUNT.end() - DISTRICT_COUNT.start()) as f64).round() as usize
}

pub(super) struct District {
    pub precincts: Vec<usize>,
    pub neighbors: Vec<usize>,
}

/// A shared street can become an internal street of a district. A long shared edge
/// is an easier join than a narrow neck; a through approach is a stronger boundary.
pub(super) fn partition(
    kernel: &dyn SpatialKernel,
    precincts: &[Precinct],
    approaches: &[Geometry],
    count: usize,
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
    let mut members: Vec<Vec<usize>> = (0..shapes.len()).map(|i| vec![i]).collect();
    let mut areas: Vec<_> = precincts.iter().map(|p| p.area).collect();
    // Area counts open urban land; residents, constructed ground and civic seats
    // give a busy precinct more weight than the same area at the fringe.
    let mut weights: Vec<_> = precincts
        .iter()
        .map(|p| p.area / 1000. + p.residents + p.built * 3500. + p.service_load)
        .collect();
    let mut works: Vec<_> = precincts.iter().map(|p| p.works).collect();
    for _ in count.max(1)..members.len() {
        let Some(i) = (0..members.len())
            .filter(|&i| !edges[i].is_empty())
            .min_by(|&a, &b| weights[a].total_cmp(&weights[b]))
        else {
            break;
        };
        let score = |j: usize| {
            let two_centres = works[i] > 0 && works[j] > 0;
            edges[i][&j]
                / (areas[i] + areas[j]).sqrt()
                / (weights[i] + weights[j]).sqrt()
                / if two_centres { 3. } else { 1. }
        };
        let j = *edges[i]
            .keys()
            .max_by(|&&a, &&b| score(a).total_cmp(&score(b)))
            .unwrap();
        edges[j].remove(&i);
        for (k, contact) in std::mem::take(&mut edges[i]) {
            if k != j {
                edges[k].remove(&i);
                *edges[k].entry(j).or_default() += contact;
                *edges[j].entry(k).or_default() += contact;
            }
        }
        let absorbed = std::mem::take(&mut members[i]);
        members[j].extend(absorbed);
        areas[j] += areas[i];
        weights[j] += weights[i];
        works[j] += works[i];
    }
    let roots: Vec<_> = (0..members.len())
        .filter(|&i| !members[i].is_empty())
        .collect();
    Ok(roots
        .iter()
        .map(|&i| District {
            precincts: std::mem::take(&mut members[i]),
            neighbors: edges[i]
                .keys()
                .map(|j| roots.binary_search(j).unwrap())
                .collect(),
        })
        .collect())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use atlas_gis::geometry::NativeGeos;
    use atlas_map::{regions::rectangle, Bounds};
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
                }
            })
            .collect();
        let groups = partition(&kernel, &precincts, &[], target(30_000.)).unwrap();
        assert!(DISTRICT_COUNT.contains(&groups.len()));
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
}
