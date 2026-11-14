//! One normal geographic publication path for both execution hosts.
use super::State;
use crate::features::geographic_identity::{self, Original, Working};
use crate::field::{
    geographic_contours,
    landmarks::lifecycle::Operations,
    poi::{
        self,
        kinds::{Group, Kind},
        publication::Publication,
        realized::RealizationState,
        values::Moment,
    },
};
use serde::{Deserialize, Serialize};
use std::{io, rc::Rc};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Deliveries {
    pub oceans: bool,
    pub impacts: bool,
    pub volcanism: bool,
    pub fractures: bool,
    pub lakes: bool,
    pub landforms: bool,
    pub ecology: bool,
    pub rivers: bool,
    pub landmarks: bool,
}
impl Default for Deliveries {
    fn default() -> Self {
        Self {
            oceans: true,
            impacts: true,
            volcanism: true,
            fractures: true,
            lakes: true,
            landforms: true,
            ecology: true,
            rivers: true,
            landmarks: true,
        }
    }
}
impl Deliveries {
    fn kind(self, kind: Kind) -> bool {
        if kind.group() == Group::Cover || kind == Kind::Wetland {
            self.ecology
        } else if kind == Kind::Lake {
            self.lakes
        } else if matches!(kind, Kind::Volcano | Kind::Caldera) {
            self.volcanism
        } else {
            self.landforms
        }
    }
}
impl State {
    pub fn retain_geographic_identities(
        &mut self,
        original: &Original<'_>,
        generated: &[String],
    ) -> io::Result<()> {
        let tolerance = self.field().mesh().spacing() * 2.0;
        geographic_identity::retain(
            &mut Working {
                features: self.records.features.as_mut(),
                networks: self.records.networks.as_mut(),
            },
            original,
            &self.scope.area,
            tolerance,
            generated,
            self.spatial.as_ref(),
        )
    }
    pub fn finish_geography(
        &mut self,
        job: GeographicPublication<'_>,
        progress: impl FnMut(f64, &str),
    ) -> io::Result<()> {
        let before = geographic_identity::revisions(self.records.features.as_ref())?;
        self.extract_geography(job.deliveries, job.publication, job.landmarks, progress)?;
        let generated = geographic_identity::changed(self.records.features.as_ref(), &before)?;
        self.retain_geographic_identities(job.original, &generated)
    }
    pub fn finish_magic_places(
        &mut self,
        publication: &mut Publication,
        original: &Original<'_>,
        mut progress: impl FnMut(f64, &str),
    ) -> io::Result<()> {
        progress(0.0, "Extracting magical places");
        let before = geographic_identity::revisions(self.records.features.as_ref())?;
        self.extract_magic_places(publication)?;
        let generated = geographic_identity::changed(self.records.features.as_ref(), &before)?;
        self.retain_geographic_identities(original, &generated)?;
        progress(1.0, "Magical places extracted");
        Ok(())
    }
    pub fn extract_geography(
        &mut self,
        deliveries: Deliveries,
        publication: &mut Publication,
        landmarks: &Rc<Operations>,
        mut progress: impl FnMut(f64, &str),
    ) -> io::Result<()> {
        progress(0.0, "Tracing ocean shoreline");
        self.physical.ocean = geographic_contours::ocean_footprint(self)
            .map_err(|error| io::Error::other(format!("Ocean shoreline: {error}")))?;
        progress(0.1, "Extracting ocean regions");
        if deliveries.oceans {
            self.extract_oceans()
                .map_err(|error| io::Error::other(format!("Ocean regions: {error}")))?;
        }
        progress(0.2, "Extracting geological events and lakes");
        if deliveries.fractures {
            self.extract_faults()
                .map_err(|error| io::Error::other(format!("Faults: {error}")))?;
        }
        if deliveries.lakes {
            self.extract_lakes()
                .map_err(|error| io::Error::other(format!("Lakes: {error}")))?;
        }
        progress(0.35, "Extracting landforms");
        if deliveries.landforms {
            self.extract_ranges()
                .map_err(|error| io::Error::other(format!("Ranges: {error}")))?;
        }
        progress(0.5, "Publishing the map's places");
        let catalogue = self.catalogue.clone();
        publication
            .kinds(self, &catalogue, Moment::Geography, |entry| {
                deliveries.kind(entry.id)
            })
            .map_err(|error| io::Error::other(format!("Geographic places: {error}")))?;
        progress(0.8, "Extracting river geography");
        if deliveries.rivers {
            self.publish_rivers()
                .map_err(|error| io::Error::other(format!("Rivers: {error}")))?;
        } else {
            self.drainage = None;
        }
        if deliveries.landmarks {
            self.drop_claimed_features()?;
            self.extract_landmarks(landmarks)
                .map_err(|error| io::Error::other(format!("Landmarks: {error}")))?;
        }
        progress(1.0, "Geographic extraction complete");
        Ok(())
    }
    pub fn extract_magic_places(&mut self, publication: &mut Publication) -> io::Result<()> {
        if let Some(magic) = &self.physical.magic {
            let features =
                poi::records::confluence_records(self, &magic.borrow().meetings, &self.extent()?)?;
            for feature in features {
                self.write_feature(feature)?;
            }
        }
        self.publish_places(publication, Moment::Magic)
    }
}
pub struct GeographicPublication<'a> {
    pub deliveries: Deliveries,
    pub publication: &'a mut Publication,
    pub landmarks: &'a Rc<Operations>,
    pub original: &'a Original<'a>,
}
