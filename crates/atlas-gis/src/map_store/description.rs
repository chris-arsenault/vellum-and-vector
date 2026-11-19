//! A map description held as revision, space and layer rows in SQLite.
use super::MapStore;
use crate::rows::{
    self, assemble, codes, from_codes, layer_rows, size_from, size_parts, surface_from,
    surface_parts, BandRow, CategoryRow, Code, FeatureTypeRow, LayerRow, LayerRows, PropertyRow,
    Revision, SourceKind,
};
use crate::sql::{column, Row, Value};
use atlas_map::{
    regions::{as_geometry, as_region},
    Bounds, Category, Id, MapDescriptor, MapFeatureType, MapFrame, MapLayer, MapRef, MapSpace,
    RegionScale,
};
use serde::{de::DeserializeOwned, Serialize};
use std::io;

/// A short list of values packed as CBOR.
pub(super) fn pack(value: &impl Serialize) -> io::Result<Value> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes).map_err(io::Error::other)?;
    Ok(Value::Blob(bytes))
}
pub(super) fn unpack<T: DeserializeOwned>(value: &Value) -> io::Result<T> {
    ciborium::from_reader(value.bytes()?).map_err(io::Error::other)
}
pub(super) fn key(r: &MapRef) -> Vec<Value> {
    vec![r.map_id.into(), r.revision.into()]
}
fn bounds_values(b: Bounds) -> [Value; 4] {
    [b.0.into(), b.1.into(), b.2.into(), b.3.into()]
}
fn bounds_of(row: &Row) -> io::Result<Bounds> {
    Ok(Bounds(
        column(row, "min_x")?.real()?,
        column(row, "min_y")?.real()?,
        column(row, "max_x")?.real()?,
        column(row, "max_y")?.real()?,
    ))
}
fn json_text(value: &impl Serialize) -> io::Result<Value> {
    Ok(serde_json::to_string(value)?.into())
}
fn small(value: i64) -> io::Result<i16> {
    i16::try_from(value).map_err(io::Error::other)
}
fn int(value: i64) -> io::Result<i32> {
    i32::try_from(value).map_err(io::Error::other)
}
impl MapStore {
    pub(super) fn write_revision(
        &self,
        map: &MapDescriptor,
        expected: Option<Id>,
    ) -> io::Result<()> {
        let r = rows::revision(map, false);
        let precision = super::space(map, map.primary_space_id)?.precision;
        let footprint = self
            .geometry
            .encode(&as_geometry(&r.footprint), precision)?
            .bytes;
        let scale = &r.region_scale;
        let mut values = key(&r.reference);
        values.extend([
            expected.into(),
            r.world_id.into(),
            r.name.clone().into(),
            r.primary_space_id.into(),
            r.profile.clone().into(),
            i64::from(scale.level).into(),
            scale.next_area.into(),
            scale.subdivision.into(),
            scale.minimum_width.into(),
            scale.enabled.into(),
            footprint.into(),
        ]);
        values.extend(bounds_values(r.bounds));
        values.extend([
            r.parent.as_ref().map(|p| p.map_id).into(),
            r.parent.as_ref().map(|p| p.revision).into(),
            r.real_scale.as_ref().map(json_text).transpose()?.into(),
        ]);
        self.db.execute(
            "INSERT INTO maps(map_id,revision,expected_revision,world_id,name,primary_space_id,profile,
             region_level,region_next_area,region_subdivision,region_minimum_width,region_enabled,
             footprint,min_x,min_y,max_x,max_y,parent_map_id,parent_revision,real_scale)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            &values,
        )?;
        self.write_spaces(&map.reference, &map.spaces)?;
        self.write_layers(&map.reference, &map.layers, 0)
    }
    /// The revision's settings and layout after an edit.
    pub(super) fn replace_description(&self, map: &MapDescriptor) -> io::Result<()> {
        let r = &map.reference;
        let mut values = vec![
            map.name.clone().into(),
            map.real_scale.as_ref().map(json_text).transpose()?.into(),
        ];
        values.extend(key(r));
        self.db.execute(
            "UPDATE maps SET name=?,real_scale=? WHERE map_id=? AND revision=?",
            &values,
        )?;
        for table in ["map_layers", "map_spaces"] {
            self.db.execute(
                &format!("DELETE FROM {table} WHERE map_id=? AND revision=?"),
                &key(r),
            )?;
        }
        self.write_spaces(r, &map.spaces)?;
        self.write_layers(r, &map.layers, 0)
    }
    pub(super) fn next_layer(&self, r: &MapRef) -> io::Result<i32> {
        let next = self.db.value(
            "SELECT coalesce(max(ordinal)+1,0) FROM map_layers WHERE map_id=? AND revision=?",
            &key(r),
        )?;
        int(next.map_or(Ok(0), |v| v.integer())?)
    }
    fn write_spaces(&self, r: &MapRef, spaces: &[MapSpace]) -> io::Result<()> {
        for (ordinal, space) in spaces.iter().enumerate() {
            let mut values = key(r);
            values.extend([
                (ordinal as i64).into(),
                space.id.into(),
                space.parent_space_id.into(),
            ]);
            values.extend(bounds_values(space.bounds));
            let [x, y, z] = space.frame.origin;
            values.extend([
                space.metres_per_unit.into(),
                space.precision.into(),
                space.periodic_width.into(),
                x.into(),
                y.into(),
                z.into(),
                space.frame.rotation.into(),
                space.frame.floor.clone().into(),
            ]);
            self.db.execute(
                "INSERT INTO map_spaces VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                &values,
            )?;
        }
        Ok(())
    }
    pub(super) fn write_layers(
        &self,
        r: &MapRef,
        layers: &[MapLayer],
        first: i32,
    ) -> io::Result<()> {
        let rows = layer_rows(layers, first)?;
        for l in &rows.layers {
            self.insert_layer(r, l)?;
        }
        for b in &rows.bands {
            let mut values = key(r);
            values.extend([
                i64::from(b.layer).into(),
                i64::from(b.ordinal).into(),
                b.id.clone().into(),
                b.name.clone().into(),
                b.unit.clone().into(),
                b.display_unit.clone().into(),
                b.display_factor.into(),
                b.nodata.into(),
                b.range.map(|r| r.0).into(),
                b.range.map(|r| r.1).into(),
            ]);
            self.db.execute(
                "INSERT INTO map_bands VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                &values,
            )?;
        }
        for c in &rows.categories {
            let k = &c.category;
            let (bathymetric, tint, system, system_name) = surface_parts(k.surface.as_ref());
            let mut values = key(r);
            values.extend([
                i64::from(c.layer).into(),
                i64::from(c.band).into(),
                i64::from(c.ordinal).into(),
                i64::from(k.value).into(),
                k.label.clone().into(),
                k.color.clone().into(),
                k.present.into(),
                k.soluble.into(),
                bathymetric.into(),
                tint.into(),
                system.into(),
                system_name.into(),
            ]);
            self.db.execute(
                "INSERT INTO map_categories VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                &values,
            )?;
        }
        for t in &rows.feature_types {
            self.insert_feature_type(r, t)?;
        }
        for p in &rows.properties {
            let mut values = key(r);
            values.extend([
                i64::from(p.layer).into(),
                p.name.clone().into(),
                i64::from(p.kind.code()).into(),
            ]);
            self.db.execute(
                "INSERT INTO map_layer_properties VALUES(?,?,?,?,?)",
                &values,
            )?;
        }
        Ok(())
    }
    fn insert_layer(&self, r: &MapRef, l: &LayerRow) -> io::Result<()> {
        let mut values = key(r);
        values.extend([
            i64::from(l.ordinal).into(),
            l.id.clone().into(),
            l.space_id.into(),
            l.name.clone().into(),
        ]);
        values.extend(bounds_values(l.bounds));
        values.extend([
            pack(&l.attribution)?,
            i64::from(l.source.code()).into(),
            l.asset_id.clone().into(),
            l.media_type.clone().into(),
            l.width.map(i64::from).into(),
            l.height.map(i64::from).into(),
            l.cell_span.into(),
            pack(&l.overviews)?,
            pack(&l.band_indices)?,
            pack(&l.path)?,
            l.common.into(),
            l.default_style.as_ref().map(json_text).transpose()?.into(),
            pack(&l.presets)?,
            pack(
                &l.examples
                    .iter()
                    .map(|id| id.to_bytes())
                    .collect::<Vec<_>>(),
            )?,
            pack(&codes(&l.geometries))?,
        ]);
        self.db.execute(
            "INSERT INTO map_layers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            &values,
        )?;
        Ok(())
    }
    fn insert_feature_type(&self, r: &MapRef, t: &FeatureTypeRow) -> io::Result<()> {
        let f = &t.feature_type;
        let [least, typical, largest, elongation] = size_parts(f.true_size);
        let mut values = key(r);
        values.extend([
            i64::from(t.layer).into(),
            i64::from(t.ordinal).into(),
            f.id.clone().into(),
            f.kind.clone().into(),
            f.label.clone().into(),
            pack(&f.path)?,
            f.magic_depiction.map(|d| i64::from(d.code())).into(),
            i64::from(f.count).into(),
            pack(&codes(&f.geometries))?,
            f.footprints.into(),
            least.into(),
            typical.into(),
            largest.into(),
            elongation.into(),
            f.true_size.map(|s| s.round).into(),
            f.path.join(" ").into(),
        ]);
        self.db.execute(
            "INSERT INTO map_feature_types VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            &values,
        )?;
        Ok(())
    }
    /// The stored map description and the revision it was published to replace.
    pub(super) fn read_description(&self, r: &MapRef) -> io::Result<(MapDescriptor, Option<Id>)> {
        let row = self
            .db
            .query("SELECT * FROM maps WHERE map_id=? AND revision=?", &key(r))?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map revision was not found"))?;
        let expected = column(&row, "expected_revision")?.optional_id()?;
        let revision = self.revision_row(r, &row)?;
        let select = |table: &str, order: &str| {
            self.db.query(
                &format!("SELECT * FROM {table} WHERE map_id=? AND revision=?{order}"),
                &key(r),
            )
        };
        let spaces = select("map_spaces", " ORDER BY ordinal")?
            .iter()
            .map(space)
            .collect::<io::Result<Vec<_>>>()?;
        let rows = LayerRows {
            layers: select("map_layers", "")?
                .iter()
                .map(layer)
                .collect::<io::Result<_>>()?,
            bands: select("map_bands", "")?
                .iter()
                .map(band)
                .collect::<io::Result<_>>()?,
            categories: select("map_categories", "")?
                .iter()
                .map(category)
                .collect::<io::Result<_>>()?,
            feature_types: select("map_feature_types", "")?
                .iter()
                .map(feature_type_row)
                .collect::<io::Result<_>>()?,
            properties: select("map_layer_properties", "")?
                .iter()
                .map(|row| {
                    Ok(PropertyRow {
                        layer: int(column(row, "layer")?.integer()?)?,
                        name: column(row, "name")?.text()?.into(),
                        kind: Code::from_code(small(column(row, "kind")?.integer()?)?)?,
                    })
                })
                .collect::<io::Result<_>>()?,
        };
        Ok((assemble(revision, spaces, rows)?, expected))
    }
    /// One coordinate space of a stored map, without assembling the whole description.
    pub(super) fn read_space(&self, r: &MapRef, id: Id) -> io::Result<MapSpace> {
        let mut values = key(r);
        values.push(id.into());
        let row = self
            .db
            .query(
                "SELECT * FROM map_spaces WHERE map_id=? AND revision=? AND id=?",
                &values,
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Coordinate space was not found in this map"))?;
        space(&row)
    }
    fn revision_row(&self, r: &MapRef, row: &Row) -> io::Result<Revision> {
        let footprint = as_region(self.geometry.decode(column(row, "footprint")?.bytes()?)?)
            .map_err(io::Error::other)?;
        let parent = match (
            column(row, "parent_map_id")?.optional_id()?,
            column(row, "parent_revision")?.optional_id()?,
        ) {
            (Some(map_id), Some(revision)) => Some(MapRef { map_id, revision }),
            _ => None,
        };
        Ok(Revision {
            reference: r.clone(),
            world_id: column(row, "world_id")?.id()?,
            name: column(row, "name")?.text()?.into(),
            primary_space_id: column(row, "primary_space_id")?.id()?,
            profile: column(row, "profile")?.text()?.into(),
            region_scale: RegionScale {
                level: u32::try_from(column(row, "region_level")?.integer()?)
                    .map_err(io::Error::other)?,
                next_area: column(row, "region_next_area")?.real()?,
                subdivision: column(row, "region_subdivision")?.real()?,
                minimum_width: column(row, "region_minimum_width")?.real()?,
                enabled: column(row, "region_enabled")?.flag()?,
            },
            footprint,
            bounds: bounds_of(row)?,
            parent,
            complete: column(row, "complete")?.flag()?,
            real_scale: column(row, "real_scale")?
                .optional_text()?
                .map(|text| serde_json::from_str(&text))
                .transpose()?,
        })
    }
}
fn space(row: &Row) -> io::Result<MapSpace> {
    Ok(MapSpace {
        id: column(row, "id")?.id()?,
        parent_space_id: column(row, "parent_space_id")?.optional_id()?,
        bounds: bounds_of(row)?,
        metres_per_unit: column(row, "metres_per_unit")?.real()?,
        precision: column(row, "precision")?.real()?,
        periodic_width: column(row, "periodic_width")?.optional_real()?,
        frame: MapFrame {
            origin: [
                column(row, "origin_x")?.real()?,
                column(row, "origin_y")?.real()?,
                column(row, "origin_z")?.real()?,
            ],
            rotation: column(row, "rotation")?.real()?,
            floor: column(row, "floor")?.optional_text()?,
        },
    })
}
fn layer(row: &Row) -> io::Result<LayerRow> {
    let dimension = |name: &str| -> io::Result<Option<u32>> {
        column(row, name)?
            .optional_integer()?
            .map(|v| u32::try_from(v).map_err(io::Error::other))
            .transpose()
    };
    Ok(LayerRow {
        ordinal: int(column(row, "ordinal")?.integer()?)?,
        id: column(row, "id")?.text()?.into(),
        space_id: column(row, "space_id")?.id()?,
        name: column(row, "name")?.text()?.into(),
        bounds: bounds_of(row)?,
        attribution: unpack(column(row, "attribution")?)?,
        source: SourceKind::from_code(small(column(row, "source")?.integer()?)?)?,
        asset_id: column(row, "asset_id")?.optional_text()?,
        media_type: column(row, "media_type")?.optional_text()?,
        width: dimension("width")?,
        height: dimension("height")?,
        cell_span: column(row, "cell_span")?.optional_real()?,
        overviews: unpack(column(row, "overviews")?)?,
        band_indices: unpack(column(row, "band_indices")?)?,
        path: unpack(column(row, "path")?)?,
        common: column(row, "common")?.flag()?,
        default_style: column(row, "default_style")?
            .optional_text()?
            .map(|text| serde_json::from_str(&text))
            .transpose()?,
        presets: unpack(column(row, "presets")?)?,
        examples: unpack::<Vec<[u8; 16]>>(column(row, "examples")?)?
            .into_iter()
            .map(Id::from_bytes)
            .collect(),
        geometries: from_codes(&unpack::<Vec<i16>>(column(row, "geometries")?)?)?,
    })
}
fn band(row: &Row) -> io::Result<BandRow> {
    let range = match (
        column(row, "range_low")?.optional_real()?,
        column(row, "range_high")?.optional_real()?,
    ) {
        (Some(low), Some(high)) => Some((low, high)),
        _ => None,
    };
    Ok(BandRow {
        layer: int(column(row, "layer")?.integer()?)?,
        ordinal: int(column(row, "ordinal")?.integer()?)?,
        id: column(row, "id")?.text()?.into(),
        name: column(row, "name")?.text()?.into(),
        unit: column(row, "unit")?.text()?.into(),
        display_unit: column(row, "display_unit")?.text()?.into(),
        display_factor: column(row, "display_factor")?.real()?,
        nodata: column(row, "nodata")?.optional_real()?,
        range,
    })
}
fn category(row: &Row) -> io::Result<CategoryRow> {
    let optional_flag = |name: &str| -> io::Result<Option<bool>> {
        Ok(column(row, name)?.optional_integer()?.map(|v| v != 0))
    };
    Ok(CategoryRow {
        layer: int(column(row, "layer")?.integer()?)?,
        band: int(column(row, "band")?.integer()?)?,
        ordinal: int(column(row, "ordinal")?.integer()?)?,
        category: Category {
            value: int(column(row, "value")?.integer()?)?,
            label: column(row, "label")?.text()?.into(),
            color: column(row, "color")?.optional_text()?,
            surface: surface_from(
                optional_flag("bathymetric")?,
                column(row, "tint")?.optional_real()?,
                column(row, "system")?.optional_text()?,
                column(row, "system_name")?.optional_text()?,
            ),
            present: column(row, "present")?.flag()?,
            soluble: optional_flag("soluble")?,
        },
    })
}
pub(super) fn feature_type_row(row: &Row) -> io::Result<FeatureTypeRow> {
    Ok(FeatureTypeRow {
        layer: int(column(row, "layer")?.integer()?)?,
        ordinal: int(column(row, "ordinal")?.integer()?)?,
        feature_type: MapFeatureType {
            id: column(row, "id")?.text()?.into(),
            kind: column(row, "kind")?.text()?.into(),
            label: column(row, "label")?.text()?.into(),
            path: unpack(column(row, "path")?)?,
            magic_depiction: column(row, "magic_depiction")?
                .optional_integer()?
                .map(|c| small(c).and_then(Code::from_code))
                .transpose()?,
            count: u32::try_from(column(row, "count")?.integer()?).map_err(io::Error::other)?,
            geometries: from_codes(&unpack::<Vec<i16>>(column(row, "geometries")?)?)?,
            footprints: column(row, "footprints")?.flag()?,
            true_size: size_from(
                [
                    column(row, "size_least")?.optional_real()?,
                    column(row, "size_typical")?.optional_real()?,
                    column(row, "size_largest")?.optional_real()?,
                    column(row, "size_elongation")?.optional_real()?,
                ],
                column(row, "size_round")?
                    .optional_integer()?
                    .map(|v| v != 0),
            ),
        },
    })
}
