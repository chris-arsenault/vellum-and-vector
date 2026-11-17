//! Selected current-format resources become immutable generation inputs, never map products.
mod topology;
use crate::numerical_input::{self, Array, Dtype, Quantity, Snapshot};
use atlas_generation::{
    field::{
        inheritance::resources::{Cargo, Channel, Resource},
        projection::channels::Quantity as FieldQuantity,
        schema::NumericBand,
    },
    reconstruction::Grid,
    storage::{Coverage, SharedCache},
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    rc::Rc,
};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub world_id: String,
    pub space_id: String,
    pub area_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldScope {
    #[serde(flatten)]
    pub located: Scope,
    pub footprint: Geometry,
    pub crs_id: String,
    pub resolution: Option<f64>,
    pub revision: u64,
    pub time: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub id: String,
    pub scope: FieldScope,
    pub layout_resource_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_resource_id: Option<String>,
    pub geography_id: String,
    pub channels: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_cargo: Option<MaterialCargo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_support: Option<SurfaceSupport>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSupport {
    pub final_surface: String,
    pub natural: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialCargo {
    pub keys: Vec<String>,
    pub released_to: Vec<String>,
    pub slots: Vec<String>,
    pub offsets: String,
    pub records: String,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceLayout {
    Regular,
    Adaptive,
    Mesh,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Sampling {
    pub width: usize,
    pub height: usize,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Working,
    Ready,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub schema_version: u32,
    pub id: String,
    pub revision: u64,
    pub scope: Scope,
    pub crs_id: String,
    pub bounds: [f64; 4],
    pub precision: f64,
    pub layout: ResourceLayout,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling: Option<Sampling>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub periodic_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<Field>,
    pub state: State,
    pub arrays: Vec<Array>,
}
pub struct Opened {
    pub metadata: Value,
    pub snapshot: Rc<dyn Snapshot>,
}
pub const FORMAT: atlas_gis::stored::Format = atlas_gis::stored::Format {
    kind: "numerical-resource",
    revision: 1,
    semantics: "zarr3-located-typed-arrays",
};
/// The application prepares local descriptor/array handles before synchronous generation.
pub trait Store {
    fn describe(&self, id: &str) -> io::Result<Descriptor>;
    fn open(&self, id: &str, array: &Array) -> io::Result<Opened>;
}
/// One operation shares immutable bands by resolved resource and array identity. Cloned read
/// bands retain their snapshot closures after this cache drops, without mutable input aliases.
pub struct WorkingSet {
    store: Rc<dyn Store>,
    cache: SharedCache,
    loaded: BTreeMap<(String, String), NumericBand>,
}
impl WorkingSet {
    pub fn new(store: Rc<dyn Store>, cache: SharedCache) -> Self {
        Self {
            store,
            cache,
            loaded: BTreeMap::new(),
        }
    }
    fn describe(&self, id: &str) -> io::Result<Descriptor> {
        let resource = self.store.describe(id)?;
        if resource.id != id || resource.state != State::Ready {
            return Err(io::Error::other(
                "Load a completed current-format numerical resource",
            ));
        }
        Ok(resource)
    }
    fn array<'a>(resource: &'a Descriptor, name: &str) -> io::Result<&'a Array> {
        resource
            .arrays
            .iter()
            .find(|array| array.name == name)
            .ok_or_else(|| io::Error::other(format!("Field layout requires {name}")))
    }
    fn location(&self, resource: &Descriptor, array: &Array) -> io::Result<(Descriptor, Array)> {
        let (mut resource, mut array) = (resource.clone(), array.clone());
        let mut seen = BTreeSet::new();
        while let Some(alias) = &array.source {
            if !seen.insert((resource.id.clone(), array.name.clone())) {
                return Err(io::Error::other(
                    "Shared numerical arrays require acyclic resource references",
                ));
            }
            let original = self.describe(&alias.resource_id)?;
            let original_array = Self::array(&original, &alias.array)?.clone();
            if original.scope.world_id != resource.scope.world_id
                || original.scope.space_id != resource.scope.space_id
                || original.bounds != resource.bounds
                || original_array.dtype != array.dtype
                || original_array.shape != array.shape
                || original_array.chunk_shape != array.chunk_shape
                || original_array.unit != array.unit
                || original_array.quantity != array.quantity
            {
                return Err(io::Error::other(
                    "Shared arrays retain their located world, shape, chunks, units and quantities",
                ));
            }
            resource = original;
            array = original_array;
        }
        Ok((resource, array))
    }
    fn open(&mut self, resource: &Descriptor, name: &str) -> io::Result<NumericBand> {
        let (resource, array) = self.location(resource, Self::array(resource, name)?)?;
        let key = (resource.id.clone(), array.name.clone());
        if let Some(values) = self.loaded.get(&key) {
            return Ok(values.clone());
        }
        let opened = self.store.open(&resource.id, &array)?;
        macro_rules! band {
            ($ty:ty) => {
                numerical_input::open::<$ty>(
                    array,
                    &opened.metadata,
                    opened.snapshot,
                    self.cache.clone(),
                )?
                .into()
            };
        }
        let values: NumericBand = match array.dtype {
            Dtype::F64 => band!(f64),
            Dtype::F32 => band!(f32),
            Dtype::I32 => band!(i32),
            Dtype::U32 => band!(u32),
            Dtype::U8 => band!(u8),
            Dtype::I8 => band!(i8),
        };
        self.loaded.insert(key, values.clone());
        Ok(values)
    }
    pub fn load(&mut self, id: &str, names: &[String]) -> io::Result<Rc<Resource>> {
        let resource = self.describe(id)?;
        let field = resource
            .field
            .as_ref()
            .ok_or_else(|| io::Error::other("Load a completed field resource"))?;
        if field.scope.located != resource.scope || field.scope.crs_id != resource.crs_id {
            return Err(io::Error::other(
                "Field samples retain their located resource scope",
            ));
        }
        let active = self.u8(&resource, "active")?;
        let measures = self.f64(&resource, "measures")?;
        let layout = self.layout(&resource, active.len())?;
        if measures.len() != active.len() {
            return Err(io::Error::other(
                "Field measures require one value per sample",
            ));
        }
        let grid = Rc::new(Grid {
            bounds: resource.bounds,
            periodic_width: resource.periodic_width,
            layout,
            measures,
        });
        let mut channels = BTreeMap::new();
        for name in names {
            let key = field
                .channels
                .get(name)
                .ok_or_else(|| io::Error::other(format!("Requested channel {name} must exist")))?;
            let array = Self::array(&resource, key)?;
            let quantity = match array.quantity {
                Quantity::Intensive => FieldQuantity::Intensive,
                Quantity::Extensive => FieldQuantity::Extensive,
                Quantity::Category => FieldQuantity::Category,
                Quantity::Topology => {
                    return Err(io::Error::other(
                        "Field channel quantities must describe samples",
                    ))
                }
            };
            let values = self.open(&resource, key)?;
            if values.len() != active.len() {
                return Err(io::Error::other("Field channels need one value per sample"));
            }
            channels.insert(
                name.clone(),
                Channel {
                    values,
                    unit: array.unit.clone(),
                    quantity,
                },
            );
        }
        let cargo = self.cargo(&resource)?;
        let coverage = Coverage::samples(active.len(), self.cache.clone());
        let mut result = Resource::new(grid, active, channels, cargo, coverage);
        result.resolution = field.scope.resolution;
        if let Some(support) = &field.surface_support {
            let support = atlas_generation::field::projection::support::ReadSupport {
                final_surface: self.f64(&resource, &support.final_surface)?,
                natural: self.f64(&resource, &support.natural)?,
            };
            support.validate(result.active.len())?;
            result.surface_support = Some(support);
        }
        Ok(Rc::new(result))
    }
    fn cargo(&mut self, resource: &Descriptor) -> io::Result<Option<Cargo>> {
        let Some(cargo) = resource
            .field
            .as_ref()
            .and_then(|field| field.material_cargo.as_ref())
        else {
            return Ok(None);
        };
        Ok(Some(Cargo {
            keys: cargo.keys.clone(),
            released_to: cargo.released_to.clone(),
            slots: cargo.slots.clone(),
            offsets: self.u32(resource, &cargo.offsets)?,
            records: self.f64(resource, &cargo.records)?,
        }))
    }
}
