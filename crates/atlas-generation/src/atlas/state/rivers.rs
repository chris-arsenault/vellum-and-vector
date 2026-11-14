//! River publication keeps the complete private network and draws its map-scale courses.
mod drawing;
mod dry;
use super::State;
use crate::{
    features::{chart, FeatureSelection},
    field::{
        poi::river_courses,
        refinement::river_lineage,
        river_drawing::{Paths, WaterShapes},
        water::publication,
    },
    water::captured::DrainageNetwork,
};
use atlas_map::Bounds;
use std::io;

impl State {
    fn river_water(&self) -> io::Result<WaterShapes> {
        let grid = self.physical.surface.grid();
        let [w, s, e, n] = grid.bounds;
        let in_chart = |geometry: &atlas_map::Geometry| {
            chart::working(
                geometry,
                Bounds(w, s, e, n),
                grid.periodic_width,
                self.spatial.as_ref(),
            )
            .map_err(io::Error::other)
        };
        let mut water = WaterShapes {
            ocean: self.physical.ocean.as_ref().map(in_chart).transpose()?,
            ..Default::default()
        };
        for feature in self.records.features.values(FeatureSelection {
            area_id: Some(&self.scope.area),
            kind: Some("lake"),
            ..Default::default()
        })? {
            let feature = feature?;
            if let Some(body) = feature.attributes.get("waterBody").and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            }) {
                water
                    .lakes
                    .insert(body as i32, in_chart(&feature.geometry)?);
            }
        }
        for (&body, shape) in &self.physical.lake_outlines {
            water.lakes.insert(body, in_chart(shape)?);
        }
        Ok(water)
    }
    pub fn publish_rivers(&mut self) -> io::Result<()> {
        river_courses::rivers_of(self)?;
        let mut paths = Paths::new(self.field())?;
        paths.water = self.river_water()?;
        let discharges = river_courses::basin_discharges(self.field())?;
        let mut records = river_courses::kept_reaches(self.field())?;
        for river in river_courses::drawn(self.field(), self.scope.world_geography, &records) {
            let parts = river
                .parts
                .iter()
                .map(|part| {
                    part.iter()
                        .enumerate()
                        .flat_map(|(n, &i)| {
                            records[i].members.iter().skip(usize::from(n > 0)).copied()
                        })
                        .collect()
                })
                .collect::<Vec<_>>();
            let basin = records[river.parts[0][0]].reach.basin as usize;
            let (ids, key) = drawing::publish_course(
                self,
                &parts,
                &paths,
                discharges.get(basin)?,
                &river.river_id,
            )?;
            for id in &ids {
                if let Some(mut feature) = self.records.features.get(id)? {
                    feature
                        .attributes
                        .insert("riverId".into(), river.river_id.clone().into());
                    self.records.features.put(feature)?;
                }
            }
            for &i in river.parts.iter().flatten() {
                records[i].reach.feature_ids.clone_from(&ids);
            }
            if let Some(key) = key {
                if let Some(feature) = ids
                    .first()
                    .map(|id| self.records.features.get(id))
                    .transpose()?
                    .flatten()
                {
                    self.physical
                        .executor
                        .run_with(
                            &publication::associate(),
                            &vec![publication::RiverPublication {
                                river: river.river_id.clone(),
                                record: Some(key),
                                name: feature.name,
                            }],
                        )
                        .map_err(|e| io::Error::other(format!("{e:?}")))?;
                }
            }
            let kept = river
                .parts
                .iter()
                .flatten()
                .map(|&i| &records[i].kept)
                .collect::<Vec<_>>();
            dry::former(
                self,
                &kept,
                ids.first().map(String::as_str),
                &river.river_id,
            )?;
        }
        drop(paths);
        drop(discharges);
        dry::publish(self)?;
        self.drainage = Some(DrainageNetwork {
            area_id: self.scope.area.clone(),
            space_id: self.scope.space.clone(),
            reaches: records.into_iter().map(|r| r.reach).collect(),
            kept: Some(self.field().capture_rivers()),
            input: false,
        });
        self.causes.push(crate::atlas::history::Cause::Domain { process: "atlas.geographic-extraction".into(), subjects: Vec::new(), description: "Current and former river courses appear under their retained names, with present water and terrain.".into() });
        Ok(())
    }
    pub fn adopt_rivers(&mut self) -> io::Result<()> {
        if self
            .regional
            .as_ref()
            .is_some_and(|r| r.continuing_rivers.is_none())
        {
            let rivers = river_lineage::continuing(
                self.field(),
                &self.regional.as_ref().unwrap().evidence.courses,
            )?;
            self.regional.as_mut().unwrap().continuing_rivers = Some(rivers);
        }
        if let Some(regional) = &self.regional {
            river_lineage::adopt(
                self.records.features.as_mut(),
                &self.scope.area,
                &regional.evidence.courses,
                regional.continuing_rivers.as_deref().unwrap_or_default(),
                &|id| self.scope.contracted.contains(id),
            )?;
        }
        self.retain_river_names()
    }
    pub fn retain_river_names(&mut self) -> io::Result<()> {
        if let Some(network) = &mut self.drainage {
            publication::retain_names(
                &mut self.physical.executor,
                &publication::associate(),
                self.records.features.as_mut(),
                &self.scope.area,
                network,
            )?;
        }
        Ok(())
    }
}
