//! New private worlds use the same domain vocabulary on native and WASM hosts.
use crate::{
    generation_document::Document,
    numerical_resource::{FieldScope, Scope},
};
use atlas_generation::{
    atlas::configuration::{defaults, Settings},
    identity::semantic_id,
    publication::layers,
};
use atlas_map::{regions::rectangle, Bounds};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::io;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorld {
    pub id: String,
    pub name: String,
    pub seed: i32,
    pub width: f64,
    pub height: f64,
    pub settings: Option<Settings>,
    pub boundary_mode: Option<String>,
}
impl CreateWorld {
    pub fn create(self) -> io::Result<Document> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || self.width <= 0.0
            || self.height <= 0.0
        {
            return Err(io::Error::other(
                "World dimensions must be positive finite metres",
            ));
        }
        let name = self.name.trim();
        if name.is_empty() {
            return Err(io::Error::other("World needs a name"));
        }
        let root = semantic_id(&self.id, "area", "root")?;
        let boundary = self.boundary_mode.as_deref().unwrap_or("none");
        if !["none", "cylinder", "ocean"].contains(&boundary) {
            return Err(io::Error::other("Unknown world boundary"));
        }
        let footprint = rectangle(Bounds(0.0, 0.0, self.width, self.height));
        let reference = format!("world:{}", self.id);
        let layers = layers::builtin();
        let mut settings = self.settings.map_or_else(defaults::settings, Ok)?;
        settings.normalize()?;
        let world = json!({
            "id":self.id, "name":name, "seed":self.seed, "version":1, "owner":"creator",
            "reference":{"id":reference, "domain":footprint, "topology":"planar", "boundaryMode":boundary,
                "units":"metre", "axes":"east,north,up", "verticalDatum":"Sea level", "precision":0.000001, "version":1},
            "areas":{root.clone():{"id":root, "name":name, "parentId":null, "profile":"world", "footprint":footprint,
                "frame":{"origin":{"x":0,"y":0,"z":0},"rotation":0,"metresPerUnit":1,"floor":null},
                "spaceId":self.id, "version":1, "traits":[], "localTraits":[], "layers":{}, "boundary":null,
                "templateId":null,"templateInstanceId":null,"recipeJobId":null,"contextFeatureId":null,"context":"landscape"}},
            "layers":layers, "features":{}, "featureCount":0, "fields":[], "entities":{}, "templates":{},
            "magic":[], "landmarks":[], "magicSystems":settings.magic_systems, "confluences":settings.confluences,
            "epochs":settings.epochs, "humanEras":settings.human_eras, "views":[], "generations":[],
        });
        let revisions: Vec<_> = std::iter::once(("area", &root))
            .chain(layers.keys().map(|id| ("layer", id)))
            .map(|(kind, id)| json!({"kind":kind,"id":id,"revisionId":id,"version":1}))
            .collect();
        let identities: Map<_, _> = revisions
            .iter()
            .map(|r| (r["id"].as_str().unwrap().into(), r["kind"].clone()))
            .collect();
        Ok(Document {
            world,
            scope: FieldScope {
                located: Scope {
                    world_id: self.id.clone(),
                    area_id: root,
                    space_id: self.id,
                },
                footprint,
                crs_id: reference,
                resolution: None,
                revision: 1,
                time: "present".into(),
            },
            coverage: Vec::new(),
            field_patches: Vec::new(),
            metadata: Map::from_iter([
                ("resources".into(), json!([])),
                ("revisions".into(), json!(revisions)),
                ("identities".into(), Value::Object(identities)),
            ]),
        })
    }
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn generation_defaults() -> String {
    defaults::JSON.into()
}
