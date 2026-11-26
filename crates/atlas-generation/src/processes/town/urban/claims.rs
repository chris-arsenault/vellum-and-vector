//! Competition for residential, working, institutional and agricultural ground at City scale.
use super::{
    fields::{neighborhood, policy, position, Claims},
    geometry::pos,
    Urban,
};
use crate::{
    atlas::state::State,
    features::Feature,
    field::{people::work::habitable, shared::Scalar},
    human::{
        catalogue::{LayerId, FULL_STANDING_PER_BUILT_KM2},
        HumanField,
    },
    town::{catalogue::Activity, templates::Tenure},
};
use atlas_map::Geometry;
use std::io;

pub(super) fn resolve(
    state: &State,
    urban: &mut Urban,
    frame: &Geometry,
    reserved: &[Feature],
) -> io::Result<()> {
    let f = state.field();
    let mesh = f.mesh();
    let template = policy(state)?;
    let positions: Vec<_> = (0..mesh.len()).map(|c| pos(position(mesh, c))).collect();
    let fields = &mut urban.fields;
    fields.inside = state
        .spatial
        .covers_points(frame, &positions)
        .map_err(io::Error::other)?;
    let mut held = vec![false; mesh.len()];
    for place in reserved {
        let cover = state
            .spatial
            .covers_points(&place.geometry, &positions)
            .map_err(io::Error::other)?;
        for (flag, other) in held.iter_mut().zip(cover) {
            *flag |= other;
        }
    }
    for park in &urban.parks {
        let cover = state
            .spatial
            .covers_points(&park.geometry, &positions)
            .map_err(io::Error::other)?;
        for (flag, on) in held.iter_mut().zip(cover) {
            *flag |= on;
        }
    }
    fields.access.resize(mesh.len(), 0.);
    fields.developed.resize(mesh.len(), 0.);
    fields.civic.resize(mesh.len(), 0.);
    let read = |band| -> io::Result<Vec<f64>> {
        let values = f.people().view(band);
        (0..mesh.len()).map(|c| values.get(c)).collect()
    };
    let residents = (0..mesh.len())
        .map(|c| f.people().people(c))
        .collect::<io::Result<Vec<_>>>()?;
    let built = read(HumanField::Layer(LayerId::BuiltUp))?;
    let capital = read(HumanField::Layer(LayerId::Standing))?;
    let crop = read(HumanField::Layer(LayerId::Farmland))?;
    let ruin = read(HumanField::RuinedBuiltUp)?;
    let tenure = read(HumanField::Tenure)?;
    let ways = read(HumanField::KeptLine)?;
    let slope = f.shared().scalar(Scalar::Slope);
    let scalar = |id| f.shared().scalar(id);
    let mut old_wall = vec![false; mesh.len()];
    for wall in state
        .regional
        .as_ref()
        .unwrap()
        .city
        .walls
        .iter()
        .filter(|w| w.outgrown)
    {
        for section in &wall.sections {
            if section.built > 0. {
                old_wall[section.cell] = true;
            }
        }
    }
    let reach = (2. * template.quarter()).max(mesh.spacing() * 3.);
    let turnover = (0..mesh.len())
        .map(|c| f.goods_turnover(c))
        .collect::<io::Result<Vec<_>>>()?;
    fields.claims.clear();
    for c in 0..mesh.len() {
        if !habitable(f, c)? {
            fields.claims.push(Claims {
                reserved: true,
                ..Default::default()
            });
            continue;
        }
        let p = position(mesh, c);
        let [people, b, standing, farm, frontage, trade] = neighborhood(
            mesh,
            [
                &residents,
                &built,
                &capital,
                &crop,
                &fields.developed,
                &turnover,
            ],
            c,
            reach,
        );
        let standing = standing / FULL_STANDING_PER_BUILT_KM2;
        let access = fields.access[c];
        let public = fields.civic[c];
        let dwelling = template.city_affinity(p);
        let rights = template.tenure(Activity::Household, p, template.quarter());
        let grade = slope.get(c)?.max(0.);
        let homes = (people / 1400.).ln_1p() * (0.65 + 0.35 * dwelling.sqrt()) / (1. + grade);
        let work = (b * 7.).ln_1p() * (0.42 + 0.78 * access + 0.35 * ways[c].max(0.).sqrt())
            + 0.25 * frontage
            + 0.25 * public
            + 0.5 * trade.ln_1p();
        let enclosed =
            crate::town::walls::enclosure(&state.regional.as_ref().unwrap().city.walls, c);
        let investment = (1. + 0.20 * f64::from(enclosed))
            * (standing / (b + 0.015)).max(0.)
            * (0.75 + 0.25 * tenure[c].max(0.).min(1.));
        let crowd = people / (600. + b * 5500. + standing * 9000.);
        let stencil = fields.stencil[c];
        let program = fields
            .program
            .get(c)
            .and_then(|&id| urban.programs.get(id as usize));
        let strength = program.map_or(0., |p| p.strength) * stencil;
        let land = crate::town::templates::district::DistrictLand {
            wet: (scalar(Scalar::FloodplainIntensity).get(c)? / 1000.)
                .max(scalar(Scalar::WetlandCover).get(c)?),
            trees: scalar(Scalar::TreeCover).get(c)?,
            slope: grade,
            ruined: ruin[c],
            built: b,
            access,
            verdure: scalar(Scalar::Verdure).get(c)?.clamp(0., 1.),
            tearing: scalar(Scalar::Tearing).get(c)?.clamp(0., 1.),
            old_wall: old_wall[c],
        };
        let demand = program
            .map(|program| program.demands_on(land))
            .unwrap_or_default();
        let household = 1. + strength * (demand.housing + 0.3 * demand.gardens);
        let employment = 1. + strength * (demand.trade + demand.workshops);
        fields.claims.push(Claims {
            demands: demand,
            home: homes * household * (0.65 + 2.65 * stencil),
            work: work * employment * (0.75 + 1.55 * stencil),
            trade,
            investment,
            crowd,
            farm,
            ruin: ruin[c],
            people,
            built: b,
            reserved: held[c] || dwelling <= 0. || (rights == Tenure::Common && dwelling < 0.5),
        });
    }
    Ok(())
}
