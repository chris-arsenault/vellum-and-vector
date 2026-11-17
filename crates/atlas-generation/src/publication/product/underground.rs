//! A ground map's caves keep their own hex grid in the underground space, marked by the cave
//! shapes, so the cave level reads in hexes like the surface (ADR 0016).
use super::{Assets, Product};
use crate::{control::GenerationControl, features::Feature};
use atlas_map::{Geometry, MapDescriptor, Publisher};
use std::io;

use atlas_map::underground::cave_hex_id as underground_hex_id;
pub use atlas_map::underground::CAVE_HEXES;

impl Product<'_> {
    /// What authoring offers on a real-scale map: ground classes from the published surface
    /// legend and exposed rock, cover classes, and the layers a first drawing opens.
    pub(super) fn authoring_choices(
        &self,
        map: &mut MapDescriptor,
        selected: &super::inputs::Selected<'_>,
        latent_layers: Vec<atlas_map::MapLayer>,
    ) {
        use atlas_map::authoring::{choices, AuthoringChoices};
        let Some(real) = map.real_scale.as_mut() else {
            return;
        };
        let surface = if selected.channels.contains_key(super::records::SURFACE) {
            self.fields.categories(super::records::SURFACE)
        } else {
            Vec::new()
        };
        real.authoring = AuthoringChoices {
            ground_classes: choices::ground_classes(&surface),
            cover_classes: choices::cover_classes(),
            latent_layers,
        };
    }
}
/// A surface hex becomes its underground twin: same cell of the grid, its own identity.
pub fn underground_hex(mut hex: Feature) -> Feature {
    hex.id = underground_hex_id(&hex.id);
    hex.layer_id = "caveHexes".into();
    hex
}
impl Product<'_> {
    pub(super) async fn cave_hexes(
        &self,
        map: &MapDescriptor,
        marks: &Option<Vec<(Geometry, &'static str)>>,
        publisher: &mut impl Publisher,
        assets: &mut impl Assets,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let layer = map.layers.iter().find(|layer| layer.id == CAVE_HEXES);
        let (Some(real), Some(layer), Some(sources)) = (&map.real_scale, layer, marks) else {
            return Ok(());
        };
        let spatial = self.vectors.registry.spatial;
        let area = self.descriptor.area;
        let hexes = super::hexes::hex_features(real, map.bounds, area, sources, None, spatial)?
            .into_iter()
            .map(|hex| {
                let mut feature = self
                    .vectors
                    .record(underground_hex(hex))
                    .map_err(io::Error::other)?;
                feature.space_id.clone_from(&layer.space_id);
                Ok(feature)
            });
        self.vector_layer(map, layer, hexes, &mut None, publisher, assets, control)
            .await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::State;
    #[test]
    fn an_underground_hex_keeps_its_cell_under_its_own_identity() {
        let hex = Feature {
            map_only: None,
            place_id: None,
            footprint: None,
            id: "hex:area:1:2".into(),
            name: "Hex 1, 2".into(),
            kind: "hex".into(),
            layer_id: "hexes".into(),
            area_id: "area".into(),
            geometry: Geometry::Point {
                coordinates: atlas_map::Position::xy(0.0, 0.0),
            },
            detail: Default::default(),
            attributes: Default::default(),
            relations: Vec::new(),
            state: State::Generated,
            protected: false,
            actor: "publication".into(),
            generation_id: None,
            causes: Vec::new(),
            generation_domain: None,
        };
        let cave = underground_hex(hex.clone());
        assert_eq!(
            (cave.id.as_str(), cave.layer_id.as_str()),
            ("cave-hex:area:1:2", "caveHexes")
        );
        assert_eq!(cave.geometry, hex.geometry);
        assert!(crate::publication::layers::underground(CAVE_HEXES));
        assert!(crate::publication::layers::underground(
            atlas_map::underground::CAVE_WALLS
        ));
        assert!(!crate::publication::layers::underground(
            "vector:caveEntrances"
        ));
    }
    /// Authoring opens the underground layers without the catalogue; their kinds must read
    /// exactly as publication names them, or a drawn wall would not match a published one.
    #[test]
    fn authored_cave_layers_name_their_kinds_as_publication_does() {
        let layers = crate::publication::layers::builtin();
        let catalogue = crate::publication::catalogue::Catalogue {
            layers: &layers,
            systems: &[],
            confluences: &[],
        };
        let none = Default::default();
        // The catalogue also gives a wall its true thickness; the built layer's kind has none.
        let wall = catalogue.describe("caveWalls", "caveWall", &none);
        assert!(wall.true_size.is_some());
        assert_eq!(
            atlas_map::MapFeatureType {
                true_size: None,
                ..wall
            },
            atlas_map::underground::cave_wall_type()
        );
        // Every object kind a creator places has its true size in the catalogue.
        for kind in catalogue.available("objects").values() {
            assert!(kind.true_size.is_some(), "{}", kind.kind);
        }
        assert_eq!(
            catalogue.describe("caveHexes", "hex", &none),
            atlas_map::underground::cave_hex_type()
        );
        assert_eq!(
            underground_hex_id("hex:a:1:2"),
            atlas_map::underground::cave_hex_id("hex:a:1:2")
        );
    }
}
