use super::{descriptors::descriptor, Naming, Request};
use crate::{
    atlas::state::{InhabitedName, Naming as MapNaming, Scope},
    features::{
        publication::Named,
        records::{Attributes, Entity},
        Feature,
    },
    field::{
        landmarks::catalogue::Landmark,
        people::{place_land::PlaceLand, places::Place, traditions},
    },
};
use atlas_map::Geometry;
use atlas_names::random::Random;
use serde_json::{json, Value};
use std::io;

impl Naming {
    fn geographic_name(
        &self,
        feature: (&str, &str, &Geometry, &Attributes),
        language: Option<&str>,
        era: Option<&str>,
    ) -> io::Result<Option<Named>> {
        let (key, kind, geometry, attributes) = feature;
        let Some(descriptor) = descriptor(kind, attributes) else {
            return Ok(None);
        };
        let atlas_map::Bounds(w, s, e, n) =
            self.spatial.bounds(geometry).map_err(io::Error::other)?;
        self.name(Request {
            key,
            kind: descriptor.kind,
            subkind: descriptor.subkind,
            term: descriptor.term,
            position: [(w + e) / 2.0, (s + n) / 2.0],
            language,
            era,
        })
        .map(Some)
    }
}
impl MapNaming for Naming {
    fn inhabited_feature(
        &self,
        _: &Scope,
        feature: &Feature,
        speakers: &[(String, f64)],
        era: &str,
    ) -> io::Result<Option<InhabitedName>> {
        let mut spoken: Vec<_> = speakers
            .iter()
            .filter(|(_, people)| *people > 0.0)
            .collect();
        spoken.sort_by(|a, b| a.0.cmp(&b.0));
        let seed = json!([self.config.seed, "naming-language", feature.id]).to_string();
        let weights: Vec<_> = spoken.iter().map(|(_, people)| *people).collect();
        let language = Random::new(&seed)
            .weighted(&weights)
            .map(|index| spoken[index].0.clone());
        Ok(self
            .geographic_name(
                (
                    &feature.id.to_string(),
                    &feature.kind,
                    &feature.geometry,
                    &feature.attributes,
                ),
                language.as_deref(),
                Some(era),
            )?
            .map(|named| InhabitedName { named, language }))
    }
    fn magic_landmark(
        &self,
        _: &Scope,
        landmark: &Landmark,
        term: &str,
        position: [f64; 2],
    ) -> io::Result<Option<Named>> {
        self.name(Request {
            key: &landmark.id.to_string(),
            kind: "magic",
            subkind: Some(landmark.kind.id()),
            term: Some(term),
            position,
            language: None,
            era: None,
        })
        .map(Some)
    }
    fn geographic(
        &self,
        _: &Scope,
        key: &str,
        kind: &str,
        geometry: &Geometry,
        attributes: &Attributes,
    ) -> io::Result<Option<Named>> {
        self.geographic_name((key, kind, geometry, attributes), None, None)
    }
    fn feature(&self, scope: &Scope, feature: &Feature) -> io::Result<Option<Named>> {
        self.geographic(
            scope,
            &feature.id.to_string(),
            &feature.kind,
            &feature.geometry,
            &feature.attributes,
        )
    }
    fn work(
        &self,
        _: &Scope,
        key: &str,
        work: &str,
        position: [f64; 2],
        culture: Option<&str>,
    ) -> io::Result<Named> {
        self.name(Request {
            key,
            kind: "societyWork",
            subkind: Some(work),
            term: Some(work),
            position,
            language: culture,
            era: None,
        })
    }
    fn community(
        &self,
        _: &Scope,
        place: &Place,
        land: &PlaceLand,
        language: Option<&str>,
    ) -> io::Result<Named> {
        self.name(Request {
            key: &place.id,
            kind: "settlement",
            subkind: None,
            term: None,
            position: [land.x, land.y],
            language,
            era: Some(&place.founded),
        })
    }
}
impl traditions::Naming for Naming {
    fn name(
        &self,
        id: &str,
        founding: &traditions::Founding,
        language: Option<&str>,
    ) -> io::Result<Named> {
        let allegiance = founding.kind == traditions::Kind::Allegiance;
        self.name(Request {
            key: id,
            kind: if allegiance { "polity" } else { "culture" },
            subkind: allegiance.then_some("commonwealth"),
            term: allegiance.then_some("Commonwealth"),
            position: [founding.origin.x, founding.origin.y],
            language,
            era: Some(&founding.era),
        })
    }
    fn culture(&self, position: traditions::Position) -> io::Result<Value> {
        Ok(self
            .culture_at([position.x, position.y], None)?
            .id
            .clone()
            .into())
    }
    fn remember(&self, entity: &Entity) -> io::Result<()> {
        self.entities.borrow_mut().insert(entity.id, entity.clone());
        Ok(())
    }
}
