//! Capture a pinned map's context once. Children own records and immutable resource aliases.
mod context;
mod fields;
mod footprint;
mod map;
pub use map::capture;
mod records;
use crate::{generation_document::Document, generation_frame::Geography};
use atlas_generation::{
    features::{
        network::{Node, Reach},
        Feature,
    },
    identity::semantic_id,
    spatial::{Overlay, SpatialKernel},
};
use atlas_map::{regions::polygon, Geometry, MapDescriptor, RegionSelection};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

/// Completed local metadata only. Implementations never fetch resources across hosts.
pub trait Source {
    fn resource(&self, id: &str) -> io::Result<Value>;
    fn geography(&self, scope: &crate::numerical_resource::Scope, id: &str) -> io::Result<Value>;
}
pub struct Capture {
    pub document: Document,
    pub features: Vec<Feature>,
    pub nodes: Vec<Node>,
    pub reaches: Vec<Reach>,
    pub resources: Vec<Value>,
    pub geography: Vec<Value>,
}
impl Capture {
    pub async fn write_resources(
        &self,
        sink: &mut impl crate::numerical_output::Sink,
    ) -> io::Result<()> {
        write_resources(&self.resources, sink).await
    }
}
pub async fn write_resources(
    resources: &[Value],
    sink: &mut impl crate::numerical_output::Sink,
) -> io::Result<()> {
    let mut written = Vec::new();
    for resource in resources {
        let id = resource["id"]
            .as_str()
            .ok_or_else(|| io::Error::other("Captured resource has an identity"))?;
        let result = async {
            sink.create(id).await?;
            written.push(id);
            sink.write(
                id,
                "zarr.json",
                br#"{"zarr_format":3,"node_type":"group","attributes":{}}"#,
            )
            .await?;
            sink.write(id, "resource.json", &serde_json::to_vec(resource)?)
                .await
        }
        .await;
        if let Err(error) = result {
            for id in written {
                sink.remove(id).await?;
            }
            return Err(error);
        }
    }
    Ok(())
}
pub struct Selection<'a> {
    pub parent: &'a MapDescriptor,
    pub selection: &'a RegionSelection,
    pub id: &'a str,
    pub name: &'a str,
    pub operation: &'a str,
}
pub struct Region<'a> {
    world: &'a str,
    area: &'a str,
    parent: &'a str,
    operation: &'a str,
    footprint: Geometry,
    version: u64,
    spatial: &'a dyn SpatialKernel,
}
impl Region<'_> {
    fn id(&self, kind: &str, source: &str) -> io::Result<String> {
        semantic_id(self.world, &format!("map:{}:{kind}", self.area), source)
    }
    fn clip(&self, geometry: &Geometry) -> io::Result<Option<Geometry>> {
        self.spatial
            .overlay(geometry, &self.footprint, Overlay::Intersection)
            .map_err(io::Error::other)
    }
    fn polygon(&self, geometry: &Geometry) -> io::Result<Option<Geometry>> {
        Ok(self.clip(geometry)?.and_then(polygon))
    }
}
impl Selection<'_> {
    /// Features are composed records returned by a scoped GIS query for the pinned revision.
    pub fn capture(
        self,
        document: Document,
        features: Vec<Feature>,
        source: &impl Source,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Capture> {
        self.validate(&document)?;
        let geography: Geography = serde_json::from_value(document.world.clone())?;
        let parent = &self.parent.reference.map_id;
        let region = Region {
            world: &geography.id,
            area: self.id,
            parent,
            operation: self.operation,
            footprint: self.footprint(&document, spatial)?,
            version: geography.version,
            spatial,
        };
        let mut area = document.world["areas"][parent].clone();
        area["id"] = self.id.into();
        area["name"] = self.name.trim().into();
        area["parentId"] = parent.as_str().into();
        area["profile"] = "region".into();
        area["footprint"] = json!(region.footprint);
        area["version"] = 1.into();
        area["spaceId"] = self.selection.space_id.clone().into();
        area["localTraits"] = json!([]);
        // Independent mapped areas begin with their own local constraints.
        area["traits"] = json!([]);
        let origin = spatial
            .interior_position(&region.footprint)
            .map_err(io::Error::other)?;
        let [x, y, _] = origin.coordinates();
        area["frame"]["origin"]["x"] = json!(x);
        area["frame"]["origin"]["y"] = json!(y);
        area["layers"] = json!({});
        for key in [
            "boundary",
            "regionId",
            "templateId",
            "templateInstanceId",
            "recipeJobId",
            "contextFeatureId",
        ] {
            area[key] = Value::Null;
        }
        // owner-direction(2026-10-29): later parent changes leave children's captured inputs unchanged.
        area["map"] = json!({"sourceAreaId":parent,"sourceRevision":geography.version,
            "sourceMap":self.parent.reference,"refinementLevel":self.refinement_level(spatial)?,"extent":region.footprint});
        let owners = geography
            .context()
            .geography_areas(parent)
            .map_err(io::Error::other)?
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let mut result = Capture {
            document,
            features: Vec::new(),
            nodes: Vec::new(),
            reaches: Vec::new(),
            resources: Vec::new(),
            geography: Vec::new(),
        };
        let ids: BTreeMap<_, _> = features
            .iter()
            .map(|feature| Ok((feature.id.clone(), region.id("feature", &feature.id)?)))
            .collect::<io::Result<_>>()?;
        records::capture(&region, features, &ids, &mut result)?;
        context::capture(&region, &owners, &ids, &mut result)?;
        fields::capture(&region, &owners, source, &mut result)?;
        result.document.world["areas"][self.id] = area;
        result.document.scope.located.area_id = self.id.into();
        result.document.scope.located.space_id = self.selection.space_id.clone();
        result.document.scope.footprint = region.footprint;
        result.document.coverage.clear();
        for key in ["features", "networkNodes", "networkReaches"] {
            result.document.world[key] = json!({});
        }
        Ok(result)
    }
    fn validate(&self, source: &Document) -> io::Result<()> {
        if self.selection.parent != self.parent.reference
            || source.scope.located.area_id != self.parent.reference.map_id
            || source.scope.located.world_id != self.parent.world_id
            || self.selection.space_id != source.scope.located.space_id
            || self.id == self.parent.reference.map_id
            || self.name.trim().is_empty()
            || source.world["areas"].get(self.id).is_some()
        {
            return Err(io::Error::other(
                "Select a pinned parent map and a new named child in its located space",
            ));
        }
        Ok(())
    }
}
