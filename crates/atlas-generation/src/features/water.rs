use super::{
    network::{NetworkWorkspace, Selection},
    Feature, FeatureReader, FeatureSelection, FeatureWorkspace, State,
};
use crate::lattice::TriangularLattice;
use atlas_map::Geometry;
use std::{collections::BTreeSet, io};

pub fn drawn_dams(
    features: &dyn FeatureReader,
    mesh: &TriangularLattice,
    area: &str,
) -> io::Result<Vec<usize>> {
    let mut cells = Vec::new();
    for feature in features.values(FeatureSelection {
        area_id: Some(area),
        kind: Some("dam"),
        ..Default::default()
    })? {
        let feature = feature?;
        if feature.state != State::Authored {
            continue;
        }
        if let Geometry::Point { coordinates } = feature.geometry {
            let origin = mesh.origin();
            let [x, y, _] = coordinates.coordinates();
            if let Some(cell) = mesh.cell_at(x - origin[0], y - origin[1]) {
                cells.push(cell);
            }
        }
    }
    Ok(cells)
}
fn generated(feature: &Feature) -> bool {
    ["rivers", "lakes"].contains(&feature.layer_id.as_str())
        && feature.kind != "landmark"
        && feature.state == State::Generated
        && !feature.protected
        && !(feature.place_id.as_ref().is_some_and(|id| !id.is_empty())
            && matches!(feature.geometry, Geometry::Point { .. }))
        && feature.detail.is_empty()
}
/// Keep every water record referenced by another feature or a captured map crossing.
pub fn drop_products(
    features: &mut dyn FeatureWorkspace,
    networks: &mut dyn NetworkWorkspace,
    area: &str,
    crossings: &BTreeSet<String>,
) -> io::Result<()> {
    let mut referenced = BTreeSet::new();
    for feature in features.values(FeatureSelection::default())? {
        for relation in feature?.relations {
            referenced.insert(relation.target_id);
        }
    }
    let dropped = features
        .values(FeatureSelection {
            area_id: Some(area),
            ..Default::default()
        })?
        .filter_map(|f| match f {
            Ok(f) if generated(&f) && !crossings.contains(&f.id) && !referenced.contains(&f.id) => {
                Some(Ok(f.id))
            }
            Err(e) => Some(Err(e)),
            _ => None,
        })
        .collect::<io::Result<Vec<_>>>()?;
    for id in dropped {
        features.remove(&id)?;
        let reaches = networks
            .reaches(Selection {
                feature_id: Some(&id),
                ..Default::default()
            })?
            .map(|r| r.map(|r| r.id))
            .collect::<io::Result<Vec<_>>>()?;
        for reach in reaches {
            networks.remove_reach(&reach)?;
        }
    }
    Ok(())
}
