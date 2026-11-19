//! A map description held as revision, space and layer rows in PostGIS.
use super::{uuid, PostgresMaps};
use crate::rows::{
    self, assemble, codes, from_codes, layer_rows, size_from, size_parts, surface_from,
    surface_parts, BandRow, CategoryRow, Code, FeatureTypeRow, LayerRow, LayerRows, PropertyRow,
    Revision, SourceKind,
};
use atlas_map::{
    Bounds, Category, Id, MapDescriptor, MapFeatureType, MapFrame, MapLayer, MapRef, MapSpace,
    RegionScale,
};
use postgres::{
    binary_copy::BinaryCopyInWriter,
    types::{ToSql, Type},
    Row,
};
use std::io;

type Values<'a> = Vec<&'a (dyn ToSql + Sync)>;

impl PostgresMaps {
    pub(super) fn write_revision(
        &self,
        map: &MapDescriptor,
        expected: Option<Id>,
    ) -> io::Result<()> {
        let r = rows::revision(map, false);
        let footprint = self.wkb(
            &atlas_map::regions::as_geometry(&r.footprint),
            self.precision(map)?,
        )?;
        let scale = &r.region_scale;
        self.execute(
            "INSERT INTO map.revisions(map_id,revision,expected_revision,complete,world_id,name,
             primary_space_id,profile,region_level,region_next_area,region_subdivision,
             region_minimum_width,region_enabled,footprint,bounds,parent_map_id,parent_revision,
             real_scale) VALUES($1,$2,$3,false,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             ST_GeomFromWKB($13,0),$14,$15,$16,$17)",
            &[
                &uuid(r.reference.map_id),
                &uuid(r.reference.revision),
                &expected.map(uuid),
                &uuid(r.world_id),
                &r.name,
                &uuid(r.primary_space_id),
                &r.profile,
                &i32::try_from(scale.level).map_err(io::Error::other)?,
                &scale.next_area,
                &scale.subdivision,
                &scale.minimum_width,
                &scale.enabled,
                &footprint,
                &bounds(r.bounds),
                &r.parent.as_ref().map(|p| uuid(p.map_id)),
                &r.parent.as_ref().map(|p| uuid(p.revision)),
                &real_scale(&r)?,
            ],
        )?;
        self.write_spaces(&map.reference, &map.spaces)?;
        self.write_layers(&map.reference, &map.layers, 0)
    }
    /// The revision's settings and layout after an edit: its spaces and layers are written
    /// again, since a change may lay out new levels.
    pub(super) fn replace_description(&self, map: &MapDescriptor) -> io::Result<()> {
        let r = &map.reference;
        let revision = rows::revision(map, false);
        self.execute(
            "UPDATE map.revisions SET name=$3,real_scale=$4 WHERE map_id=$1 AND revision=$2",
            &[
                &uuid(r.map_id),
                &uuid(r.revision),
                &map.name,
                &real_scale(&revision)?,
            ],
        )?;
        for table in ["map.layers", "map.spaces"] {
            self.execute(
                &format!("DELETE FROM {table} WHERE map_id=$1 AND revision=$2"),
                &[&uuid(r.map_id), &uuid(r.revision)],
            )?;
        }
        self.write_spaces(r, &map.spaces)?;
        self.write_layers(r, &map.layers, 0)
    }
    pub(super) fn complete_revision(&self, r: &MapRef) -> io::Result<()> {
        self.execute(
            "UPDATE map.revisions SET complete=true WHERE map_id=$1 AND revision=$2",
            &[&uuid(r.map_id), &uuid(r.revision)],
        )?;
        Ok(())
    }
    /// The number the next added layer takes.
    pub(super) fn next_layer(&self, r: &MapRef) -> io::Result<i32> {
        let row = self.query(
            "SELECT coalesce(max(ordinal)+1,0) AS next FROM map.layers WHERE map_id=$1 AND revision=$2",
            &[&uuid(r.map_id), &uuid(r.revision)],
        )?;
        row.first()
            .ok_or_else(|| io::Error::other("Missing layer count"))?
            .try_get("next")
            .map_err(io::Error::other)
    }
    fn write_spaces(&self, r: &MapRef, spaces: &[MapSpace]) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let sink = db
            .copy_in("COPY map.spaces(map_id,revision,ordinal,id,parent_space_id,bounds,metres_per_unit,precision,periodic_width,origin,rotation,floor) FROM STDIN BINARY")
            .map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::INT4,
            Type::UUID,
            Type::UUID,
            Type::FLOAT8_ARRAY,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::FLOAT8_ARRAY,
            Type::FLOAT8,
            Type::TEXT,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        let (map, revision) = (uuid(r.map_id), uuid(r.revision));
        for (ordinal, space) in spaces.iter().enumerate() {
            let ordinal = i32::try_from(ordinal).map_err(io::Error::other)?;
            let (id, parent) = (uuid(space.id), space.parent_space_id.map(uuid));
            let (b, origin) = (bounds(space.bounds), space.frame.origin.to_vec());
            let row: Values = vec![
                &map,
                &revision,
                &ordinal,
                &id,
                &parent,
                &b,
                &space.metres_per_unit,
                &space.precision,
                &space.periodic_width,
                &origin,
                &space.frame.rotation,
                &space.frame.floor,
            ];
            writer.write(&row).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    /// Layers and their bands, categories, feature types and properties, numbered from
    /// `first`. Adding layers writes only the new rows.
    pub(super) fn write_layers(
        &self,
        r: &MapRef,
        layers: &[MapLayer],
        first: i32,
    ) -> io::Result<()> {
        let rows = layer_rows(layers, first)?;
        let (map, revision) = (uuid(r.map_id), uuid(r.revision));
        self.copy_layers(map, revision, &rows.layers)?;
        self.copy_bands(map, revision, &rows.bands)?;
        self.copy_categories(map, revision, &rows.categories)?;
        self.copy_feature_types(map, revision, &rows.feature_types)?;
        self.copy_properties(map, revision, &rows.properties)
    }
    fn copy_layers(
        &self,
        map: uuid::Uuid,
        revision: uuid::Uuid,
        layers: &[LayerRow],
    ) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let sink = db.copy_in("COPY map.layers(map_id,revision,ordinal,id,space_id,name,bounds,attribution,source,asset_id,media_type,width,height,cell_span,overviews,band_indices,path,common,default_style,presets,examples,geometries) FROM STDIN BINARY").map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::INT4,
            Type::TEXT,
            Type::UUID,
            Type::TEXT,
            Type::FLOAT8_ARRAY,
            Type::TEXT_ARRAY,
            Type::INT2,
            Type::TEXT,
            Type::TEXT,
            Type::INT4,
            Type::INT4,
            Type::FLOAT8,
            Type::TEXT_ARRAY,
            Type::INT2_ARRAY,
            Type::TEXT_ARRAY,
            Type::BOOL,
            Type::JSONB,
            Type::TEXT_ARRAY,
            Type::UUID_ARRAY,
            Type::INT2_ARRAY,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for l in layers {
            let space = uuid(l.space_id);
            let b = bounds(l.bounds);
            let source = l.source.code();
            let (width, height) = (
                l.width
                    .map(i32::try_from)
                    .transpose()
                    .map_err(io::Error::other)?,
                l.height
                    .map(i32::try_from)
                    .transpose()
                    .map_err(io::Error::other)?,
            );
            let indices = l
                .band_indices
                .iter()
                .map(|&i| i16::try_from(i).map_err(io::Error::other))
                .collect::<io::Result<Vec<_>>>()?;
            let style = l
                .default_style
                .as_ref()
                .map(serde_json::to_value)
                .transpose()?;
            let examples = l.examples.iter().copied().map(uuid).collect::<Vec<_>>();
            let geometries = codes(&l.geometries);
            let row: Values = vec![
                &map,
                &revision,
                &l.ordinal,
                &l.id,
                &space,
                &l.name,
                &b,
                &l.attribution,
                &source,
                &l.asset_id,
                &l.media_type,
                &width,
                &height,
                &l.cell_span,
                &l.overviews,
                &indices,
                &l.path,
                &l.common,
                &style,
                &l.presets,
                &examples,
                &geometries,
            ];
            writer.write(&row).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    fn copy_bands(
        &self,
        map: uuid::Uuid,
        revision: uuid::Uuid,
        bands: &[BandRow],
    ) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let sink = db.copy_in("COPY map.bands(map_id,revision,layer,ordinal,id,name,unit,display_unit,display_factor,nodata,range_low,range_high) FROM STDIN BINARY").map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::INT4,
            Type::INT4,
            Type::TEXT,
            Type::TEXT,
            Type::TEXT,
            Type::TEXT,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::FLOAT8,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for b in bands {
            let (low, high) = (b.range.map(|r| r.0), b.range.map(|r| r.1));
            let row: Values = vec![
                &map,
                &revision,
                &b.layer,
                &b.ordinal,
                &b.id,
                &b.name,
                &b.unit,
                &b.display_unit,
                &b.display_factor,
                &b.nodata,
                &low,
                &high,
            ];
            writer.write(&row).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    fn copy_categories(
        &self,
        map: uuid::Uuid,
        revision: uuid::Uuid,
        categories: &[CategoryRow],
    ) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let sink = db.copy_in("COPY map.categories(map_id,revision,layer,band,ordinal,value,label,color,present,soluble,bathymetric,tint,system,system_name) FROM STDIN BINARY").map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::INT4,
            Type::INT4,
            Type::INT4,
            Type::INT4,
            Type::TEXT,
            Type::TEXT,
            Type::BOOL,
            Type::BOOL,
            Type::BOOL,
            Type::FLOAT8,
            Type::TEXT,
            Type::TEXT,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for c in categories {
            let k = &c.category;
            let (bathymetric, tint, system, system_name) = surface_parts(k.surface.as_ref());
            let row: Values = vec![
                &map,
                &revision,
                &c.layer,
                &c.band,
                &c.ordinal,
                &k.value,
                &k.label,
                &k.color,
                &k.present,
                &k.soluble,
                &bathymetric,
                &tint,
                &system,
                &system_name,
            ];
            writer.write(&row).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    fn copy_feature_types(
        &self,
        map: uuid::Uuid,
        revision: uuid::Uuid,
        types_: &[FeatureTypeRow],
    ) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let sink = db.copy_in("COPY map.feature_types(map_id,revision,layer,ordinal,id,kind,label,path,magic_depiction,count,geometries,footprints,size_least,size_typical,size_largest,size_elongation,size_round) FROM STDIN BINARY").map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::INT4,
            Type::INT4,
            Type::TEXT,
            Type::TEXT,
            Type::TEXT,
            Type::TEXT_ARRAY,
            Type::INT2,
            Type::INT4,
            Type::INT2_ARRAY,
            Type::BOOL,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::FLOAT8,
            Type::BOOL,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for t in types_ {
            let f = &t.feature_type;
            let depiction = f.magic_depiction.map(Code::code);
            let count = i32::try_from(f.count).map_err(io::Error::other)?;
            let geometries = codes(&f.geometries);
            let [least, typical, largest, elongation] = size_parts(f.true_size);
            let round = f.true_size.map(|s| s.round);
            let row: Values = vec![
                &map,
                &revision,
                &t.layer,
                &t.ordinal,
                &f.id,
                &f.kind,
                &f.label,
                &f.path,
                &depiction,
                &count,
                &geometries,
                &f.footprints,
                &least,
                &typical,
                &largest,
                &elongation,
                &round,
            ];
            writer.write(&row).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    fn copy_properties(
        &self,
        map: uuid::Uuid,
        revision: uuid::Uuid,
        properties: &[PropertyRow],
    ) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let sink = db
            .copy_in("COPY map.layer_properties(map_id,revision,layer,name,kind) FROM STDIN BINARY")
            .map_err(super::database_error)?;
        let types = [Type::UUID, Type::UUID, Type::INT4, Type::TEXT, Type::INT2];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for p in properties {
            let kind = p.kind.code();
            let row: Values = vec![&map, &revision, &p.layer, &p.name, &kind];
            writer.write(&row).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    /// The stored map description and the revision it was published to replace.
    pub(super) fn read_description(&self, r: &MapRef) -> io::Result<(MapDescriptor, Option<Id>)> {
        let (map, revision) = (uuid(r.map_id), uuid(r.revision));
        let params: [&(dyn ToSql + Sync); 2] = [&map, &revision];
        let row = self
            .query(
                "SELECT *,ST_AsBinary(footprint) AS footprint_wkb FROM map.revisions WHERE map_id=$1 AND revision=$2",
                &params,
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map revision was not found"))?;
        let expected = get::<Option<uuid::Uuid>>(&row, "expected_revision")?.map(super::id);
        let revision = self.revision_row(r, &row)?;
        let spaces = self
            .query(
                "SELECT * FROM map.spaces WHERE map_id=$1 AND revision=$2 ORDER BY ordinal",
                &params,
            )?
            .iter()
            .map(space)
            .collect::<io::Result<Vec<_>>>()?;
        let rows = LayerRows {
            layers: self
                .query(
                    "SELECT * FROM map.layers WHERE map_id=$1 AND revision=$2",
                    &params,
                )?
                .iter()
                .map(layer)
                .collect::<io::Result<_>>()?,
            bands: self
                .query(
                    "SELECT * FROM map.bands WHERE map_id=$1 AND revision=$2",
                    &params,
                )?
                .iter()
                .map(band)
                .collect::<io::Result<_>>()?,
            categories: self
                .query(
                    "SELECT * FROM map.categories WHERE map_id=$1 AND revision=$2",
                    &params,
                )?
                .iter()
                .map(category)
                .collect::<io::Result<_>>()?,
            feature_types: self
                .query(
                    "SELECT * FROM map.feature_types WHERE map_id=$1 AND revision=$2",
                    &params,
                )?
                .iter()
                .map(feature_type_row)
                .collect::<io::Result<_>>()?,
            properties: self
                .query(
                    "SELECT * FROM map.layer_properties WHERE map_id=$1 AND revision=$2",
                    &params,
                )?
                .iter()
                .map(|row| {
                    Ok(PropertyRow {
                        layer: get(row, "layer")?,
                        name: get(row, "name")?,
                        kind: Code::from_code(get(row, "kind")?)?,
                    })
                })
                .collect::<io::Result<_>>()?,
        };
        Ok((assemble(revision, spaces, rows)?, expected))
    }
    /// One coordinate space of a stored map, without assembling the whole description.
    pub(super) fn read_space(&self, r: &MapRef, space_id: Id) -> io::Result<MapSpace> {
        let row = self
            .query(
                "SELECT * FROM map.spaces WHERE map_id=$1 AND revision=$2 AND id=$3",
                &[&uuid(r.map_id), &uuid(r.revision), &uuid(space_id)],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Coordinate space was not found in this map"))?;
        space(&row)
    }
    fn revision_row(&self, r: &MapRef, row: &Row) -> io::Result<Revision> {
        let footprint: Vec<u8> = get(row, "footprint_wkb")?;
        let footprint = atlas_map::regions::as_region(self.geometry.decode(&footprint)?)
            .map_err(io::Error::other)?;
        let parent = match (
            get::<Option<uuid::Uuid>>(row, "parent_map_id")?,
            get::<Option<uuid::Uuid>>(row, "parent_revision")?,
        ) {
            (Some(map_id), Some(revision)) => Some(MapRef {
                map_id: super::id(map_id),
                revision: super::id(revision),
            }),
            _ => None,
        };
        Ok(Revision {
            reference: r.clone(),
            world_id: super::id(get(row, "world_id")?),
            name: get(row, "name")?,
            primary_space_id: super::id(get(row, "primary_space_id")?),
            profile: get(row, "profile")?,
            region_scale: RegionScale {
                level: u32::try_from(get::<i32>(row, "region_level")?).map_err(io::Error::other)?,
                next_area: get(row, "region_next_area")?,
                subdivision: get(row, "region_subdivision")?,
                minimum_width: get(row, "region_minimum_width")?,
                enabled: get(row, "region_enabled")?,
            },
            footprint,
            bounds: bounds_from(&get::<Vec<f64>>(row, "bounds")?)?,
            parent,
            complete: get(row, "complete")?,
            real_scale: get::<Option<serde_json::Value>>(row, "real_scale")?
                .map(serde_json::from_value)
                .transpose()?,
        })
    }
    fn precision(&self, map: &MapDescriptor) -> io::Result<f64> {
        crate::map_store::space(map, map.primary_space_id).map(|s| s.precision)
    }
    /// WKB of a shape already checked and reduced at the map's precision.
    pub(super) fn wkb(&self, shape: &atlas_map::Geometry, precision: f64) -> io::Result<Vec<u8>> {
        Ok(self.geometry.encode(shape, precision)?.bytes)
    }
}
pub(super) fn get<'a, T: postgres::types::FromSql<'a>>(
    row: &'a Row,
    column: &str,
) -> io::Result<T> {
    row.try_get(column).map_err(io::Error::other)
}
fn real_scale(r: &Revision) -> io::Result<Option<serde_json::Value>> {
    r.real_scale
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(io::Error::other)
}
pub(super) fn bounds(b: Bounds) -> Vec<f64> {
    vec![b.0, b.1, b.2, b.3]
}
pub(super) fn bounds_from(values: &[f64]) -> io::Result<Bounds> {
    match values {
        &[w, s, e, n] => Ok(Bounds(w, s, e, n)),
        _ => Err(io::Error::other("Stored bounds need four values")),
    }
}
fn space(row: &Row) -> io::Result<MapSpace> {
    let origin: Vec<f64> = get(row, "origin")?;
    Ok(MapSpace {
        id: super::id(get(row, "id")?),
        parent_space_id: get::<Option<uuid::Uuid>>(row, "parent_space_id")?.map(super::id),
        bounds: bounds_from(&get::<Vec<f64>>(row, "bounds")?)?,
        metres_per_unit: get(row, "metres_per_unit")?,
        precision: get(row, "precision")?,
        periodic_width: get(row, "periodic_width")?,
        frame: MapFrame {
            origin: origin
                .try_into()
                .map_err(|_| io::Error::other("A space origin needs three values"))?,
            rotation: get(row, "rotation")?,
            floor: get(row, "floor")?,
        },
    })
}
fn layer(row: &Row) -> io::Result<LayerRow> {
    Ok(LayerRow {
        ordinal: get(row, "ordinal")?,
        id: get(row, "id")?,
        space_id: super::id(get(row, "space_id")?),
        name: get(row, "name")?,
        bounds: bounds_from(&get::<Vec<f64>>(row, "bounds")?)?,
        attribution: get(row, "attribution")?,
        source: SourceKind::from_code(get(row, "source")?)?,
        asset_id: get(row, "asset_id")?,
        media_type: get(row, "media_type")?,
        width: get::<Option<i32>>(row, "width")?
            .map(u32::try_from)
            .transpose()
            .map_err(io::Error::other)?,
        height: get::<Option<i32>>(row, "height")?
            .map(u32::try_from)
            .transpose()
            .map_err(io::Error::other)?,
        cell_span: get(row, "cell_span")?,
        overviews: get(row, "overviews")?,
        band_indices: get::<Vec<i16>>(row, "band_indices")?
            .into_iter()
            .map(|i| u16::try_from(i).map_err(io::Error::other))
            .collect::<io::Result<_>>()?,
        path: get(row, "path")?,
        common: get(row, "common")?,
        default_style: get::<Option<serde_json::Value>>(row, "default_style")?
            .map(serde_json::from_value)
            .transpose()?,
        presets: get(row, "presets")?,
        examples: get::<Vec<uuid::Uuid>>(row, "examples")?
            .into_iter()
            .map(super::id)
            .collect(),
        geometries: from_codes(&get::<Vec<i16>>(row, "geometries")?)?,
    })
}
fn band(row: &Row) -> io::Result<BandRow> {
    let range = match (get(row, "range_low")?, get(row, "range_high")?) {
        (Some(low), Some(high)) => Some((low, high)),
        _ => None,
    };
    Ok(BandRow {
        layer: get(row, "layer")?,
        ordinal: get(row, "ordinal")?,
        id: get(row, "id")?,
        name: get(row, "name")?,
        unit: get(row, "unit")?,
        display_unit: get(row, "display_unit")?,
        display_factor: get(row, "display_factor")?,
        nodata: get(row, "nodata")?,
        range,
    })
}
fn category(row: &Row) -> io::Result<CategoryRow> {
    Ok(CategoryRow {
        layer: get(row, "layer")?,
        band: get(row, "band")?,
        ordinal: get(row, "ordinal")?,
        category: Category {
            value: get(row, "value")?,
            label: get(row, "label")?,
            color: get(row, "color")?,
            surface: surface_from(
                get(row, "bathymetric")?,
                get(row, "tint")?,
                get(row, "system")?,
                get(row, "system_name")?,
            ),
            present: get(row, "present")?,
            soluble: get(row, "soluble")?,
        },
    })
}
pub(super) fn feature_type_row(row: &Row) -> io::Result<FeatureTypeRow> {
    Ok(FeatureTypeRow {
        layer: get(row, "layer")?,
        ordinal: get(row, "ordinal")?,
        feature_type: MapFeatureType {
            id: get(row, "id")?,
            kind: get(row, "kind")?,
            label: get(row, "label")?,
            path: get(row, "path")?,
            magic_depiction: get::<Option<i16>>(row, "magic_depiction")?
                .map(Code::from_code)
                .transpose()?,
            count: u32::try_from(get::<i32>(row, "count")?).map_err(io::Error::other)?,
            geometries: from_codes(&get::<Vec<i16>>(row, "geometries")?)?,
            footprints: get(row, "footprints")?,
            true_size: size_from(
                [
                    get(row, "size_least")?,
                    get(row, "size_typical")?,
                    get(row, "size_largest")?,
                    get(row, "size_elongation")?,
                ],
                get(row, "size_round")?,
            ),
        },
    })
}
