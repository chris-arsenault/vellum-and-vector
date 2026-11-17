mod floodplains;
use super::failure;
use crate::{
    execution::{Query, QueryDependency},
    field::{shared::Scalar as S, Field},
    rock::{
        catalogue::BASELINE_ROCK,
        ground::{
            query::{average, GroundQuery},
            GroundField,
        },
    },
    scale_settings::{ResolvedSettings, ScaleDefinition},
    water::channel_geometry::{ChannelInputs, ChannelSettings},
};
use serde::Deserialize;
use std::{io, rc::Rc};
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "RiverChannelBaseStrength":260,"RiverChannelOrderStrength":145,"RiverChannelDischargeStrength":55,
        "RiverChannelWidthDecay":330,"RiverChannelWideningOrder":2,"RiverChannelWideningDischargeMultiplier":5,
        "RiverChannelMaximumLongitudinalAlignment":560,"PlainSlopeThreshold":0.003,
        "RiverChannelMaximumBankRelief":{"kind":"relative-measure","fraction":0.0000175,"dimension":1,"exponent":1},
        "RiverAccumulationThreshold":{"kind":"relative-measure","fraction":6.25e-19,"dimension":3,"exponent":1},
        "FloodplainMinimumRiverOrder":2,"FloodplainMaximumSlope":0.0042,"FloodplainMaximumLongitudinalAlignment":720,
        "FloodplainIntensityDecay":280,
        "FloodplainMaximumRelief":{"kind":"relative-measure","fraction":0.0000085,"dimension":1,"exponent":1}
    }})).expect("Declared channel and floodplain settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    river_channel_base_strength: f64,
    river_channel_order_strength: f64,
    river_channel_discharge_strength: f64,
    river_channel_width_decay: f64,
    river_channel_widening_order: f64,
    river_channel_widening_discharge_multiplier: f64,
    river_channel_maximum_longitudinal_alignment: f64,
    river_channel_maximum_bank_relief: f64,
    river_accumulation_threshold: f64,
    plain_slope_threshold: f64,
    floodplain_minimum_river_order: u16,
    floodplain_maximum_slope: f64,
    floodplain_maximum_relief: f64,
    floodplain_maximum_longitudinal_alignment: f64,
    floodplain_intensity_decay: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
    fn channels(&self) -> ChannelSettings {
        ChannelSettings {
            maximum_bank_relief: self.river_channel_maximum_bank_relief,
            maximum_longitudinal_alignment: self.river_channel_maximum_longitudinal_alignment,
            plain_slope_threshold: self.plain_slope_threshold,
            width_decay: self.river_channel_width_decay,
            widening_order: self.river_channel_widening_order,
            widening_discharge_multiplier: self.river_channel_widening_discharge_multiplier,
            accumulation_threshold: self.river_accumulation_threshold,
            base_strength: self.river_channel_base_strength,
            order_strength: self.river_channel_order_strength,
            discharge_strength: self.river_channel_discharge_strength,
        }
    }
}
fn with_channels<T>(
    field: &Field,
    p: &Settings,
    apply: impl FnOnce(ChannelInputs<'_>) -> io::Result<T>,
) -> io::Result<T> {
    let ground = field.ground();
    let water = field.water();
    let mut standing = GroundQuery::new(1.0);
    standing.rock = Some(Box::new(|_, layer, _| {
        (layer.strength / BASELINE_ROCK).clamp(0.6, 1.6)
    }));
    let standing = average(standing);
    let bed = |cell| {
        Ok(crate::rock::ground::queries::bed_family(
            &ground.section(cell, crate::settlement::removal::Facet::Land)?,
        ))
    };
    apply(ChannelInputs {
        mesh: &field.mesh,
        scale: &field.scale,
        settings: &p.channels(),
        targets: &water.routing.targets,
        orders: &water.river_orders,
        kind: &water.column.kind,
        basins: &water.routing.basins,
        elevation: &ground.view(GroundField::Elevation),
        slope: &field.shared.scalar(S::Slope),
        flow: &water.flow.mean,
        standing: &|cell| ground.fold(cell, &standing, None),
        bed: &bed,
    })
}
impl Field {
    pub fn river_channel_geometry(
        p: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "river-channel-geometry",
            dependencies,
            move |field: &Field, _| {
                with_channels(field, &p, |input| {
                    field
                        .water
                        .borrow_mut()
                        .channel_geometry(input, &mut field.coverage.borrow_mut())
                })
                .map_err(failure)?;
                field.check_channels().map_err(failure)
            },
        )
    }
    pub fn floodplains(
        p: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "river-floodplains",
            dependencies,
            move |field: &Field, _| {
                with_channels(field, &p, |input| floodplains::run(field, &p, &input))
                    .map_err(failure)
            },
        )
    }
}
