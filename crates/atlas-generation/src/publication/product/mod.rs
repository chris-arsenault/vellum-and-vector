mod assets;
pub mod hexes;
pub mod inputs;
mod raster_group;
mod rasters;
mod records;
use super::{descriptor::Descriptor, fields::Fields, vectors::Vectors};
use crate::{atlas::history::EpochHistory, control::GenerationControl, storage::Coverage};
pub use assets::Assets;
use atlas_map::{MapDescriptor, MapRef, Publisher};
use std::{cell::RefCell, io};

pub struct Product<'a> {
    pub descriptor: Descriptor<'a>,
    pub expected: Option<&'a MapRef>,
    pub vectors: Vectors<'a>,
    pub fields: Fields<'a>,
    pub numerical: &'a [inputs::Field],
    pub history: &'a [EpochHistory],
}
struct Target<'a, P, A> {
    publisher: &'a mut P,
    assets: &'a mut A,
}
impl Product<'_> {
    // Arconis: docs/architecture/subsystems.arconis#item=j_publish — publishes the finished map's rasters, vectors and records.
    pub async fn publish(
        &self,
        publisher: &mut impl Publisher,
        assets: &mut impl Assets,
        scratch: &RefCell<Coverage>,
        control: &impl GenerationControl,
    ) -> io::Result<MapRef> {
        control
            .check()
            .map_err(|e| io::Error::other(format!("{e:?}")))?;
        let selected = inputs::Selected::new(
            self.descriptor.context,
            self.descriptor.area,
            self.numerical,
        )?;
        let mut map = self.prepare(&selected, assets)?;
        publisher.begin(&map, self.expected, self.expected.is_none())?;
        let result = self
            .write(
                &mut map,
                &selected,
                &mut Target { publisher, assets },
                scratch,
                control,
            )
            .await;
        if let Err(error) = result {
            if let Err(discard) = publisher.discard(&map.reference) {
                return Err(io::Error::other(format!(
                    "{error}; discarding publication failed: {discard}"
                )));
            }
            return Err(error);
        }
        Ok(map.reference)
    }
    async fn write(
        &self,
        map: &mut MapDescriptor,
        selected: &inputs::Selected<'_>,
        target: &mut Target<'_, impl Publisher, impl Assets>,
        scratch: &RefCell<Coverage>,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        self.rasters(map, selected, target, scratch, control)
            .await?;
        self.vectors(map, target.publisher, target.assets, control)
            .await?;
        self.records(map, selected, target.publisher, control)
            .await?;
        self.illustration(map, selected, target, scratch, control)
            .await?;
        control
            .check()
            .map_err(|e| io::Error::other(format!("{e:?}")))?;
        target.publisher.finish(&map.reference)
    }
}
