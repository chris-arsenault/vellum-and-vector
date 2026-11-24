//! Districts compete for sites before investment, movement and construction resolve their geography.
use super::{
    fields::{neighborhood, policy, position},
    geometry::pos,
    Urban,
};
use crate::{
    atlas::state::State,
    features::Feature,
    field::people::work::habitable,
    human::{
        catalogue::{LayerId, FULL_STANDING_PER_BUILT_KM2},
        HumanField,
    },
    town::{catalogue::Activity, templates::Selection},
};
use serde::{Deserialize, Serialize};
use std::io;

use crate::town::templates::district::{Category, Demands, Evidence, Trope, CATALOG};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Program {
    pub economic: Trope,
    pub social: Trope,
    pub traits: Vec<Trope>,
    pub evidence: serde_json::Value,
    pub demands: Demands,
    #[serde(default)]
    pub sites: Vec<(Trope, [f64; 2])>,
    pub cell: usize,
    pub name: String,
    pub reach: f64,
    pub strength: f64,
}
impl Program {
    pub fn demands_at(&self, point: [f64; 2]) -> Demands {
        let mut demand = self.demands;
        for &(kind, site) in &self.sites {
            let distance = (point[0] - site[0]).hypot(point[1] - site[1]);
            let influence = (1. - distance / (self.reach * 0.5)).max(0.);
            demand.add_site(kind, influence);
        }
        demand
    }
}
pub(super) fn at(urban: &Urban, cell: usize) -> Option<&Program> {
    urban
        .fields
        .program
        .get(cell)
        .and_then(|&index| urban.programs.get(index))
}

pub(super) fn compete(state: &State, u: &mut Urban, sponsors: Vec<Feature>) -> io::Result<()> {
    let mesh = state.field().mesh();
    let template = policy(state)?;
    let n = mesh.len();
    if u.fields.stencil.is_empty() {
        let positions: Vec<_> = (0..n).map(|c| pos(position(mesh, c))).collect();
        // owner-direction(2026-11-24): retain the City stencil as a very strong interior development prior with supported outskirts
        let membership: Vec<_> = state
            .spatial
            .covers_points(state.scope.settled_outline(), &positions)
            .map_err(io::Error::other)?
            .into_iter()
            .map(|v| f64::from(v as u8))
            .collect();
        let reach = (template.quarter() * 1.5).max(mesh.spacing() * 2.);
        u.fields.stencil = (0..n)
            .map(|c| neighborhood(mesh, [&membership], c, reach)[0])
            .collect();
    }
    if u.programs.is_empty() {
        u.programs = found(state, u, template, sponsors)?;
    }
    for program in &mut u.programs {
        if let Some(claim) = u.fields.claims.get(program.cell) {
            program.strength =
                0.85 + 0.28 * (claim.home + claim.work + u.fields.access[program.cell]).tanh();
        }
    }
    let seeds: Vec<_> = u.programs.iter().map(|p| p.cell).collect();
    let f = state.field();
    let mut cost = Vec::with_capacity(n);
    for c in 0..n {
        let access = u.fields.access.get(c).copied().unwrap_or(0.);
        cost.push(if habitable(f, c)? {
            (1. + f
                .shared()
                .scalar(crate::field::shared::Scalar::Slope)
                .get(c)?
                .max(0.)
                * 4.)
                / (1. + 0.3 * access)
        } else {
            12.
        });
    }
    // This is provisional influence on the shared lattice. The final partition uses
    // the resolved roads, works and geographic boundaries of the city.
    u.fields.program = crate::town::city::districts(
        &seeds,
        n,
        |a, b| mesh.physical_distance(a, b) * (cost[a] + cost[b]) * 0.5,
        |c| [0, 1, 2].map(|e| mesh.neighbor(c, e)),
    );
    Ok(())
}
fn found(
    state: &State,
    u: &Urban,
    template: &Selection,
    mut sources: Vec<Feature>,
) -> io::Result<Vec<Program>> {
    let f = state.field();
    let mesh = f.mesh();
    let band = |id| f.people().view(HumanField::Layer(id));
    let built = band(LayerId::BuiltUp);
    let capital = band(LayerId::Standing);
    let farm = band(LayerId::Farmland);
    let ways = f.people().view(HumanField::KeptLine);
    let points: Vec<_> = (0..mesh.len()).map(|c| position(mesh, c)).collect();
    let mut support = vec![0.; mesh.len()];
    let mut residents = 0.;
    let mut assets = 0.;
    for (c, v) in support.iter_mut().enumerate() {
        let p = f.people().people(c)?;
        let b = built.get(c)?;
        if u.fields.stencil[c] > 0.5 && habitable(f, c)? && p > 0. && b > 0. {
            residents += p * mesh.area(c);
            assets += capital.get(c)? * mesh.area(c);
            *v = u.fields.stencil[c]
                * (p.ln_1p() + 2. * b.sqrt() + ways.get(c)?.sqrt())
                * template.city_affinity(points[c]).sqrt();
        }
    }
    // owner-direction(2026-11-24): geography and social processes determine district count and districts cover all districtable ground
    let area = state
        .spatial
        .area(state.scope.settled_outline())
        .map_err(io::Error::other)?;
    let reach = (template.quarter() * (area / std::f64::consts::PI).sqrt()).sqrt() * 2.4;
    let reach = reach.max(mesh.spacing() * 2.);
    for retained in super::values(state, "district")? {
        let positions: Vec<_> = points.iter().copied().map(pos).collect();
        for (score, held) in support.iter_mut().zip(
            state
                .spatial
                .covers_points(&retained.geometry, &positions)
                .map_err(io::Error::other)?,
        ) {
            if held {
                *score = 0.;
            }
        }
    }
    let centres = crate::town::city::hot_spots(&support, &points, reach, usize::MAX);
    for feature in super::selected(state, None)? {
        if feature_trope(&feature).is_some() && !sources.iter().any(|f| f.id == feature.id) {
            sources.push(feature);
        }
    }
    let seed = state
        .scope
        .city
        .as_ref()
        .map_or(0, |s| s.settlement.0 as i32);
    let mut programs = Vec::new();
    for c in centres {
        let point = points[c];
        let b = built.get(c)?;
        let location = atlas_map::regions::point(pos(point));
        let mut facts = Vec::new();
        let mut sites = Vec::new();
        for source in &sources {
            if let Some(id) = feature_trope(source) {
                if state
                    .spatial
                    .distance(&location, &source.geometry)
                    .map_err(io::Error::other)?
                    < reach * 0.65
                {
                    let [_, nearest] = state
                        .spatial
                        .nearest_points(&location, &source.geometry)
                        .map_err(io::Error::other)?;
                    sites.push((id, super::geometry::xy(nearest)));
                    facts.push((id, source.id.to_string()));
                }
            }
        }
        let near = |at: [f64; 2]| (at[0] - point[0]).hypot(at[1] - point[1]) < reach;
        let route = ways.get(c)?.max(0.).sqrt()
            + f64::from(template.site.approaches.iter().copied().any(near));
        for (id, site, evidence) in [
            (
                Trope::Flood,
                template.site.works.floodplain,
                "survey:floodplain",
            ),
            (Trope::Veil, template.site.door, "survey:door"),
            (
                Trope::Greenwood,
                template.site.grove.filter(|_| template.site.medium[3] > 0.),
                "survey:greenwood",
            ),
        ] {
            if let Some(at) = site.filter(|&at| near(at)) {
                facts.push((id, evidence.into()));
                sites.push((id, at));
            }
        }
        let tenure = template.tenure(Activity::Household, point, template.quarter());
        let trade = f.goods_turnover(c)?.ln_1p();
        use crate::{
            field::poi::values::Benefit,
            human::identity::{Tradition, IDENTITY_SLOTS},
        };
        let offer = |kind| {
            f.place_offers()
                .map_or(Ok(0.), |offers| offers.benefit(kind, c))
        };
        let industry = f64::from(template.site.industry.is_some_and(near)) + offer(Benefit::Power)?;
        let supplies = offer(Benefit::Materials)? + trade;
        let mut contacts = 0.;
        let mut craft = 0.;
        for slot in 0..IDENTITY_SLOTS {
            let group = f.people().identity(slot);
            let people = group.people.get(c)?;
            if group.traditions[Tradition::Craft as usize].get(c)? > 0 {
                craft += people;
            }
            let known = group.traditions[Tradition::Known as usize].get(c)?;
            if known > 0 && known != group.traditions[Tradition::Tongue as usize].get(c)? {
                contacts += people;
            }
        }
        let people = f.people().people(c)?;
        let craft = (industry + craft / people.max(1.)) * supplies.sqrt();
        if craft > 0. && tenure == crate::town::templates::Tenure::Common {
            facts.push((Trope::Guild, "local:cooperative-production".into()));
        }
        if contacts > 0. && trade * route > 0. {
            facts.push((
                Trope::Outlanders,
                "local:trade-and-language-contacts".into(),
            ));
        }
        let e = Evidence {
            wealth: capital.get(c)?
                / people.max(1.)
                / (assets / residents.max(1.)).max(f64::EPSILON),
            crowd: people / (500. + b * 6500.),
            capital: capital.get(c)? / FULL_STANDING_PER_BUILT_KM2 / (0.015 + b),
            built: b,
            trade,
            food: farm.get(c)? + f64::from(template.site.cultivated) * route,
            route,
            tenure,
            free: template.site.free_tenure,
            craft,
            sources: facts,
        };
        let draw = |category: Category, salt: i32| {
            CATALOG
                .iter()
                .filter(|r| r.category == category)
                .filter_map(|r| {
                    let w = e.weight(r.id)
                        * template
                            .affinity(r.id.activity(), point, template.quarter())
                            .max(0.);
                    let roll =
                        crate::noise::hash_unit(seed ^ salt ^ r.id as i32, point[0], point[1]);
                    (w > 0.).then(|| (r, -roll.max(f64::MIN_POSITIVE).ln() / w))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(r, _)| r)
        };
        let (Some(econ), Some(social)) = (draw(Category::Economic, 19), draw(Category::Social, 97))
        else {
            continue;
        };
        let traits: Vec<_> = CATALOG
            .iter()
            .filter(|r| {
                r.category == Category::Trait
                    && e.weight(r.id) > 0.
                    && sites
                        .iter()
                        .filter(|(kind, _)| *kind == r.id)
                        .any(|(_, at)| {
                            let distance = (point[0] - at[0]).hypot(point[1] - at[1]);
                            let weight = (1. - distance / reach).max(0.) * e.weight(r.id);
                            crate::noise::hash_unit(seed ^ r.id as i32, point[0], point[1])
                                < 1. - (-2. * weight).exp()
                        })
            })
            .map(|r| r.id)
            .collect();
        let mut demands = Demands::default();
        sites.retain(|(kind, _)| traits.contains(kind));
        for id in [econ.id, social.id] {
            id.contribute(&mut demands);
        }
        let evidence = serde_json::json!({"anchor":point,"peoplePerKm2":f.people().people(c)?,"builtShare":b,"standingPerBuilt":e.capital,"relativeAssetsPerResident":e.wealth,
            "trade":trade,"food":e.food,"route":route,"tenure":tenure,"sources":e.sources,"traitSites":sites,"makers":craft,"languageContacts":contacts,"economicType":econ.name,"socialType":social.name});
        programs.push(Program {
            economic: econ.id,
            social: social.id,
            traits,
            demands,
            evidence,
            sites,
            cell: c,
            name: econ.name.clone(),
            reach,
            strength: 1.,
        });
    }
    Ok(programs)
}
fn feature_trope(f: &Feature) -> Option<Trope> {
    use crate::field::poi::catalogue::{settlement_use, SettlementUse::*};
    Some(match settlement_use(f)? {
        Discontinuity => Trope::Veil,
        EncroachingWood => Trope::Greenwood,
        Burial => Trope::Ossuary,
        Floodplain => Trope::Flood,
        FreshWater => Trope::Spring,
        Remains => Trope::Ruins,
        FormerDefence => Trope::Wall,
        Residence => Trope::Resident,
        NestingGround => Trope::Rookery,
        Learning => Trope::Scribe,
        Guild => Trope::Guild,
        Refuge => Trope::Outlanders,
    })
}
