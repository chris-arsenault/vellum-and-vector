//! Completed private generation metadata. Map readers never receive this document.
mod publication;
use crate::{
    generation_output::Completed, generation_request::PreparedRequest,
    numerical_resource::FieldScope,
};
use atlas_generation::{
    features::{
        context::Context,
        mapped,
        network::{NetworkReader, NetworkWorkspace},
        FeatureReader, FeatureWorkspace,
    },
    publication::{
        catalogue::Layer,
        channels::{Binding, Inputs},
        geographies,
    },
    spatial::SpatialKernel,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

pub const FORMAT: atlas_gis::stored::Format = atlas_gis::stored::Format {
    kind: "generation-inputs",
    revision: 1,
    semantics: "independent-map-metre-resources",
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub world: Value,
    pub scope: FieldScope,
    pub coverage: Vec<Value>,
    pub field_patches: Vec<Value>,
    /// Retain current non-numerical domain metadata, including deferred authoring records.
    #[serde(flatten)]
    pub metadata: Map<String, Value>,
}
pub struct Preparation {
    document: Document,
    context: Context,
    input: Value,
    layers: BTreeMap<String, Layer>,
    definitions: BTreeMap<String, Layer>,
    channels: Vec<Binding>,
    geography: Vec<geographies::Binding>,
    resolved: atlas_generation::atlas::configuration::Resolved,
    sources: Vec<atlas_generation::field::landmarks::magic::Source>,
    inherited: BTreeSet<String>,
}
#[derive(Serialize)]
pub struct Finished {
    #[serde(flatten)]
    pub output: Completed,
    pub snapshot: Document,
}
impl Preparation {
    pub fn new(mut document: Document, prepared: &PreparedRequest) -> io::Result<Self> {
        let request = &prepared.request;
        document.scope = prepared.geography.scope.clone();
        // The world document keys its areas by identity text.
        let area = document.scope.located.area_id.to_string();
        // A captured child keeps its outline; it generates over its wider extent.
        if document.world["areas"][&area]["map"]["extent"].is_null() {
            document.world["areas"][&area]["footprint"] = json!(document.scope.footprint);
        }
        document.world["reference"]["boundaryMode"] =
            json!(request.geography.reference.boundary_mode);
        if !prepared.geography.frame.has_parent && !request.geography.has_generated_geography() {
            for (key, value) in serde_json::to_value(&prepared.resolved.settings)?
                .as_object()
                .unwrap()
            {
                document.world[key] = value.clone();
            }
        }
        let inherited = request
            .geography
            .fields
            .iter()
            .flat_map(|f| f.channels.iter().flatten().cloned())
            .collect();
        let bindings = Inputs {
            selection: &prepared.resolved.selection,
            systems: &prepared.resolved.settings.magic_systems,
            confluences: &prepared.resolved.settings.confluences,
            sources: &request.magic_sources,
            inherited: &inherited,
        };
        let channels = bindings.bindings(&request.entities);
        let geography = geographies::bindings(
            &bindings,
            &request
                .geography
                .fields
                .iter()
                .map(|f| f.layer_id.clone())
                .collect::<Vec<_>>(),
        );
        let mut input = serde_json::to_value(&request.input)?;
        input["parameters"] = json!(prepared.resolved.parameters);
        input["settings"] = json!(prepared.resolved.settings);
        input["configuration"] = json!(prepared.configuration);
        let mut result = Self {
            document,
            context: request.geography.context(),
            input,
            layers: request.geography.layers.clone(),
            definitions: atlas_generation::publication::layers::publication(),
            channels,
            geography,
            resolved: prepared.resolved.clone(),
            sources: request.magic_sources.clone(),
            inherited,
        };
        let selected: BTreeSet<_> = result
            .channels
            .iter()
            .filter(|b| b.publish)
            .map(|b| b.layer)
            .chain(
                result
                    .geography
                    .iter()
                    .filter(|b| b.publish)
                    .map(|b| b.layer),
            )
            .collect();
        // Bindings for real-scale layers (plots, caves) belong to features a world also runs;
        // a map installs only the layers its profile carries.
        let area = result
            .context
            .area(result.document.scope.located.area_id)
            .map_err(io::Error::other)?;
        let profile = area.profile;
        if area.map.as_ref().is_some_and(|m| m.city.is_some()) {
            atlas_generation::publication::layers::city_plots(&mut result.definitions);
            atlas_generation::publication::layers::city_plots(&mut result.layers);
        }
        for id in selected {
            if result
                .definitions
                .get(id)
                .is_none_or(|layer| layer.profiles.contains(&profile))
            {
                result.install_layer(id)?;
            }
        }
        Ok(result)
    }
    pub fn finish(
        mut self,
        output: Completed,
        operation: &str,
        completed_at: &str,
        records: Records<'_>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Finished> {
        mapped::restore(&self.context, records.original, records.features, spatial)?;
        mapped::restore_networks(records.source_networks, records.original, records.networks)?;
        self.channels = (Inputs {
            selection: &self.resolved.selection,
            systems: &self.resolved.settings.magic_systems,
            confluences: &self.resolved.settings.confluences,
            sources: &self.sources,
            inherited: &self.inherited,
        })
        .bindings(&serde_json::from_value(output.entities.clone())?);
        self.publish(&output, operation, &records, spatial)?;
        let world = &mut self.document.world;
        let version = world["version"]
            .as_u64()
            .ok_or_else(|| io::Error::other("World revision is an integer"))?
            + 1;
        world["version"] = version.into();
        let area = self.document.scope.located.area_id.to_string();
        world["areas"][&area]["version"] = version.into();
        world["entities"] = output.entities.clone();
        for landmark in output
            .landmarks
            .as_array()
            .ok_or_else(|| io::Error::other("Completed landmarks are an array"))?
        {
            let landmarks = world["landmarks"]
                .as_array_mut()
                .ok_or_else(|| io::Error::other("World landmarks are an array"))?;
            if let Some(previous) = landmarks.iter_mut().find(|p| p["id"] == landmark["id"]) {
                *previous = landmark.clone();
            } else {
                landmarks.push(landmark.clone());
            }
        }
        if !output.drainage.is_null() {
            if world.get("drainage").is_none() {
                world["drainage"] = json!({});
            }
            world["drainage"][&area] = output.drainage.clone();
        } else if let Some(drainage) = world.get_mut("drainage").and_then(Value::as_object_mut) {
            drainage.remove(&area);
        }
        let run = json!({ "id": operation, "areaId": area, "domains": self.input["domains"],
            "quality": self.input["quality"], "seed": self.input["seed"], "parameters": self.input["parameters"],
            "completedAt": completed_at, "physicalEpochs": world["epochs"], "magicSystems": world["magicSystems"],
            "configuration": self.input["configuration"] });
        world["generations"]
            .as_array_mut()
            .ok_or_else(|| io::Error::other("Completed history is an array"))?
            .push(run);
        world["layers"] = json!(self.layers);
        for key in ["features", "networkNodes", "networkReaches"] {
            world[key] = json!({});
        }
        let history = self
            .document
            .metadata
            .entry("history")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| io::Error::other("Completed history is an array"))?;
        history.extend(output.history.iter().map(|entry| json!(entry)));
        if !output.causes.is_empty() {
            history.push(json!({"path":["present"], "ancestry":[], "causes":output.causes}));
        }
        Ok(Finished {
            output,
            snapshot: self.document,
        })
    }
    fn install_layer(&mut self, id: &str) -> io::Result<()> {
        let definition = self
            .definitions
            .get(id)
            .ok_or_else(|| io::Error::other(format!("Declare layer {id}")))?;
        let profile = self
            .context
            .area(self.document.scope.located.area_id)
            .map_err(io::Error::other)?
            .profile;
        if !definition.profiles.contains(&profile) {
            return Err(io::Error::other(format!(
                "Layer {id} does not support map profile {profile:?}"
            )));
        }
        if let Some(previous) = self.layers.get_mut(id) {
            if !previous.profiles.contains(&profile)
                || previous.family != definition.family
                || previous.generator != definition.generator
                || previous.schema != definition.schema
            {
                return Err(io::Error::other(format!("Layer {id} must retain its registered profile, family, generator and attribute schema")));
            }
            union(
                &mut previous.facts,
                definition.facts.as_deref().unwrap_or_default(),
            );
            let prior = previous.representation.clone();
            previous.representations.get_or_insert_with(|| vec![prior]);
            union(
                &mut previous.representations,
                definition.representations.as_deref().unwrap_or_default(),
            );
        } else {
            self.layers.insert(id.into(), definition.clone());
        }
        Ok(())
    }
}
pub struct Records<'a> {
    pub features: &'a mut dyn FeatureWorkspace,
    pub original: &'a dyn FeatureReader,
    pub networks: &'a mut dyn NetworkWorkspace,
    pub source_networks: &'a dyn NetworkReader,
}
fn union(values: &mut Option<Vec<String>>, added: &[String]) {
    let values = values.get_or_insert_with(Vec::new);
    for value in added {
        if !values.contains(value) {
            values.push(value.clone());
        }
    }
}
