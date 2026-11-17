//! The unsaved "Coastal reach" child that a supplied Refine reply opens in browser scenarios.
//! It is captured from the published parent exactly as Refine captures it; nothing generates.
use crate::{publish_map, Published, Stores};
use atlas_generation::features::{network::NetworkWorkspace, FeatureWorkspace};
use atlas_host::{
    local_inputs::LocalInputs,
    native_resources::NativeResources,
    numerical_resource::Scope,
    record_store::{Features, Workspace},
    regional_capture::{self, Source},
};
use atlas_map::{MapRef, MapRegion, Position, RegionGeometry, RegionSelection};
use serde_json::Value;
use std::{io, path::Path};

const CHILD: &str = "5b1f0c2e-8f3a-4d6b-9c71-2a4e6d8f0b13";

pub async fn capture(
    root: &Path,
    stores: &mut Stores,
    parent: &MapRef,
    records: &Features,
) -> io::Result<MapRef> {
    let map = stores.maps.open(parent)?;
    let ring = [
        [30.0, 30.0],
        [70.0, 30.0],
        [70.0, 70.0],
        [30.0, 70.0],
        [30.0, 30.0],
    ];
    let geometry = RegionGeometry::Polygon(vec![ring
        .iter()
        .map(|[x, y]| Position::xy(*x, *y))
        .collect()]);
    let region = MapRegion {
        id: "coastal-reach".into(),
        name: "Coastal reach".into(),
        space_id: map.primary_space_id.clone(),
        parent_id: None,
        geometry: geometry.clone(),
        child: None,
    };
    let selection = RegionSelection {
        parent: parent.clone(),
        space_id: map.primary_space_id.clone(),
        geometry,
        feature_ids: Vec::new(),
        region_path: vec![region],
    };
    let mut resources = NativeResources::new(root.join("generation"));
    let captured = regional_capture::capture(
        regional_capture::Selection {
            parent: &map,
            selection: &selection,
            id: CHILD,
            name: "Coastal reach",
            operation: "captured",
            real_scale: None,
        },
        stores.inputs.document(parent)?,
        &Inputs {
            resources: &resources,
            inputs: &stores.inputs,
        },
        stores.maps.access(),
        records,
        &stores.spatial,
    )?;
    captured.write_resources(&mut resources).await?;
    let destination = Workspace::create(root.join("child-records.sqlite"))?;
    for feature in captured.features {
        destination.source_features().put(feature)?;
    }
    for node in captured.nodes {
        destination.source_networks().put_node(node)?;
    }
    for reach in captured.reaches {
        destination.source_networks().put_reach(reach)?;
    }
    let reference = MapRef {
        map_id: CHILD.into(),
        revision: "captured".into(),
    };
    let child = Published {
        document: captured.document,
        reference: reference.clone(),
        features: destination.source_features(),
        networks: destination.source_networks(),
        geography: captured.geography,
        parent: Some(parent.clone()),
    };
    publish_map(root, stores, child).await?;
    Ok(reference)
}
struct Inputs<'a> {
    resources: &'a NativeResources,
    inputs: &'a LocalInputs,
}
impl Source for Inputs<'_> {
    fn resource(&self, id: &str) -> io::Result<Value> {
        Ok(serde_json::from_slice(&std::fs::read(
            self.resources.directory(id)?.join("resource.json"),
        )?)?)
    }
    fn geography(&self, scope: &Scope, id: &str) -> io::Result<Value> {
        self.inputs.geography(scope, id)
    }
}
