use super::Selection;
use atlas_generation::town::city::outline::{self, Ground};
use atlas_gis::{
    map_files::MapFiles,
    map_store::{space, FeatureQuery, MapAccess},
    raster_values::{layer_value, Raster},
};
use atlas_map::{Geometry, Id, LayerSource, MapLayer, Position};
use std::{
    fs::File,
    io::{self, BufReader},
};

struct Field<'a> {
    layer: &'a MapLayer,
    raster: Raster<BufReader<File>>,
}
impl Field<'_> {
    fn value(&mut self, p: Position) -> io::Result<Option<f64>> {
        Ok(layer_value(&mut self.raster, self.layer, p)?.map(|v| v.value))
    }
}
pub(super) fn outline(
    selection: &Selection<'_>,
    settlement: Id,
    maps: &dyn MapAccess,
    files: &MapFiles,
    spatial: &dyn atlas_generation::spatial::SpatialKernel,
) -> io::Result<Geometry> {
    let map = selection.parent;
    let space_id = selection.selection.space_id;
    let feature = maps
        .features(
            &map.reference,
            &FeatureQuery {
                space_id,
                feature_ids: Some(vec![settlement]),
                ..Default::default()
            },
        )?
        .items
        .into_iter()
        .find(|f| f.kind == "settlement")
        .ok_or_else(|| {
            io::Error::other("City capture needs the settlement on its pinned parent map")
        })?;
    if let Some(footprint) = feature.footprint.as_ref() {
        return Ok(atlas_map::regions::as_geometry(footprint));
    }
    let Geometry::Point {
        coordinates: anchor,
    } = feature.geometry
    else {
        return atlas_map::regions::polygon(feature.geometry)
            .ok_or_else(|| io::Error::other("A City needs a settlement point or an outline"));
    };
    let open = |id: &str| -> io::Result<Option<Field<'_>>> {
        let Some(layer) = map
            .layers
            .iter()
            .find(|l| l.space_id == space_id && l.id == id)
        else {
            return Ok(None);
        };
        let LayerSource::Raster(src) = &layer.source else {
            return Ok(None);
        };
        let asset = maps.asset(&map.reference, &src.asset_id)?;
        Ok(Some(Field {
            layer,
            raster: Raster::new(BufReader::new(files.open(&asset.location)?))?,
        }))
    };
    let mut people = open("raster:Population")?;
    let mut built = open("raster:BuiltUp")?;
    let mut slope = open("raster:Slope")?;
    let mut water = open("raster:WaterKindCodes")?;
    let field = people
        .as_ref()
        .or(built.as_ref())
        .ok_or_else(|| {
            io::Error::other(
                "City capture needs a settlement footprint or parent settlement fields",
            )
        })?
        .layer;
    let LayerSource::Raster(source) = &field.source else {
        unreachable!()
    };
    let sample = |f: &mut Option<Field<'_>>, p| {
        f.as_mut()
            .map(|f| f.value(p))
            .transpose()
            .map(Option::flatten)
    };
    outline::trace(
        spatial,
        anchor,
        field.bounds,
        source.cell_span,
        space(map, space_id)?.precision,
        |p| {
            let residents = sample(&mut people, p)?;
            let cover = sample(&mut built, p)?;
            if residents.is_none() && cover.is_none() {
                return Ok(None);
            }
            Ok(Some(Ground {
                residents_per_km2: residents.unwrap_or_default(),
                built_share: cover.unwrap_or_default(),
                slope: sample(&mut slope, p)?.unwrap_or_default(),
                water: sample(&mut water, p)?.is_some_and(|v| v.round() != 0.),
            }))
        },
    )
}
