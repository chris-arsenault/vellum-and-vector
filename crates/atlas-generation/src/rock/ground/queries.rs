use super::{
    query::{average, ground_fact, Fact, GroundQuery},
    SectionLayer,
};
use crate::rock::{catalogue, material::MaterialLayer, material_gives, ModeId, ModeMix};
/// The family of the material at the top of a land section: what a channel cut there runs
/// on. A section with no land column lies under standing water, whose floor is loose sediment.
pub fn bed_family(section: &[SectionLayer]) -> catalogue::RockFamily {
    section
        .first()
        .map_or(catalogue::RockFamily::Loose, |layer| {
            catalogue::kind_of_code(layer.material.kind).family
        })
}
pub fn section_exposure(
    section: &[SectionLayer],
    reach: f64,
    accepts: impl Fn(&SectionLayer) -> bool,
) -> f64 {
    let Some(host) = section.iter().find(|layer| accepts(layer)) else {
        return 0.0;
    };
    if reach <= 0.0 {
        return 0.0;
    }
    (1.0 - (section[0].top - host.top) / reach).max(0.0)
}
pub fn section_response(
    section: &[SectionLayer],
    reach: f64,
    response: impl Fn(&SectionLayer) -> f64,
) -> f64 {
    if section.is_empty() || reach <= 0.0 {
        return 0.0;
    }
    let floor = section[0].top - reach;
    let (mut value, mut thickness) = (0.0, 0.0);
    for layer in section {
        let bottom = if layer.basement {
            f64::NEG_INFINITY
        } else {
            layer.bottom
        };
        let depth = (layer.top - floor.max(bottom)).max(0.0);
        if depth <= 0.0 {
            continue;
        }
        value += response(layer) * depth;
        thickness += depth;
    }
    if thickness > 0.0 {
        value / thickness
    } else {
        0.0
    }
}
pub struct SectionInventory {
    pub available: f64,
    pub reached: f64,
}
pub fn section_inventory(
    section: &[SectionLayer],
    reach: f64,
    concentration: impl Fn(&SectionLayer) -> f64,
) -> SectionInventory {
    let mut result = SectionInventory {
        available: 0.0,
        reached: 0.0,
    };
    let Some(first) = section.first() else {
        return result;
    };
    for layer in section {
        let share = concentration(layer);
        if share <= 0.0 {
            continue;
        }
        result.available += layer.material.depth * share;
        result.reached += layer
            .material
            .depth
            .min(reach - (first.top - layer.top))
            .max(0.0)
            * share;
    }
    result
}
pub fn surface_kind() -> GroundQuery<'static, usize> {
    let mut query = GroundQuery::new(catalogue::STRATA);
    query.rock = Some(Box::new(|_, layer, _| layer.kind.code));
    query
}
pub fn surface_fact(fact: Fact) -> GroundQuery<'static, f64> {
    let mut query = GroundQuery::new(0.0);
    query.rock = Some(Box::new(move |_, layer, _| ground_fact(layer, fact)));
    average(query)
}
pub enum SurfaceResponse {
    Resistance,
    Relative,
    HardestShare,
    Hardness,
    Openness,
    Standing,
}
pub fn surface_response(response: SurfaceResponse) -> GroundQuery<'static, f64> {
    let mut query = GroundQuery::new(if matches!(response, SurfaceResponse::Standing) {
        1.0
    } else {
        0.0
    });
    query.rock = Some(Box::new(move |_, layer, here| match response {
        SurfaceResponse::Resistance => layer.strength,
        SurfaceResponse::Relative => layer.strength / catalogue::BASELINE_ROCK,
        SurfaceResponse::HardestShare => layer.strength / catalogue::HARDEST_ROCK,
        SurfaceResponse::Hardness => catalogue::hardness_of(layer.strength),
        SurfaceResponse::Openness => ground_fact(layer, Fact::Jointing).max(here.fracture),
        SurfaceResponse::Standing => (layer.strength / catalogue::BASELINE_ROCK).clamp(0.6, 1.6),
    }));
    average(query)
}
#[derive(Clone, Default)]
pub struct YieldingPlane {
    pub response: f64,
    pub compliance: f64,
    pub mobility: f64,
    pub slope_x: f64,
    pub slope_y: f64,
    pub kind: usize,
    pub thickness: f64,
    pub overburden: f64,
    pub cap_strength: f64,
    pub strength: f64,
    pub traversed: f64,
    pub cap_work: f64,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Extent {
    Foundation,
    Retained,
    Detachment,
}
pub fn yielding_plane<'a>(
    loading: impl Fn(&MaterialLayer) -> f64 + 'a,
    extent: Extent,
) -> GroundQuery<'a, YieldingPlane> {
    let shear = catalogue::compile(ModeMix::default().with(ModeId::Shear, 1.0));
    let mut query = GroundQuery::new(YieldingPlane::default());
    query.through_column = true;
    query.loose = Some(Box::new(|mut best, layer, _| {
        best.traversed += layer.thickness;
        best.cap_work += layer.thickness * layer.strength;
        best
    }));
    query.rock = Some(Box::new(move |mut best, layer, _| {
        let thickness = if extent == Extent::Foundation {
            layer.thickness
        } else {
            layer.retained_thickness
        };
        if thickness <= 0.0 {
            return best;
        }
        let compliance = material_gives(&shear, &layer.material.interaction(), false, [0.0; 2]);
        let mobility = compliance / (1.0 + compliance);
        let response = loading(&layer.material) * mobility;
        let cap_strength = if best.traversed > 0.0 {
            best.cap_work / best.traversed
        } else {
            layer.strength
        };
        let eligible =
            extent != Extent::Detachment || (best.traversed > 0.0 && cap_strength > layer.strength);
        if eligible && response.abs() > best.response.abs() {
            best = YieldingPlane {
                response,
                compliance,
                mobility,
                slope_x: layer.material.bed_slope_x,
                slope_y: layer.material.bed_slope_y,
                kind: layer.material.kind,
                thickness,
                overburden: best.traversed,
                strength: layer.strength,
                cap_strength,
                ..best
            };
        }
        best.traversed += thickness;
        best.cap_work += thickness * layer.strength;
        best
    }));
    query.across_facets = Some(Box::new(combine_planes));
    query
}
fn combine_planes(land: YieldingPlane, cut: YieldingPlane, share: f64) -> YieldingPlane {
    let a = land.compliance * (1.0 - share);
    let b = cut.compliance * share;
    let compliance = a + b;
    let mean = |a, b| a * (1.0 - share) + b * share;
    YieldingPlane {
        response: mean(land.response, cut.response),
        compliance,
        mobility: mean(land.mobility, cut.mobility),
        slope_x: if compliance > 0.0 {
            (land.slope_x * a + cut.slope_x * b) / compliance
        } else {
            0.0
        },
        slope_y: if compliance > 0.0 {
            (land.slope_y * a + cut.slope_y * b) / compliance
        } else {
            0.0
        },
        kind: if share > 0.5 { cut.kind } else { land.kind },
        thickness: mean(land.thickness, cut.thickness),
        overburden: mean(land.overburden, cut.overburden),
        cap_strength: mean(land.cap_strength, cut.cap_strength),
        strength: mean(land.strength, cut.strength),
        traversed: mean(land.traversed, cut.traversed),
        cap_work: mean(land.cap_work, cut.cap_work),
    }
}
pub fn seam_continuity(
    a: &YieldingPlane,
    b: &YieldingPlane,
    surface_offset: f64,
    dx: f64,
    dy: f64,
) -> f64 {
    if a.kind != b.kind || a.overburden <= 0.0 || b.overburden <= 0.0 {
        return 0.0;
    }
    let prediction = (a.slope_x + b.slope_x) * dx / 2.0 + (a.slope_y + b.slope_y) * dy / 2.0;
    let top = surface_offset - b.overburden + a.overburden - prediction;
    let overlap = (top.min(0.0) - (-a.thickness).max(top - b.thickness)).max(0.0);
    let width = (a.thickness + b.thickness) / 2.0;
    if width > 0.0 {
        overlap / width
    } else {
        0.0
    }
}
pub fn detachment_spread(plane: &YieldingPlane, continuity: f64) -> f64 {
    let contrast = (plane.cap_strength - plane.strength).max(0.0) / plane.cap_strength.max(1.0);
    let geometry = (plane.overburden / plane.thickness.max(1.0)).sqrt();
    plane.mobility * contrast * continuity * geometry
}
