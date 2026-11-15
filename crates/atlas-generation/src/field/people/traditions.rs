use crate::{
    features::{publication::Named, records::Entity, Relation, State},
    human::identity::Tradition as Field,
    identity::semantic_id,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
// hpc-exempt: world entities and naming metadata, never terrain-cell storage.
use std::{collections::BTreeMap, io};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Tongue,
    Faith,
    Custom,
    Allegiance,
}
impl Kind {
    pub const ALL: [Self; 4] = [Self::Tongue, Self::Faith, Self::Custom, Self::Allegiance];
    pub fn entity_kind(self) -> &'static str {
        match self {
            Self::Tongue => "language",
            Self::Faith => "religion",
            Self::Custom => "culture",
            Self::Allegiance => "polity",
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tongue => "tongue",
            Self::Faith => "faith",
            Self::Custom => "custom",
            Self::Allegiance => "allegiance",
        }
    }
    pub fn field(self) -> Field {
        match self {
            Self::Tongue => Field::Tongue,
            Self::Faith => Field::Faith,
            Self::Custom => Field::Custom,
            Self::Allegiance => Field::Allegiance,
        }
    }
    fn suffix(self) -> &'static str {
        match self {
            Self::Tongue => " tongue",
            Self::Faith => " rite",
            _ => "",
        }
    }
}
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Tradition {
    pub code: i32,
    pub kind: Kind,
    pub entity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<i32>,
    pub founded: String,
    pub origin: Position,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended: Option<String>,
}
pub struct Founding {
    pub kind: Kind,
    pub key: String,
    pub origin: Position,
    pub era: String,
    pub parent: Option<i32>,
    pub tongue: Option<i32>,
}
/// The existing independent naming implementation serves both execution hosts.
pub trait Naming {
    fn name(&self, id: &str, founding: &Founding, language: Option<&str>) -> io::Result<Named>;
    fn culture(&self, position: Position) -> io::Result<Value>;
    /// Later names use this newly founded entity's naming culture in the host vocabulary.
    fn remember(&self, entity: &Entity) -> io::Result<()>;
}
#[derive(Default, Serialize, Deserialize)]
pub struct Traditions {
    pub known: Vec<Tradition>,
}
pub struct Context {
    pub world: String,
    // hpc-exempt: named world entities indexed by stable identity.
    pub entities: BTreeMap<String, Entity>,
    pub traditions: Traditions,
    pub naming: std::rc::Rc<dyn Naming>,
}
impl Context {
    pub fn found(&mut self, founding: Founding) -> io::Result<i32> {
        self.traditions.found(
            &self.world,
            &mut self.entities,
            founding,
            self.naming.as_ref(),
        )
    }
}
impl Traditions {
    pub fn get(&self, code: i32) -> Option<&Tradition> {
        usize::try_from(code - 1)
            .ok()
            .and_then(|index| self.known.get(index))
    }
    pub fn found(
        &mut self,
        world: &str,
        // hpc-exempt: named world entities indexed by stable identity.
        entities: &mut BTreeMap<String, Entity>,
        founding: Founding,
        naming: &dyn Naming,
    ) -> io::Result<i32> {
        let id = semantic_id(world, founding.kind.entity_kind(), &founding.key)?;
        let parent = founding.parent.and_then(|code| self.get(code));
        let language = founding
            .tongue
            .and_then(|code| self.get(code))
            .map(|t| t.entity.as_str());
        let named = naming.name(&id, &founding, language)?;
        let culture = match parent
            .and_then(|p| entities.get(&p.entity))
            .and_then(|e| e.attributes.get("namingCulture"))
            .filter(|v| !v.is_null())
        {
            Some(value) => value.clone(),
            None => naming.culture(founding.origin)?,
        };
        let code = i32::try_from(self.known.len() + 1).map_err(io::Error::other)?;
        let entity = entities.entry(id.clone()).or_insert_with(|| {
            let mut attributes = named.metadata;
            attributes.insert("namingCulture".into(), culture);
            attributes.insert(
                "center".into(),
                json!({"x":founding.origin.x,"y":founding.origin.y,"z":0}),
            );
            Entity {
                id: id.clone(),
                kind: founding.kind.entity_kind().into(),
                name: format!("{}{}", named.name, founding.kind.suffix()),
                state: Some(State::Generated),
                attributes,
                relations: Some(
                    parent
                        .map(|p| {
                            vec![Relation {
                                target_id: p.entity.clone(),
                                kind: "derivedFrom".into(),
                            }]
                        })
                        .unwrap_or_default(),
                ),
            }
        });
        entity
            .attributes
            .insert("traditionCode".into(), code.into());
        entity
            .attributes
            .insert("traditionKind".into(), founding.kind.as_str().into());
        entity
            .attributes
            .insert("founded".into(), founding.era.clone().into());
        naming.remember(entity)?;
        self.known.push(Tradition {
            code,
            kind: founding.kind,
            entity: id,
            parent: founding.parent,
            founded: founding.era,
            origin: founding.origin,
            seat: None,
            ended: None,
        });
        Ok(code)
    }
    pub fn restore(&mut self, entities: impl IntoIterator<Item = Entity>) -> io::Result<()> {
        if !self.known.is_empty() {
            return Ok(());
        }
        let mut restored: Vec<Option<Tradition>> = Vec::new();
        for entity in entities {
            let Some(code) = entity.attributes.get("traditionCode").and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            }) else {
                continue;
            };
            let Some(kind) = Kind::ALL.into_iter().find(|kind| {
                entity
                    .attributes
                    .get("traditionKind")
                    .and_then(Value::as_str)
                    == Some(kind.as_str())
            }) else {
                continue;
            };
            if code < 1.0 || code.fract() != 0.0 {
                continue;
            }
            if code > f64::from(i32::MAX) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Tradition code exceeds identity representation",
                ));
            }
            let code = code as i32;
            restored.resize_with(restored.len().max(code as usize), || None);
            let center = entity.attributes.get("center");
            let origin = Position {
                x: center
                    .and_then(|v| v.get("x"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                y: center
                    .and_then(|v| v.get("y"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
            };
            let founded = entity
                .attributes
                .get("founded")
                .filter(|v| !v.is_null())
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
                .unwrap_or_default();
            restored[code as usize - 1] = Some(Tradition {
                code,
                kind,
                entity: entity.id,
                parent: None,
                founded,
                origin,
                seat: None,
                ended: None,
            });
        }
        self.known = restored
            .into_iter()
            .enumerate()
            .map(|(index, value)| {
                value.unwrap_or(Tradition {
                    code: index as i32 + 1,
                    kind: Kind::Custom,
                    entity: String::new(),
                    parent: None,
                    founded: String::new(),
                    origin: Position::default(),
                    seat: None,
                    ended: Some("forgotten".into()),
                })
            })
            .collect();
        Ok(())
    }
}
