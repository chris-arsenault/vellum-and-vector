//! Run-local atlas naming. Vocabulary and selection stay inside the shared Rust core.
mod descriptors;
mod services;
use crate::{
    features::{publication::Named, records::Entity},
    spatial::SpatialKernel,
};
use atlas_map::{Bounds, Geometry, Position};
use atlas_names::{random::Random, Culture, Names};
use serde::{Deserialize, Serialize};
use serde_json::json;
// hpc-exempt: named entity identities and provenance, never numerical field storage.
use std::{cell::RefCell, collections::BTreeMap, io, rc::Rc};

pub const VERSION: &str = "atlas-nameforge-2";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub seed: String,
    pub domain: Bounds,
}
pub struct Naming {
    // owner-direction(2026-11-14): naming belongs in Rust; TypeScript is UI, view code and facade
    config: Configuration,
    origins: Vec<Geometry>,
    // hpc-exempt: language entity attributes used to select a naming vocabulary.
    entities: RefCell<BTreeMap<String, Entity>>,
    spatial: Rc<dyn SpatialKernel>,
}
struct Request<'a> {
    key: &'a str,
    kind: &'a str,
    subkind: Option<&'a str>,
    term: Option<&'a str>,
    position: [f64; 2],
    language: Option<&'a str>,
    era: Option<&'a str>,
}
impl Naming {
    pub fn new(
        config: Configuration,
        entities: BTreeMap<String, Entity>,
        spatial: Rc<dyn SpatialKernel>,
    ) -> Self {
        let mut random = Random::new(&format!(
            "atlas-nameforge-1:{}:culture-origins",
            config.seed
        ));
        let Bounds(w, s, e, n) = config.domain;
        let origins = Names::atlas()
            .cultures
            .iter()
            .map(|_| Geometry::Point {
                coordinates: Position::xy(
                    w + random.sample() * (e - w),
                    s + random.sample() * (n - s),
                ),
            })
            .collect();
        Self {
            config,
            origins,
            entities: RefCell::new(entities),
            spatial,
        }
    }
    fn culture_at(
        &self,
        position: [f64; 2],
        language: Option<&str>,
    ) -> io::Result<&'static Culture> {
        let names = Names::atlas();
        let entities = self.entities.borrow();
        let configured = language
            .and_then(|id| entities.get(id))
            .and_then(|entity| entity.attributes.get("namingCulture"))
            .and_then(|value| value.as_str())
            .or(language);
        if let Some(culture) = names
            .cultures
            .iter()
            .find(|c| Some(c.id.as_str()) == configured)
        {
            return Ok(culture);
        }
        let nearest = self
            .spatial
            .index(&self.origins)
            .map_err(io::Error::other)?
            .nearest(Position::xy(position[0], position[1]))
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Atlas naming cultures need origins"))?;
        Ok(&names.cultures[nearest])
    }
    fn name(&self, request: Request<'_>) -> io::Result<Named> {
        let culture = self.culture_at(request.position, request.language)?;
        let seed = json!([
            VERSION,
            self.config.seed,
            request.key,
            request.kind,
            request.subkind,
            culture.id,
            request.language
        ])
        .to_string();
        let name = Names::atlas().generate(
            culture,
            atlas_names::Request {
                seed: &seed,
                kind: request.kind,
                subkind: request.subkind,
                term: request.term.or(request.subkind).unwrap_or(request.kind),
            },
        )?;
        Ok(Named {
            name,
            metadata: serde_json::from_value(json!({
                "namingCulture":culture.id, "namingKind":request.kind,
                "namingSubkind":request.subkind, "namingVersion":VERSION,
                "namingLanguage":request.language, "namedInEra":request.era,
            }))?,
        })
    }
}
