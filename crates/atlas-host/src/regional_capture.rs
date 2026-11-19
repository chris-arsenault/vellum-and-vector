//! Capture a pinned map's context once. Children own records and immutable resource aliases.
mod context;
mod fields;
mod footprint;
mod map;
pub use map::capture;
mod records;
use crate::{generation_document::Document, generation_frame::Geography};
use atlas_generation::{
    atlas::resolution::Quality,
    features::{
        context::RealScaleMap,
        network::{Node, Reach},
        Feature,
    },
    identity::semantic_id,
    spatial::{Overlay, SpatialKernel},
    RealScaleChoice,
};
use atlas_map::{regions::polygon, Geometry, Id, MapDescriptor, RegionSelection};
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
/// A child map a job will capture: its selection, name and, for real-scale maps, the choices.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Child {
    pub selection: RegionSelection,
    pub name: String,
    pub real_scale: Option<RealScaleChoice>,
}
impl Child {
    /// The captured real-scale record, laid at this job's detail.
    pub fn real_scale(&self, quality: Quality) -> Option<RealScaleMap> {
        self.real_scale.map(|choice| RealScaleMap {
            kind: choice.kind,
            hex_size: choice.hex_size,
            hexes_across: choice.hexes_across,
            triangles_per_edge: quality.triangles_per_hex_edge(),
        })
    }
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_parent — selection on a pinned parent map revision.
pub struct Selection<'a> {
    pub parent: &'a MapDescriptor,
    pub selection: &'a RegionSelection,
    pub id: Id,
    pub name: &'a str,
    pub operation: Id,
    pub real_scale: Option<RealScaleMap>,
}
pub struct Region<'a> {
    world: Id,
    area: Id,
    parent: Id,
    operation: Id,
    footprint: Geometry,
    version: u64,
    spatial: &'a dyn SpatialKernel,
}
impl Region<'_> {
    /// A captured record's identity on the child: the child area and the record's kind and
    /// parent identity, each fixed-width.
    fn id(&self, kind: &str, source: Id) -> Id {
        self.keyed(kind, &source.to_bytes())
    }
    /// A record the capture makes from a text key, such as a network node at a point.
    fn keyed(&self, kind: &str, key: &[u8]) -> Id {
        let mut name = self.area.to_bytes().to_vec();
        name.extend_from_slice(kind.as_bytes());
        name.push(0);
        name.extend_from_slice(key);
        Id::v5(self.world, &name)
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
    // Arconis: docs/architecture/subsystems.arconis#item=rg_capture — captures the region once, refusing the parent's id.
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
        let parent = self.parent.reference.map_id;
        let region = Region {
            world: geography.id,
            area: self.id,
            parent,
            operation: self.operation,
            footprint: self.footprint(&document, spatial)?,
            version: geography.version,
            spatial,
        };
        // The world document keys its areas by identity text.
        let mut area = document.world["areas"][&parent.to_string()].clone();
        area["id"] = self.id.into();
        area["name"] = self.name.trim().into();
        area["parentId"] = parent.into();
        area["profile"] = match self.real_scale.map(|real| real.kind) {
            None => "region",
            Some(atlas_map::RealScaleKind::Ground) => "local",
            Some(atlas_map::RealScaleKind::Structure) => "interior",
        }
        .into();
        area["footprint"] = json!(region.footprint);
        area["version"] = 1.into();
        area["spaceId"] = self.selection.space_id.into();
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
        if let Some(real) = &self.real_scale {
            area["map"]["realScale"] = serde_json::to_value(real)?;
        }
        let owners = geography
            .context()
            .geography_areas(parent)
            .map_err(io::Error::other)?;
        let mut result = Capture {
            document,
            features: Vec::new(),
            nodes: Vec::new(),
            reaches: Vec::new(),
            resources: Vec::new(),
            geography: Vec::new(),
        };
        let ids: BTreeMap<Id, Id> = features
            .iter()
            .map(|feature| (feature.id, region.id("feature", feature.id)))
            .collect();
        records::capture(&region, features, &ids, &mut result)
            .map_err(|error| io::Error::other(format!("Capturing records: {error}")))?;
        context::capture(&region, &owners, &ids, &mut result)
            .map_err(|error| io::Error::other(format!("Capturing context: {error}")))?;
        fields::capture(&region, &owners, source, &mut result)
            .map_err(|error| io::Error::other(format!("Capturing fields: {error}")))?;
        result.document.world["areas"][&self.id.to_string()] = area;
        result.document.scope.located.area_id = self.id;
        result.document.scope.located.space_id = self.selection.space_id;
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
            || source.world["areas"].get(self.id.to_string()).is_some()
        {
            return Err(io::Error::other(
                "Select a pinned parent map and a new named child in its located space",
            ));
        }
        // A building's floors hold only its shell, made from the building's record by the
        // map store (`structure_maps`); there is no land to generate for them.
        if self.real_scale.map(|real| real.kind) == Some(atlas_map::RealScaleKind::Structure) {
            return Err(io::Error::other(
                "Building floors open from a building: select it on a real-scale ground map and choose Open floors",
            ));
        }
        Ok(())
    }
}
