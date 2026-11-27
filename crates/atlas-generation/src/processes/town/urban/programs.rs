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
        identity::{Tradition, IDENTITY_SLOTS},
        HumanField,
    },
    town::{catalogue::Activity, templates::Selection},
};
use serde::{Deserialize, Serialize};
use std::io;

use super::character::{Draws, Settings};
use crate::town::templates::district::{Category, Demands, DistrictLand, Evidence, Trope, CATALOG};
mod ground;
mod origins;
use ground::DistrictGround;
pub(super) use origins::district_origins;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Program {
    pub economic: Trope,
    pub social: Trope,
    pub traits: Vec<Trope>,
    pub evidence: serde_json::Value,
    pub demands: Demands,
    #[serde(default)]
    pub origin_candidates: OriginCandidates,
    pub cell: usize,
    pub name: String,
    pub reach: f64,
    pub strength: f64,
}
impl Program {
    pub fn demands_on(&self, land: DistrictLand) -> Demands {
        let mut demand = self.demands;
        for kind in &self.traits {
            kind.shape_district(land, &mut demand);
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

pub(super) fn compete(
    state: &State,
    u: &mut Urban,
    sponsors: Vec<Feature>,
    catchment_scale: f64,
    settings: Settings,
) -> io::Result<()> {
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
    let new_programs = found(state, u, template, sponsors, catchment_scale, settings)?;
    u.programs.extend(new_programs);
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
    catchment_scale: f64,
    settings: Settings,
) -> io::Result<Vec<Program>> {
    let f = state.field();
    let mesh = f.mesh();
    let points: Vec<_> = (0..mesh.len()).map(|c| position(mesh, c)).collect();
    let (mut support, assets, residents) = district_support(state, u, template, &points)?;
    // owner-direction(2026-11-24): geography and social processes determine district count and districts cover all districtable ground
    let area: f64 = support
        .iter()
        .enumerate()
        .filter(|(_, score)| **score > 0.)
        .map(|(c, _)| mesh.area(c))
        .sum();
    // owner-direction(2026-11-24): tune how far a district centre serves, leaving the district count to the city.
    let reach = catchment(template.quarter(), area, mesh.spacing(), catchment_scale);
    let mut draws = retained_draws(state, &points, &mut support)?;
    let centres = new_centres(
        mesh,
        &mut support,
        &points,
        reach,
        u.programs.iter().map(|p| (p.cell, p.reach)),
    );
    if centres.is_empty() {
        return Ok(Vec::new());
    }
    draws.include(u.programs.iter().flat_map(|program| {
        [program.economic, program.social]
            .into_iter()
            .chain(program.traits.iter().copied())
    }));
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
    let mut order: Vec<_> = centres.into_iter().enumerate().collect();
    // hpc-exempt: seeded founding order of the district identities.
    order.sort_by_key(|&(_, c)| {
        crate::noise::hash_unit(seed ^ 0x27ac, points[c][0], points[c][1]).to_bits()
    });
    for (rank, c) in order {
        let point = points[c];
        let ground = DistrictGround::read(state, u, c, reach)?;
        let b = ground.built;
        let (mut facts, mut sites) = nearby_sources(state, &sources, reach, point)?;
        let near = |at: [f64; 2]| (at[0] - point[0]).hypot(at[1] - point[1]) < reach;
        let route = ground.ways.sqrt()
            + template
                .site
                .approaches
                .iter()
                .copied()
                .filter(|&p| near(p))
                .count() as f64;
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
            if site.is_some_and(near) {
                facts.push((id, evidence.into()));
            }
        }
        let tenure = template.tenure(Activity::Household, point, template.quarter());
        let trade = ground.trade;
        use crate::field::poi::values::Benefit;
        let offer = |kind| {
            f.place_offers()
                .map_or(Ok(0.), |offers| offers.benefit(kind, c))
        };
        let industry = f64::from(template.site.industry.is_some_and(near)) + offer(Benefit::Power)?;
        let supplies = offer(Benefit::Materials)? + trade;
        let (contacts, craft) = craft_and_contacts(f, c)?;
        let craft = (industry + craft / f.people().people(c)?.max(1.)) * supplies.sqrt();
        let people = ground.people;
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
            wealth: ground.standing
                / people.max(1.)
                / (assets / residents.max(1.)).max(f64::EPSILON),
            crowd: people / (500. + b * 6500.),
            capital: ground.standing / FULL_STANDING_PER_BUILT_KM2 / (0.015 + b),
            built: b,
            trade,
            food: ground.farm + f64::from(template.site.cultivated) * route * 0.4,
            route,
            tenure,
            free: template.site.free_tenure,
            craft,
            wet: ground.wet,
            trees: ground.trees,
            ruins: ground.ruins,
            greenwood: template.site.medium[3] > 0.,
            veil: template.site.medium[6] > 0.,
            sources: facts,
        };
        let weight = |id: Trope| {
            e.weight(id)
                * (0.6
                    + template
                        .affinity(id.activity(), point, template.quarter())
                        .max(0.)
                        .sqrt())
        };
        let econ = draws
            .draw(Category::Economic, seed ^ 19, point, settings, weight)
            .ok_or_else(|| io::Error::other("District catalogue has no economic draw"))?;
        let social = draws
            .draw(Category::Social, seed ^ 97, point, settings, weight)
            .ok_or_else(|| io::Error::other("District catalogue has no social draw"))?;
        let traits = draws.traits(seed, point, settings, |id| e.weight(id));
        if std::env::var_os("ATLAS_TRACE_CITY").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({"event":"city.district-founded","anchor":point,
                "economic":econ.id,"social":social.id,"traits":traits,"repeat":settings.repeat,"ordinary":settings.ordinary})
            );
        }
        let mut demands = Demands::default();
        sites.retain(|(kind, _, _)| traits.contains(kind));
        for id in [econ.id, social.id] {
            id.contribute(&mut demands);
        }
        let evidence = serde_json::json!({"anchor":point,"peoplePerKm2":people,"builtShare":b,"standingPerBuilt":e.capital,"relativeAssetsPerResident":e.wealth,
            "trade":trade,"food":e.food,"route":route,"tenure":tenure,"sources":e.sources,"makers":craft,"languageContacts":contacts,"economicType":econ.name,"socialType":social.name});
        programs.push((
            rank,
            Program {
                economic: econ.id,
                social: social.id,
                traits,
                demands,
                evidence,
                origin_candidates: sites,
                cell: c,
                name: econ.name.clone(),
                reach,
                strength: 1.,
            },
        ));
    }
    // hpc-exempt: restore district identities to centre priority for spatial tie-breaking.
    programs.sort_by_key(|(rank, _)| *rank);
    Ok(programs.into_iter().map(|(_, p)| p).collect())
}

fn district_support(
    state: &State,
    u: &Urban,
    template: &Selection,
    points: &[[f64; 2]],
) -> io::Result<(Vec<f64>, f64, f64)> {
    let f = state.field();
    let mesh = f.mesh();
    let band = |id| f.people().view(HumanField::Layer(id));
    let built = band(LayerId::BuiltUp);
    let capital = band(LayerId::Standing);
    let ways = f.people().view(HumanField::KeptLine);
    let mut support = vec![0.; mesh.len()];
    let slope = f.shared().scalar(crate::field::shared::Scalar::Slope);
    let mut occupation = vec![0.; mesh.len()];
    for (c, v) in support.iter_mut().enumerate() {
        let p = f.people().people(c)?;
        let b = built.get(c)?;
        if u.fields.stencil[c] > 0.5 && habitable(f, c)? && p > 0. {
            occupation[c] = crate::town::city::outline::Ground {
                residents_per_km2: p,
                built_share: b,
                slope: slope.get(c)?.max(0.),
                water: false,
            }
            .settlement_support();
            *v = u.fields.stencil[c]
                * (p.ln_1p() + 2. * b.sqrt() + ways.get(c)?.sqrt())
                * template.city_affinity(points[c]).sqrt();
        }
    }
    let at = crate::field::refinement::courses::cell_at(mesh, template.site.centre);
    let threshold =
        crate::town::city::outline::settlement_threshold(at.map_or(0., |c| occupation[c]));
    let principal = match super::landscape::contour(state, &occupation, threshold)? {
        Some(g) => super::landscape::principal_ground(
            state.spatial.as_ref(),
            &g,
            &super::landscape::SettlementGround::captured(state)?,
            template.quarter(),
            &super::landscape::crossings(u, mesh),
        )?,
        None => None,
    };
    let Some(ground) = principal else {
        support.fill(0.);
        return Ok((support, 0., 0.));
    };
    let positions: Vec<_> = points.iter().copied().map(pos).collect();
    let inside = state
        .spatial
        .covers_points(&ground, &positions)
        .map_err(io::Error::other)?;
    let mut residents = 0.;
    let mut assets = 0.;
    for (c, score) in support.iter_mut().enumerate() {
        if inside[c] && occupation[c] > threshold {
            residents += f.people().people(c)? * mesh.area(c);
            assets += capital.get(c)? * mesh.area(c);
        } else {
            *score = 0.;
        }
    }
    Ok((support, assets, residents))
}

fn craft_and_contacts(f: &crate::field::Field, c: usize) -> Result<(f64, f64), io::Error> {
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
    Ok((contacts, craft))
}

type SourceFacts = Vec<(Trope, String)>;
type OriginCandidates = Vec<(Trope, [f64; 2], String)>;

fn nearby_sources(
    state: &State,
    sources: &[Feature],
    reach: f64,
    point: [f64; 2],
) -> Result<(SourceFacts, OriginCandidates), io::Error> {
    let location = atlas_map::regions::point(pos(point));
    let mut facts = Vec::new();
    let mut sites = Vec::new();
    for source in sources {
        if let Some(id) = feature_trope(source) {
            if state
                .spatial
                .distance(&location, &source.geometry)
                .map_err(io::Error::other)?
                < reach * 0.65
            {
                if CATALOG.iter().any(|e| e.id == id && e.localized_origin) {
                    let [_, nearest] = state
                        .spatial
                        .nearest_points(&location, &source.geometry)
                        .map_err(io::Error::other)?;
                    sites.push((id, super::geometry::xy(nearest), source.id.to_string()));
                }
                facts.push((id, source.id.to_string()));
            }
        }
    }
    Ok((facts, sites))
}

fn retained_draws(
    state: &State,
    points: &[[f64; 2]],
    support: &mut [f64],
) -> Result<Draws, io::Error> {
    let mut draws = Draws::default();
    for retained in super::values(state, "district")? {
        if let Some(program) = retained.attributes.get("districtProgram") {
            draws.include_retained(program);
        }
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
    Ok(draws)
}
fn catchment(quarter: f64, settled_area: f64, spacing: f64, scale: f64) -> f64 {
    let city_radius = (settled_area / std::f64::consts::PI).sqrt();
    (scale * (quarter * city_radius).sqrt()).max(2. * spacing)
}

fn new_centres(
    mesh: &crate::lattice::TriangularLattice,
    support: &mut [f64],
    points: &[[f64; 2]],
    reach: f64,
    existing: impl Iterator<Item = (usize, f64)>,
) -> Vec<usize> {
    for (cell, old_reach) in existing {
        let served = old_reach.max(reach);
        for neighbor in mesh.cells_within(mesh.position(cell), served) {
            if mesh.physical_distance(cell, neighbor) < served {
                support[neighbor] = 0.;
            }
        }
    }
    crate::town::city::hot_spots(support, points, reach, usize::MAX)
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

#[cfg(test)]
mod tests {
    use super::catchment;
    #[test]
    fn later_residents_can_found_a_neighborhood_beyond_existing_district_service() {
        let mesh = crate::lattice::WorldLatticeOptions::default()
            .build(atlas_map::Bounds(0., 0., 1000., 400.), 400., 0., |_, _| {
                true
            })
            .unwrap();
        let at: Vec<_> = (0..mesh.len()).map(|i| mesh.position(i)).collect();
        let mut support = vec![0.; mesh.len()];
        let centre = mesh.cell_at(0., 0.).unwrap();
        let neighbor = (0..3).find_map(|e| mesh.neighbor(centre, e)).unwrap();
        let later = at
            .iter()
            .position(|&p| (p[0] - at[centre][0]).abs() > 300.)
            .unwrap();
        support[centre] = 12.;
        support[neighbor] = 8.;
        support[later] = 6.;
        assert_eq!(
            super::new_centres(&mesh, &mut support, &at, 100., [(centre, 120.)].into_iter()),
            [later]
        );
    }
    #[test]
    fn catchment_scale_groups_nearby_centres_without_limiting_distant_ones() {
        let candidates = [[0., 0.], [2800., 0.], [7700., 0.]];
        let found = |scale| {
            let reach = catchment(90., std::f64::consts::PI * 10_000_f64.powi(2), 100., scale);
            crate::town::city::hot_spots(&[3., 2., 1.], &candidates, reach, usize::MAX)
        };
        assert_eq!(found(2.4), vec![0, 1, 2]);
        assert_eq!(found(3.6), vec![0, 2]);
    }
}
