use super::failure;
use crate::{
    answers::AnswerBand,
    execution::{Query, QueryDependency},
    field::{shared::Scalar as S, Field},
    processes::runner::PhysicalContext,
    rock::{
        catalogue,
        ground::{Ground, GroundField},
        ModeId, ModeMix,
    },
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::removal::Facet,
    water::{
        drainage::Conditioning,
        guidance::{GuidanceInputs, GuidanceSettings},
    },
};
use serde::Deserialize;
use std::{io, rc::Rc};
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "LandformNeighborhoodRadius":{"kind":"relative-measure","fraction":0.0025,"dimension":1,"exponent":1},
        "DrainageGuidanceLookaheadDistance":{"kind":"relative-measure","fraction":0.03,"dimension":1,"exponent":1},
        "DrainageFloorGradientWeight":1000,"DrainageConditionedGradientWeight":450,
        "DrainageOutletAlignmentWeight":300,"DrainageCaptureWeight":900,"DrainageInheritedValleyWeight":450
    }})).expect("Declared drainage settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    landform_neighborhood_radius: f64,
    drainage_guidance_lookahead_distance: f64,
    drainage_floor_gradient_weight: f64,
    drainage_conditioned_gradient_weight: f64,
    drainage_outlet_alignment_weight: f64,
    drainage_capture_weight: f64,
    drainage_inherited_valley_weight: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
    pub(super) fn guidance(&self) -> GuidanceSettings {
        GuidanceSettings {
            lookahead_distance: self.drainage_guidance_lookahead_distance,
            floor_gradient_weight: self.drainage_floor_gradient_weight,
            conditioned_gradient_weight: self.drainage_conditioned_gradient_weight,
            outlet_alignment_weight: self.drainage_outlet_alignment_weight,
            capture_weight: self.drainage_capture_weight,
            inherited_valley_weight: self.drainage_inherited_valley_weight,
        }
    }
}
pub(in crate::field) fn bed(ground: &Ground, cell: usize) -> io::Result<f64> {
    if ground.share(cell, Facet::Cut)? > 0.0 {
        ground.surface(cell, Facet::Cut)
    } else {
        ground.view(GroundField::Elevation).get(cell)
    }
}
impl Field {
    pub fn drainage_conditioning(
        p: Rc<Settings>,
        open_boundary: bool,
        roots: Query<Self, AnswerBand>,
        mut dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        dependencies.push(roots.dependency());
        Query::new(
            "drainage-conditioning",
            dependencies,
            move |field: &Field, scope| {
                let c = scope.input::<PhysicalContext>()?;
                let roots = scope.get(&roots)?.values();
                field.ground.borrow_mut().root_hold(Some(roots));
                let ground = field.ground();
                let water = field.water();
                let mix = catalogue::compile(
                    ModeMix::default()
                        .with(ModeId::Abrasion, 0.6)
                        .with(ModeId::Plucking, 0.4),
                );
                field
                    .water
                    .borrow_mut()
                    .condition(
                        Conditioning {
                            mesh: &field.mesh,
                            water_kind: &water.column.kind,
                            bed: &|cell| {
                                if water.column.kind.get(cell)? == 1 {
                                    ground.view(GroundField::Elevation).get(cell)
                                } else {
                                    bed(&ground, cell)
                                }
                            },
                            incoming: None,
                            open_boundary,
                            seed: c.seed,
                            neighborhood_radius: p.landform_neighborhood_radius,
                            response: &|cell, next| ground.face_gives_from(cell, &mix)?.at(next),
                        },
                        &mut field.coverage.borrow_mut(),
                    )
                    .map_err(failure)
            },
        )
    }
    pub fn drainage_guidance(
        p: Rc<Settings>,
        open_boundary: bool,
        roots: Query<Self, AnswerBand>,
        mut dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        dependencies.push(roots.dependency());
        Query::new(
            "drainage-guidance",
            dependencies,
            move |field: &Field, scope| {
                let c = scope.input::<PhysicalContext>()?;
                let roots = scope.get(&roots)?.values();
                field.ground.borrow_mut().root_hold(Some(roots));
                let ground = field.ground();
                let water = field.water();
                let mix = catalogue::compile(
                    ModeMix::default()
                        .with(ModeId::Abrasion, 0.6)
                        .with(ModeId::Plucking, 0.4),
                );
                field
                    .water
                    .borrow_mut()
                    .guide(
                        GuidanceInputs {
                            mesh: &field.mesh,
                            scale: &field.scale,
                            water_kind: &water.column.kind,
                            elevation: &ground.view(GroundField::Elevation),
                            fluvial_erosion: &field.shared.scalar(S::CumulativeFluvialErosion),
                            glacial_erosion: &field.shared.scalar(S::CumulativeGlacialErosion),
                            open_boundary,
                            seed: c.seed,
                            epoch_stable_seed: c.epoch_stable_seed,
                            response: &|cell, next| ground.face_gives_from(cell, &mix)?.at(next),
                            settings: &p.guidance(),
                        },
                        &mut field.coverage.borrow_mut(),
                    )
                    .map_err(failure)
            },
        )
    }
    pub fn flow_routing(
        open_boundary: bool,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new("flow-routing", dependencies, move |field: &Field, scope| {
            let c = scope.input::<PhysicalContext>()?;
            field
                .water
                .borrow_mut()
                .route(c.seed, open_boundary, &mut field.coverage.borrow_mut())
                .map_err(failure)?;
            field.check_drainage(open_boundary).map_err(failure)
        })
    }
}
