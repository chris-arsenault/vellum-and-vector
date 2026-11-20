use super::State;
use crate::{
    features::{chart::Chart, publication::Named, records::Attributes, Feature, FeatureReader},
    field::{
        self,
        people::{
            events::Events,
            place_country::KnownWay,
            place_land::PlaceLand,
            places::{Place as KnownPlace, Places},
            traditions::Traditions,
            works::Works,
        },
        poi::{self, kinds::Kind, values::Place},
        refinement::causes::Schedule,
        Field,
    },
    magic::{confluences::configuration::ResolvedConfluence, state::MagicField},
    reconstruction::Grid,
    spatial::SpatialKernel,
    storage::ReadBand,
};
use atlas_map::Geometry;
use std::{cell::Ref, io};

impl poi::state::State for State {
    fn physical(&self) -> Option<&Field> {
        Some(self.field())
    }
    fn features(&self) -> &dyn FeatureReader {
        self.records.features.as_ref()
    }
    fn spatial(&self) -> &dyn SpatialKernel {
        self.spatial.as_ref()
    }
    fn magic(&self) -> Option<Ref<'_, [MagicField]>> {
        self.physical
            .magic
            .as_ref()
            .map(|m| Ref::map(m.borrow(), |m| m.fields.as_slice()))
    }
    fn held(&self) -> &poi::state::Held {
        &self.held
    }
    fn varieties(&self) -> &poi::variety::Varieties {
        &self.varieties
    }
    fn regional(&self) -> bool {
        self.regional.is_some()
    }
    fn places_recorded(&self) -> bool {
        self.people.places.borrow().recorded()
    }
}
impl poi::map_records::MapState for State {
    fn geometry_precision(&self) -> f64 {
        self.scope.precision
    }
    fn chart(&self) -> Chart<'_> {
        Chart {
            domain: &self.scope.domain,
            bounds: self.scope.domain_bounds,
            cylindrical: self.scope.cylindrical,
        }
    }
    fn footprint(&self) -> &Geometry {
        &self.scope.footprint
    }
    fn world_id(&self) -> atlas_map::Id {
        self.scope.world
    }
    fn area_id(&self) -> atlas_map::Id {
        self.scope.area
    }
    fn area_name(&self) -> &str {
        &self.scope.area_name
    }
    fn generation_domain(&self, layer: &str) -> Option<String> {
        self.scope.generation_domains.get(layer).cloned()
    }
    fn geographic_name(
        &self,
        key: &str,
        kind: &str,
        geometry: &Geometry,
        attributes: &Attributes,
    ) -> io::Result<Option<Named>> {
        self.naming
            .geographic(&self.scope, key, kind, geometry, attributes)
    }
    fn retained_feature_name(&self, id: atlas_map::Id) -> Option<&Named> {
        self.records.retained_names.get(&id)
    }
}
impl poi::river_courses::RiverState for State {
    fn world_geography(&self) -> bool {
        self.scope.world_geography
    }
}
impl poi::community_records::CommunityState for State {
    fn known_places(&self) -> Ref<'_, Places> {
        self.people.places.borrow()
    }
    fn traditions(&self) -> Ref<'_, Traditions> {
        Ref::map(self.people.memory.borrow(), |m| &m.traditions)
    }
    fn name_community(
        &self,
        place: &KnownPlace,
        land: &PlaceLand,
        language: Option<&str>,
    ) -> io::Result<Named> {
        self.naming.community(&self.scope, place, land, language)
    }
    fn regional_round(&self) -> usize {
        self.regional.as_ref().map_or(0, |r| r.round)
    }
    fn seat_cell(&self, feature: atlas_map::Id) -> Option<usize> {
        self.regional
            .as_ref()?
            .evidence
            .seats
            .iter()
            .find(|seat| seat.feature_id == feature)
            .map(|s| s.cell)
    }
}
impl poi::work_records::WorkState for State {
    fn known_events(&self) -> Ref<'_, Events> {
        self.people.events.borrow()
    }
    fn known_ways(&self) -> Ref<'_, [KnownWay]> {
        Ref::map(self.people.ways.borrow(), Vec::as_slice)
    }
    fn tradition_name(&self, code: i32) -> Option<String> {
        let memory = self.people.memory.borrow();
        memory
            .entities
            .get(&memory.traditions.get(code)?.entity)
            .map(|e| e.name.clone())
    }
}
impl poi::dam::DamState for State {
    fn known_works(&self) -> Ref<'_, Works> {
        self.people.works.borrow()
    }
    fn regional_receivers(&self) -> &[i32] {
        self.regional
            .as_ref()
            .and_then(|r| r.network.as_ref())
            .map_or(&[], |n| n.tree.receiver.as_slice())
    }
}
impl poi::settlement_reads::SettlementState for State {
    fn confluences(&self) -> Option<Ref<'_, [ResolvedConfluence]>> {
        self.physical
            .magic
            .as_ref()
            .map(|m| Ref::map(m.borrow(), |m| m.meetings.definitions.as_slice()))
    }
}
impl poi::historical_sites::HistoricalState for State {
    fn confluence_strain(&self, cell: usize) -> io::Result<f64> {
        self.physical
            .magic
            .as_ref()
            .map_or(Ok(0.0), |m| m.borrow().meetings.strain.get(cell))
    }
}
impl poi::cover_landscape::LandscapeState for State {
    fn surface_grid(&self) -> &Grid {
        self.physical.surface.grid()
    }
    fn surface_active(&self) -> ReadBand<u8> {
        self.physical.active.clone()
    }
    fn surface_samples(&self) -> ReadBand<i32> {
        self.physical.surface.samples()
    }
    fn surface_water_shapes(&self) -> Vec<Geometry> {
        self.physical
            .ocean
            .iter()
            .chain(self.physical.lakes.iter().map(|lake| &lake.geometry))
            .cloned()
            .collect()
    }
    fn retained_continental_domains(&self, count: usize) {
        self.retained_continental_domains
            .set(self.retained_continental_domains.get() + count);
    }
}
impl poi::ground_reads::GroundState for State {
    fn climate_settings(&self) -> &field::climate::settings::Settings {
        &self.physical.settings.climate
    }
    fn basin_bowl(&self) -> Option<&[u8]> {
        self.regional
            .as_ref()?
            .network
            .as_ref()
            .map(|n| n.bowl.as_slice())
    }
}
impl poi::lake::LakeState for State {
    fn lake_outline(&self, body: i32) -> Option<&Geometry> {
        self.physical.lake_outlines.get(&body)
    }
    fn inherited_height(&self, cell: usize) -> io::Result<f64> {
        self.regional
            .as_ref()
            .ok_or_else(|| io::Error::other("Captured height requires regional initialization"))?
            .inherited_height
            .get(cell)
    }
}
impl poi::relief_landmarks::LandmarkState for State {
    fn landmarks(&self) -> &[field::landmarks::catalogue::Landmark] {
        &self.physical.landmarks
    }
}
impl poi::gorge::GorgeState for State {
    fn landform_settings(&self) -> &field::landforms::Settings {
        &self.physical.settings.landforms
    }
}
impl poi::peak_ranges::RangeState for State {
    fn relief_radius(&self) -> f64 {
        self.physical.settings.relief.relief_radius
    }
    fn mountain_elevation(&self) -> f64 {
        self.physical.settings.relief.mountain_elevation
    }
    fn hill_elevation(&self) -> f64 {
        self.physical.settings.relief.hill_elevation
    }
    fn mountain_local_relief(&self) -> f64 {
        self.physical.settings.relief.mountain_local_relief
    }
    fn range_minimum_area(&self) -> f64 {
        self.physical.settings.relief.range_minimum_area
    }
    fn retained_continental_domains(&self, count: usize) {
        self.retained_continental_domains
            .set(self.retained_continental_domains.get() + count);
    }
}
impl poi::relief_contours::ReliefState for State {
    fn plain_slope_threshold(&self) -> f64 {
        self.physical.settings.landforms.plain_slope_threshold
    }
    fn hill_elevation(&self) -> f64 {
        self.physical.settings.relief.hill_elevation
    }
}
impl poi::relief_impacts::EventState for State {
    fn mantle_plume_radius(&self) -> f64 {
        self.physical.settings.relief.mantle_plume_radius
    }
    fn impact_visible_relief(&self) -> f64 {
        self.physical.settings.relief.impact_visible_relief
    }
}
impl poi::realized::RealizationState for State {
    fn extent(&self) -> io::Result<field::significance::Extent> {
        use poi::map_records::MapState;
        let shape = if self.scope.world_geography {
            &self.scope.domain
        } else {
            &self.scope.footprint
        };
        let b = self
            .chart()
            .compact_bounds(shape, self.spatial.as_ref())
            .map_err(io::Error::other)?;
        Ok(field::significance::Extent {
            area: self.spatial.area(shape).map_err(io::Error::other)?,
            span: (b.2 - b.0).hypot(b.3 - b.1),
        })
    }
    fn impact_visible_relief(&self) -> f64 {
        self.physical.settings.relief.impact_visible_relief
    }
}
impl poi::fall_size::FallState for State {
    fn fall_sizes(&self) -> &poi::fall_size::Sizes {
        &self.fall_sizes
    }
    fn captured_fall_size(&self, cell: usize) -> io::Result<Option<poi::fall_size::Size>> {
        use poi::carry::CarryState;
        if self.regional.is_none() {
            return Ok(None);
        }
        for item in poi::carry::carried_places(self, &self.catalogue)?.iter() {
            if item.kind != Kind::Waterfall
                || self.hosted_cell(&item.carried.feature)? != Some(cell)
            {
                continue;
            }
            let a = &item.carried.feature.attributes;
            if let Some(size) = a.get("trueSize").filter(|v| !v.is_null()) {
                let number = |key| {
                    size.get(key)
                        .and_then(serde_json::Value::as_f64)
                        .ok_or_else(|| io::Error::other("Captured waterfall size must be numeric"))
                };
                return Ok(Some(poi::fall_size::Size {
                    height: number("height")?,
                    width: number("width")?,
                    length: number("length")?,
                    members: poi::settlement_reads::number(
                        a.get("members").filter(|v| !v.is_null()),
                        1.0,
                    ),
                }));
            }
            return Ok(None);
        }
        Ok(None)
    }
}
impl poi::carry::CarryState<Schedule<Self>> for State {
    fn source_features(&self) -> Option<&dyn FeatureReader> {
        self.records.source_features.as_deref()
    }
    fn hosted_cell(&self, feature: &Feature) -> io::Result<Option<usize>> {
        poi::area_hosting::hosted_cell(self, self.physical.surface.grid(), feature)
    }
}
impl poi::catalogue::CatalogueState<Schedule<Self>> for State {
    fn catalogue(&self) -> &poi::catalogue::Catalogue<Self, Schedule<Self>> {
        &self.catalogue
    }
    fn parent_cell_span(&self) -> f64 {
        self.regional
            .as_ref()
            .map_or(self.field().scale().cells(1.0), |r| r.parent_span)
    }
    fn settlement_places(&self) -> io::Result<Vec<Place>> {
        Ok(poi::community_records::places(self, Kind::Settlement)?
            .as_ref()
            .clone())
    }
    fn city(&self, kind: Kind) -> io::Result<Vec<Place>> {
        crate::atlas::regional::city::places(self, kind)
    }
}
