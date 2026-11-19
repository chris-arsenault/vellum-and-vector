use super::{space, MapAccess};
use atlas_map::{
    regions::{change_navigation, validate_navigation},
    MapNavigationState, MapRef, NavigationChange,
};
use atlas_map::{PublishedAsset, RegionDrawing, RegionQuery};
use serde::Deserialize;
use std::future::Future;
use std::io;
#[derive(Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum RegionOperation {
    Choices {
        reference: MapRef,
        query: RegionQuery,
        navigation: MapNavigationState,
    },
    Draw {
        reference: MapRef,
        drawing: RegionDrawing,
        navigation: MapNavigationState,
    },
}
impl dyn MapAccess + '_ {
    pub fn read_navigation(&self, reference: &MapRef) -> io::Result<MapNavigationState> {
        self.open(reference)?;
        Ok(self
            .find_saved(reference.map_id)?
            .filter(|saved| saved.summary.reference == *reference)
            .map(|saved| saved.navigation)
            .unwrap_or_default())
    }
    pub fn validate_navigation(
        &self,
        reference: &MapRef,
        state: &MapNavigationState,
    ) -> io::Result<()> {
        let map = self.open(reference)?;
        let kernel = self
            .geometry()
            .spatial(space(&map, map.primary_space_id)?.precision)?;
        validate_navigation(&map, state, kernel.as_ref()).map_err(io::Error::other)?;
        for region in &state.regions {
            if let Some(child) = &region.child {
                if self.open(child)?.parent.as_ref() != Some(reference) {
                    return Err(io::Error::other(
                        "A finer map belongs to this pinned parent",
                    ));
                }
            }
        }
        Ok(())
    }

    pub async fn navigate<F: Future<Output = io::Result<Vec<u8>>>>(
        &self,
        operation: RegionOperation,
        read: impl FnMut(PublishedAsset) -> F,
    ) -> io::Result<serde_json::Value> {
        use atlas_map::regions::{draw_region, region_choices};
        match operation {
            RegionOperation::Choices {
                reference,
                mut query,
                navigation,
            } => {
                let map = self.open(&reference)?;
                let space = space(&map, query.space_id)?;
                query.position = query
                    .position
                    .map(|p| super::samples::canonical_position(space, p))
                    .transpose()?;
                let input = self
                    .region_input(&reference, navigation, &query, None, read)
                    .await?;
                let kernel = self.geometry().spatial(space.precision)?;
                serde_json::to_value(
                    region_choices(&input, &query, kernel.as_ref()).map_err(io::Error::other)?,
                )
                .map_err(io::Error::other)
            }
            RegionOperation::Draw {
                reference,
                drawing,
                navigation,
            } => {
                let input = self
                    .region_input(&reference, navigation, &drawing.query, Some(&drawing), read)
                    .await?;
                let kernel = self
                    .geometry()
                    .spatial(space(&input.map, drawing.query.space_id)?.precision)?;
                serde_json::to_value(
                    draw_region(&input, &drawing, kernel.as_ref()).map_err(io::Error::other)?,
                )
                .map_err(io::Error::other)
            }
        }
    }
    pub fn commit_navigation(
        &self,
        reference: &MapRef,
        state: &MapNavigationState,
        change: NavigationChange,
    ) -> io::Result<MapNavigationState> {
        let map = self.open(reference)?;
        self.validate_navigation(reference, state)?;
        let kernel = self
            .geometry()
            .spatial(space(&map, map.primary_space_id)?.precision)?;
        let next =
            change_navigation(&map, state, change, kernel.as_ref()).map_err(io::Error::other)?;
        self.validate_navigation(reference, &next)?;
        Ok(next)
    }
}
