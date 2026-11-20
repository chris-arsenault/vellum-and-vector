//! A published map as rows: the revision, its spaces, layers, bands, categories, feature
//! types and declared layer properties. Both stores hold these rows and assemble the map
//! description from them; neither stores the description as one document.
use atlas_map::{
    Bounds, Category, DisplayUnit, GeometryType, Id, KindSize, LayerCatalog, LayerSource,
    MagicDepiction, MapDescriptor, MapFeatureType, MapLayer, MapProperty, MapRef, MapSpace,
    MapVectorStyle, PropertyType, PublicationState, RasterBand, RasterSource, RealScale,
    RegionGeometry, RegionScale, SurfaceAppearance, VectorSource,
};
use std::{collections::BTreeMap, io};

/// The revision's own facts. Real-scale settings stay one open value: authoring choices are
/// configuration, not records a query selects by.
#[derive(Clone, Debug, PartialEq)]
pub struct Revision {
    pub reference: MapRef,
    pub world_id: Id,
    pub name: String,
    pub primary_space_id: Id,
    pub profile: String,
    pub region_scale: RegionScale,
    pub footprint: RegionGeometry,
    pub bounds: Bounds,
    pub parent: Option<MapRef>,
    pub complete: bool,
    pub real_scale: Option<RealScale>,
}

/// What draws a layer. Attribute layers hold rasters the viewer does not draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    Raster,
    Vector,
    Attributes,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LayerRow {
    pub ordinal: i32,
    pub id: String,
    pub space_id: Id,
    pub name: String,
    pub bounds: Bounds,
    pub attribution: Vec<String>,
    pub source: SourceKind,
    pub asset_id: Option<String>,
    pub media_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub cell_span: Option<f64>,
    pub overviews: Vec<String>,
    pub band_indices: Vec<u16>,
    pub path: Vec<String>,
    pub common: bool,
    /// The style document a creator edits in the viewer.
    pub default_style: Option<MapVectorStyle>,
    pub presets: Vec<String>,
    pub examples: Vec<Id>,
    pub geometries: Vec<GeometryType>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BandRow {
    pub layer: i32,
    pub ordinal: i32,
    pub id: String,
    pub name: String,
    pub unit: String,
    pub display_unit: String,
    pub display_factor: f64,
    pub nodata: Option<f64>,
    pub range: Option<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CategoryRow {
    pub layer: i32,
    pub band: i32,
    pub ordinal: i32,
    pub category: Category,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FeatureTypeRow {
    pub layer: i32,
    pub ordinal: i32,
    pub feature_type: MapFeatureType,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PropertyRow {
    pub layer: i32,
    pub name: String,
    pub kind: PropertyType,
}

/// A map description's rows, in their stored order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayerRows {
    pub layers: Vec<LayerRow>,
    pub bands: Vec<BandRow>,
    pub categories: Vec<CategoryRow>,
    pub feature_types: Vec<FeatureTypeRow>,
    pub properties: Vec<PropertyRow>,
}

pub fn revision(map: &MapDescriptor, complete: bool) -> Revision {
    Revision {
        reference: map.reference.clone(),
        world_id: map.world_id,
        name: map.name.clone(),
        primary_space_id: map.primary_space_id,
        profile: map.profile.clone(),
        region_scale: map.region_scale.clone(),
        footprint: map.footprint.clone(),
        bounds: map.bounds,
        parent: map.parent.clone(),
        complete,
        real_scale: map.real_scale.clone(),
    }
}

/// The rows of `layers`, numbered from `first` so that added layers follow those stored.
pub fn layer_rows(layers: &[MapLayer], first: i32) -> io::Result<LayerRows> {
    let mut rows = LayerRows::default();
    for (at, layer) in layers.iter().enumerate() {
        let ordinal = first + i32::try_from(at).map_err(io::Error::other)?;
        let (source, asset, media, size, cell_span, overviews, indices, bands) = match &layer.source
        {
            LayerSource::Raster(s) | LayerSource::Attributes(s) => (
                if matches!(layer.source, LayerSource::Raster(_)) {
                    SourceKind::Raster
                } else {
                    SourceKind::Attributes
                },
                Some(s.asset_id.clone()),
                Some(s.media_type.clone()),
                Some((s.width, s.height)),
                Some(s.cell_span),
                s.overviews.clone(),
                s.band_indices.clone(),
                s.bands.as_slice(),
            ),
            LayerSource::Vector(s) => (
                SourceKind::Vector,
                Some(s.asset_id.clone()),
                Some(s.media_type.clone()),
                None,
                None,
                Vec::new(),
                Vec::new(),
                &[][..],
            ),
        };
        let catalog = &layer.catalog;
        rows.layers.push(LayerRow {
            ordinal,
            id: layer.id.clone(),
            space_id: layer.space_id,
            name: layer.name.clone(),
            bounds: layer.bounds,
            attribution: layer.attribution.clone(),
            source,
            asset_id: asset,
            media_type: media,
            width: size.map(|s| s.0),
            height: size.map(|s| s.1),
            cell_span,
            overviews,
            band_indices: indices,
            path: catalog.path.clone(),
            common: catalog.common,
            default_style: catalog.default_style.clone(),
            presets: catalog.presets.clone(),
            examples: catalog.examples.clone(),
            geometries: catalog.geometries.clone(),
        });
        band_rows(ordinal, bands, &mut rows)?;
        for (at, feature_type) in catalog.feature_types.iter().enumerate() {
            rows.feature_types.push(FeatureTypeRow {
                layer: ordinal,
                ordinal: i32::try_from(at).map_err(io::Error::other)?,
                feature_type: feature_type.clone(),
            });
        }
        for (name, property) in &catalog.properties {
            rows.properties.push(PropertyRow {
                layer: ordinal,
                name: name.clone(),
                kind: property.kind,
            });
        }
    }
    Ok(rows)
}
fn band_rows(layer: i32, bands: &[RasterBand], rows: &mut LayerRows) -> io::Result<()> {
    for (at, band) in bands.iter().enumerate() {
        let ordinal = i32::try_from(at).map_err(io::Error::other)?;
        rows.bands.push(BandRow {
            layer,
            ordinal,
            id: band.id.clone(),
            name: band.name.clone(),
            unit: band.unit.clone(),
            display_unit: band.display.unit.to_string(),
            display_factor: band.display.factor,
            nodata: band.nodata,
            range: band.range,
        });
        for (at, category) in band.categories.iter().enumerate() {
            rows.categories.push(CategoryRow {
                layer,
                band: ordinal,
                ordinal: i32::try_from(at).map_err(io::Error::other)?,
                category: category.clone(),
            });
        }
    }
    Ok(())
}

/// The map description from its rows. Spaces arrive in their stored order; other rows may
/// arrive in any order.
pub fn assemble(
    revision: Revision,
    spaces: Vec<MapSpace>,
    mut rows: LayerRows,
) -> io::Result<MapDescriptor> {
    rows.layers.sort_by_key(|l| l.ordinal);
    rows.bands.sort_by_key(|b| (b.layer, b.ordinal));
    rows.categories
        .sort_by_key(|c| (c.layer, c.band, c.ordinal));
    rows.feature_types.sort_by_key(|t| (t.layer, t.ordinal));
    let mut bands: BTreeMap<i32, Vec<RasterBand>> = BTreeMap::new();
    let mut categories: BTreeMap<(i32, i32), Vec<Category>> = BTreeMap::new();
    for row in rows.categories {
        categories
            .entry((row.layer, row.band))
            .or_default()
            .push(row.category);
    }
    for row in rows.bands {
        bands.entry(row.layer).or_default().push(RasterBand {
            categories: categories
                .remove(&(row.layer, row.ordinal))
                .unwrap_or_default(),
            id: row.id,
            name: row.name,
            unit: row.unit,
            display: DisplayUnit {
                unit: row.display_unit.into(),
                factor: row.display_factor,
            },
            nodata: row.nodata,
            range: row.range,
        });
    }
    let mut types: BTreeMap<i32, Vec<MapFeatureType>> = BTreeMap::new();
    for row in rows.feature_types {
        types.entry(row.layer).or_default().push(row.feature_type);
    }
    let mut properties: BTreeMap<i32, BTreeMap<String, MapProperty>> = BTreeMap::new();
    for row in rows.properties {
        properties
            .entry(row.layer)
            .or_default()
            .insert(row.name, MapProperty { kind: row.kind });
    }
    let layers = rows
        .layers
        .into_iter()
        .map(|row| {
            let bands = bands.remove(&row.ordinal).unwrap_or_default();
            let feature_types = types.remove(&row.ordinal).unwrap_or_default();
            let properties = properties.remove(&row.ordinal).unwrap_or_default();
            layer(row, bands, feature_types, properties)
        })
        .collect::<io::Result<Vec<_>>>()?;
    Ok(MapDescriptor {
        reference: revision.reference,
        world_id: revision.world_id,
        name: revision.name,
        primary_space_id: revision.primary_space_id,
        profile: revision.profile,
        region_scale: revision.region_scale,
        footprint: revision.footprint,
        bounds: revision.bounds,
        spaces,
        parent: revision.parent,
        state: if revision.complete {
            PublicationState::Complete
        } else {
            PublicationState::Incomplete
        },
        layers,
        real_scale: revision.real_scale,
    })
}
fn layer(
    row: LayerRow,
    bands: Vec<RasterBand>,
    feature_types: Vec<MapFeatureType>,
    properties: BTreeMap<String, MapProperty>,
) -> io::Result<MapLayer> {
    let missing = || io::Error::other("A stored layer is missing its source");
    let source = match row.source {
        SourceKind::Raster | SourceKind::Attributes => {
            let raster = RasterSource {
                asset_id: row.asset_id.ok_or_else(missing)?,
                media_type: row.media_type.ok_or_else(missing)?,
                width: row.width.ok_or_else(missing)?,
                height: row.height.ok_or_else(missing)?,
                cell_span: row.cell_span.ok_or_else(missing)?,
                bands,
                overviews: row.overviews,
                band_indices: row.band_indices,
            };
            if row.source == SourceKind::Raster {
                LayerSource::Raster(raster)
            } else {
                LayerSource::Attributes(raster)
            }
        }
        SourceKind::Vector => LayerSource::Vector(VectorSource {
            asset_id: row.asset_id.ok_or_else(missing)?,
            media_type: row.media_type.ok_or_else(missing)?,
        }),
    };
    Ok(MapLayer {
        id: row.id,
        space_id: row.space_id,
        name: row.name,
        bounds: row.bounds,
        source,
        attribution: row.attribution,
        catalog: LayerCatalog {
            path: row.path,
            common: row.common,
            feature_types,
            default_style: row.default_style,
            presets: row.presets,
            properties,
            examples: row.examples,
            geometries: row.geometries,
        },
    })
}

/// Closed vocabularies are stored as small integers.
pub trait Code: Sized + Copy + 'static {
    const ALL: &'static [Self];
    fn code(self) -> i16;
    fn from_code(code: i16) -> io::Result<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|v| v.code() == code)
            .ok_or_else(|| io::Error::other("Stored code is outside its vocabulary"))
    }
}
impl Code for SourceKind {
    const ALL: &'static [Self] = &[Self::Raster, Self::Vector, Self::Attributes];
    fn code(self) -> i16 {
        self as i16
    }
}
impl Code for GeometryType {
    const ALL: &'static [Self] = &[
        Self::Point,
        Self::MultiPoint,
        Self::LineString,
        Self::MultiLineString,
        Self::Polygon,
        Self::MultiPolygon,
        Self::GeometryCollection,
    ];
    fn code(self) -> i16 {
        self as i16
    }
}
impl Code for PropertyType {
    const ALL: &'static [Self] = &[Self::String, Self::Number, Self::Boolean];
    fn code(self) -> i16 {
        self as i16
    }
}
impl Code for MagicDepiction {
    const ALL: &'static [Self] = &[Self::Site, Self::Course, Self::Area];
    fn code(self) -> i16 {
        self as i16
    }
}
/// A published sample's typed columns beside its footprint geometry. Sections are open
/// catalogue records and stay one open value, absent when the sample has none.
#[derive(Clone, Debug, PartialEq)]
pub struct SampleRow {
    pub id: String,
    pub space_id: Id,
    pub window: Bounds,
    pub closed_east: bool,
    pub closed_north: bool,
    pub cell_span: f64,
    pub center: [f64; 2],
    pub center_z: Option<f64>,
    pub measure: f64,
    pub active: bool,
    pub sections: Option<serde_json::Value>,
}
impl SampleRow {
    pub fn of(sample: atlas_map::MapSample) -> io::Result<(Self, RegionGeometry)> {
        sample.window.bounds.validate().map_err(io::Error::other)?;
        if sample.id.is_empty()
            || !sample.cell_span.is_finite()
            || sample.cell_span <= 0.0
            || !sample.center.coordinates().iter().all(|v| v.is_finite())
            || !sample.measure.is_finite()
            || sample.measure < 0.0
        {
            return Err(io::Error::other(
                "Map samples require identity, finite center and positive resolution",
            ));
        }
        let [x, y, z] = sample.center.coordinates();
        let row = Self {
            id: sample.id,
            space_id: sample.space_id,
            window: sample.window.bounds,
            closed_east: sample.window.closed_east,
            closed_north: sample.window.closed_north,
            cell_span: sample.cell_span,
            center: [x, y],
            center_z: matches!(sample.center, atlas_map::Position::XYZ(_)).then_some(z),
            measure: sample.measure,
            active: sample.active,
            sections: (!sample.sections.is_empty())
                .then(|| serde_json::to_value(&sample.sections))
                .transpose()?,
        };
        Ok((row, sample.footprint))
    }
    pub fn sample(self, footprint: RegionGeometry) -> io::Result<atlas_map::MapSample> {
        let [x, y] = self.center;
        Ok(atlas_map::MapSample {
            id: self.id,
            space_id: self.space_id,
            footprint,
            window: atlas_map::SampleWindow {
                bounds: self.window,
                closed_east: self.closed_east,
                closed_north: self.closed_north,
            },
            cell_span: self.cell_span,
            center: match self.center_z {
                Some(z) => atlas_map::Position::XYZ([x, y, z]),
                None => atlas_map::Position::xy(x, y),
            },
            measure: self.measure,
            active: self.active,
            sections: self
                .sections
                .map(serde_json::from_value)
                .transpose()?
                .unwrap_or_default(),
        })
    }
}
pub fn codes<T: Code>(values: &[T]) -> Vec<i16> {
    values.iter().map(|v| v.code()).collect()
}
pub fn from_codes<T: Code>(codes: &[i16]) -> io::Result<Vec<T>> {
    codes.iter().map(|&c| T::from_code(c)).collect()
}
/// A feature type's true size as its five stored parts.
pub fn size_parts(size: Option<KindSize>) -> [Option<f64>; 4] {
    size.map_or([None; 4], |s| {
        [
            Some(s.least),
            Some(s.typical),
            Some(s.largest),
            Some(s.elongation),
        ]
    })
}
pub fn size_from(parts: [Option<f64>; 4], round: Option<bool>) -> Option<KindSize> {
    match (parts, round) {
        ([Some(least), Some(typical), Some(largest), Some(elongation)], Some(round)) => {
            Some(KindSize {
                least,
                typical,
                largest,
                elongation,
                round,
            })
        }
        _ => None,
    }
}
/// A category's surface appearance as its stored columns: bathymetric, tint, system and
/// system name.
pub type SurfaceParts = (Option<bool>, Option<f64>, Option<String>, Option<String>);
/// A category's surface appearance as its stored parts.
pub fn surface_parts(surface: Option<&SurfaceAppearance>) -> SurfaceParts {
    surface.map_or((None, None, None, None), |s| {
        (
            Some(s.bathymetric),
            Some(s.tint),
            s.system.clone(),
            s.system_name.clone(),
        )
    })
}
pub fn surface_from(
    bathymetric: Option<bool>,
    tint: Option<f64>,
    system: Option<String>,
    system_name: Option<String>,
) -> Option<SurfaceAppearance> {
    Some(SurfaceAppearance {
        bathymetric: bathymetric?,
        tint: tint?,
        system,
        system_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_map::MapFrame;
    fn map() -> MapDescriptor {
        let id = Id::from_name;
        let band = |name: &str| RasterBand {
            id: name.into(),
            name: name.into(),
            unit: "m".into(),
            display: DisplayUnit {
                unit: "m".into(),
                factor: 1.0,
            },
            nodata: Some(-1.0),
            range: Some((0.0, 9.0)),
            categories: vec![Category {
                value: 3,
                label: "Limestone".into(),
                color: None,
                surface: Some(SurfaceAppearance {
                    bathymetric: false,
                    tint: 0.5,
                    system: None,
                    system_name: None,
                }),
                present: true,
                soluble: Some(true),
            }],
        };
        let catalog = |types: Vec<MapFeatureType>| LayerCatalog {
            path: vec!["Terrain".into()],
            common: true,
            feature_types: types,
            default_style: None,
            presets: vec!["plain".into()],
            properties: BTreeMap::from([(
                "width".into(),
                MapProperty {
                    kind: PropertyType::Number,
                },
            )]),
            examples: vec![id("example")],
            geometries: vec![GeometryType::LineString],
        };
        let bounds = Bounds(0.0, 0.0, 10.0, 10.0);
        let space = |s: Id, parent: Option<Id>| MapSpace {
            id: s,
            parent_space_id: parent,
            bounds,
            metres_per_unit: 1.0,
            precision: 0.01,
            periodic_width: None,
            frame: MapFrame {
                origin: [0.0; 3],
                rotation: 0.0,
                floor: None,
            },
        };
        MapDescriptor {
            reference: MapRef {
                map_id: id("glen"),
                revision: id("1"),
            },
            world_id: id("world"),
            name: "Glen".into(),
            primary_space_id: id("glen"),
            profile: "local".into(),
            region_scale: RegionScale {
                level: 1,
                next_area: 1.0,
                subdivision: 7.0,
                minimum_width: 1.0,
                enabled: false,
            },
            footprint: RegionGeometry::Polygon(vec![vec![
                atlas_map::Position::xy(0.0, 0.0),
                atlas_map::Position::xy(10.0, 0.0),
                atlas_map::Position::xy(10.0, 10.0),
                atlas_map::Position::xy(0.0, 0.0),
            ]]),
            bounds,
            spaces: vec![
                space(id("glen"), Some(id("world"))),
                space(id("world"), None),
            ],
            parent: None,
            state: PublicationState::Incomplete,
            layers: vec![
                MapLayer {
                    id: "raster:elevation".into(),
                    space_id: id("glen"),
                    name: "Elevation".into(),
                    bounds,
                    source: LayerSource::Raster(RasterSource {
                        asset_id: "a".into(),
                        media_type: "image/tiff".into(),
                        width: 4,
                        height: 4,
                        cell_span: 2.5,
                        bands: vec![band("Elevation"), band("Rock")],
                        overviews: vec!["b".into()],
                        band_indices: vec![1, 2],
                    }),
                    attribution: vec!["Generated".into()],
                    catalog: catalog(Vec::new()),
                },
                MapLayer {
                    id: "vector:rivers".into(),
                    space_id: id("glen"),
                    name: "Rivers".into(),
                    bounds,
                    source: LayerSource::Vector(VectorSource {
                        asset_id: "v".into(),
                        media_type: "application/x-atlas".into(),
                    }),
                    attribution: Vec::new(),
                    catalog: catalog(vec![MapFeatureType {
                        id: "river".into(),
                        kind: "river".into(),
                        label: "Rivers".into(),
                        path: vec!["Water".into(), "Rivers".into()],
                        magic_depiction: Some(MagicDepiction::Course),
                        count: 3,
                        geometries: vec![GeometryType::MultiLineString],
                        footprints: true,
                        true_size: None,
                    }]),
                },
            ],
            real_scale: None,
        }
    }
    #[test]
    fn a_map_description_comes_back_whole_from_its_rows() {
        let map = map();
        let rows = layer_rows(&map.layers, 0).unwrap();
        assert_eq!(rows.layers.len(), 2);
        assert_eq!(rows.bands.len(), 2);
        assert_eq!(rows.categories.len(), 2);
        assert_eq!(rows.feature_types.len(), 1);
        let mut shuffled = rows.clone();
        shuffled.layers.reverse();
        shuffled.bands.reverse();
        let back = assemble(revision(&map, false), map.spaces.clone(), shuffled).unwrap();
        assert_eq!(back, map);
    }
    #[test]
    fn added_layers_number_after_the_stored_ones() {
        let map = map();
        let rows = layer_rows(&map.layers[1..], 1).unwrap();
        assert_eq!(rows.layers[0].ordinal, 1);
        assert_eq!(rows.feature_types[0].layer, 1);
    }
    #[test]
    fn every_closed_vocabulary_member_has_its_own_code() {
        for kind in GeometryType::ALL {
            assert_eq!(GeometryType::from_code(kind.code()).unwrap(), *kind);
        }
        assert!(SourceKind::from_code(9).is_err());
    }
}
