use super::{Regional, Settings, State};
use crate::{
    execution::ExecutionResult,
    field::refinement::initialization,
    scale_settings::ResolvedSettings,
    water::captured::{DrainageNetwork, RiverIdentity},
};
// hpc-exempt: captured river identities, not per-cell data.
use std::collections::BTreeMap;

pub struct CapturedRegion<'a> {
    pub domains: Vec<String>,
    pub parent_span: f64,
    pub epochs: usize,
    pub rivers: Option<&'a DrainageNetwork>,
}
/// Attribute marking a captured record already bent onto this map.
const CARRIED: &str = "carriedOnto";
impl State {
    /// The parent drew its places, ways, waters and outlines at its own cell span; the child
    /// sees each captured record through the same bend as the rivers it carries
    /// (`water::import_geometry::Bend`), so a town stays on its river and its roads still
    /// meet it. Each record is bent once.
    fn bend_captured_records(&mut self, span: f64) -> std::io::Result<()> {
        use crate::{features::FeatureSelection, water::import_geometry::Bend};
        let bend = Bend::new(span, self.field().mesh());
        let records = self
            .records
            .features
            .values(FeatureSelection {
                area_id: Some(&self.scope.area),
                ..Default::default()
            })?
            .collect::<std::io::Result<Vec<_>>>()?;
        for mut feature in records {
            if feature.attributes.contains_key(CARRIED) {
                continue;
            }
            feature.geometry = bend.geometry(&feature.geometry);
            feature.footprint = feature.footprint.map(|f| bend.geometry(&f));
            feature
                .attributes
                .insert(CARRIED.into(), serde_json::json!(self.scope.area));
            self.records.features.put(feature)?;
        }
        Ok(())
    }
    /// Apply captured context before constructing regional physical operation settings.
    pub fn begin_regional(
        &mut self,
        input: CapturedRegion<'_>,
        profile: &ResolvedSettings,
    ) -> ExecutionResult<ResolvedSettings> {
        let regional = Regional::new(self.field(), input.domains, input.parent_span)?;
        self.bend_captured_records(input.parent_span)?;
        let profile = profile
            .regional_profile(input.parent_span, self.field().scale())
            .map_err(std::io::Error::other)?;
        self.physical.settings = Settings::new(&profile, &profile)?;
        // hpc-exempt: names attached to captured published reaches.
        let mut identities = BTreeMap::new();
        for reach in input
            .rivers
            .into_iter()
            .flat_map(|network| &network.reaches)
        {
            for id in &reach.feature_ids {
                let captured = self
                    .records
                    .source_features
                    .as_ref()
                    .map(|source| source.get(id))
                    .transpose()?
                    .flatten();
                if let Some(feature) = captured.or(self.records.features.get(id)?) {
                    let river = feature
                        .attributes
                        .get("riverId")
                        .and_then(|value| value.as_str())
                        .unwrap_or(id)
                        .to_owned();
                    identities.insert(id.clone(), (river, feature.name));
                }
            }
        }
        let identity = |id: &str| {
            identities.get(id).map(|(river, name)| RiverIdentity {
                river: Some(river.clone()),
                name: Some(name.clone()),
            })
        };
        self.physical.executor.run_with(
            &initialization::initialize(),
            &initialization::Capture {
                epochs: input.epochs,
                parent_span: input.parent_span,
                rivers: input.rivers,
                spatial: self.spatial.as_ref(),
                identity: &identity,
            },
        )?;
        self.regional = Some(regional);
        self.clear_queries();
        Ok(profile)
    }
}
