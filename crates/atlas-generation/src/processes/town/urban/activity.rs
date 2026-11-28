//! Neighborhood customers and producers compete for developed ground across layout rounds.
use super::{fields::position, grades::ground_parts, Element, Urban};
use crate::{
    atlas::state::State, field::shared::Scalar, lattice::TriangularLattice, spatial::SpatialKernel,
};
use atlas_map::{regions::boundary_lines, Geometry, Position};
use std::io;

const ROAD_WEIGHT: crate::parameters::NumericParameter = crate::parameters::NumericParameter {
    name: "principalRoadActivityWeight",
    unit: "weight",
    default: 1.,
    minimum: Some(0.),
    maximum: None,
    strategy: Some("urban-blocks"),
    map_types: &[crate::processes::strategies::MapType::City],
};
const HOUSEHOLD_WEIGHT: crate::parameters::NumericParameter = crate::parameters::NumericParameter {
    name: "householdServiceWeight",
    ..ROAD_WEIGHT
};
/// How strongly an institution's or major work's claim on the ground round it counts
/// against the households' claim. Zero leaves every sponsor its own grounds alone.
const PRECINCT_WEIGHT: crate::parameters::NumericParameter = crate::parameters::NumericParameter {
    name: "precinctClaimWeight",
    ..ROAD_WEIGHT
};
pub(super) const CONTROLS: &[crate::parameters::NumericParameter] =
    &[ROAD_WEIGHT, HOUSEHOLD_WEIGHT, PRECINCT_WEIGHT];

#[derive(Clone, Copy)]
pub(super) struct Settings {
    roads: f64,
    households: f64,
    /// The weight of a sponsor's claim against the households' claim on the same ground.
    pub precincts: f64,
}
impl Settings {
    pub const DEFAULT: Self = Self {
        roads: ROAD_WEIGHT.default,
        households: HOUSEHOLD_WEIGHT.default,
        precincts: PRECINCT_WEIGHT.default,
    };
    pub fn from_input(input: &crate::atlas::dispatch::Input) -> io::Result<Self> {
        Ok(Self {
            roads: input.number(ROAD_WEIGHT.name)?,
            households: input.number(HOUSEHOLD_WEIGHT.name)?,
            precincts: input.number(PRECINCT_WEIGHT.name)?,
        })
    }
}

fn junctions(kernel: &dyn SpatialKernel, roads: &[Element]) -> io::Result<Vec<Position>> {
    let ground: Vec<_> = roads
        .iter()
        .flat_map(ground_parts)
        .filter(|g| {
            matches!(
                g,
                Geometry::LineString { .. } | Geometry::MultiLineString { .. }
            )
        })
        .collect();
    if ground.is_empty() {
        return Ok(Vec::new());
    }
    let network = kernel.union_all(&ground).map_err(io::Error::other)?;
    // GEOS nodes and dissolves the ground lines. Three distinct arms can meet at a T
    // or at a crossing, while an ordinary bend or two coincident roads supply only two.
    // hpc-exempt: sparse vector network vertices keyed by their GEOS coordinates.
    let mut ends = std::collections::BTreeMap::new();
    for line in network
        .iter()
        .flat_map(boundary_lines)
        .filter(|l| l.len() >= 2)
    {
        for p in [line[0], line[line.len() - 1]] {
            let [x, y] = super::geometry::xy(p);
            let (_, degree) = ends.entry((x.to_bits(), y.to_bits())).or_insert((p, 0));
            *degree += 1;
        }
    }
    Ok(ends
        .into_values()
        .filter_map(|(p, n)| (n >= 3).then_some(p))
        .collect())
}

fn junction_access(state: &State, roads: &[Element], reach: f64) -> io::Result<Vec<f64>> {
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    let mut strength = vec![0_f64; mesh.len()];
    for at in junctions(state.spatial.as_ref(), roads)? {
        let [x, y] = super::geometry::xy(at);
        for c in mesh.cells_within([x - ox, y - oy], reach) {
            let [cx, cy] = position(mesh, c);
            strength[c] = strength[c].max((1. - (x - cx).hypot(y - cy) / reach).max(0.));
        }
    }
    Ok(strength)
}

fn share(value: f64, half: f64) -> f64 {
    value.max(0.) / (value.max(0.) + half)
}

// owner-direction(2026-11-25): neighborhoods can originate trade and working ground away from principal roads.
pub(super) fn develop(
    state: &State,
    city: &Urban,
    quarter: f64,
    settings: Settings,
) -> io::Result<Vec<[f64; 2]>> {
    let field = state.field();
    let mesh = field.mesh();
    let seed = state
        .scope
        .city
        .as_ref()
        .map_or(0, |s| s.settlement.0 as i32);
    let slope = field.shared().scalar(Scalar::Slope);
    let junction = junction_access(state, &city.routes, quarter * 2.)?;
    let mut activity = vec![[0.; 2]; mesh.len()];
    let mut walking = vec![0.; mesh.len()];
    for (c, x) in city.fields.claims.iter().enumerate() {
        if x.reserved || !city.fields.inside[c] || x.people + x.built <= 0. {
            continue;
        }
        let [px, py] = position(mesh, c);
        let opportunity = |salt, scale| {
            crate::chance::Chance::of(seed, salt)
                .noise(quarter * scale, 2)
                .signed([px, py])
        };
        let households = share(x.people, 950.);
        let workers = share(x.work, 2.);
        let turnover = share(x.trade.ln_1p(), 1.);
        let built = share(x.built, 0.07);
        let grade = slope.get(c)?.max(0.);
        let access = city.fields.access[c];
        let work = city.work_at(c);
        let civic = city.fields.civic[c];
        let programme =
            city.fields.stencil[c] * super::programs::at(city, c).map_or(0., |p| p.strength);
        // Concentrating homes also concentrates customers for everyday services and
        // space for household trades. A strong residential claim feeds all three uses.
        let domestic = settings.households * programme * x.demands.housing * share(x.people, 350.);
        let shop = 0.16 + 0.64 * households + 0.22 * turnover + 0.10 * built + 0.45 * domestic;
        let craft = 0.13
            + 0.34 * workers
            + 0.26 * built
            + 0.19 * households
            + 0.15 * share(x.farm, 0.12)
            + 0.23 * domestic * built;
        let shop = shop * (1.20 * opportunity(0x3e71, 4.2)).exp() / (1. + grade)
            + settings.roads * (0.22 * access + 0.18 * junction[c])
            + 0.35 * programme * x.demands.trade
            + civic * work.trade;
        let craft = craft * (1.28 * opportunity(0x75a3, 5.1)).exp() / (1. + 2. * grade)
            + settings.roads * 0.12 * access
            + 0.44 * programme * x.demands.workshops
            + civic * work.workshops;
        walking[c] = 1. / (1. + 4. * grade + 2. * x.ruin);
        activity[c] = [shop, craft];
    }
    Ok(neighbor_activity(
        mesh,
        activity,
        &city.fields.activity,
        &walking,
        quarter,
    ))
}

fn neighbor_activity(
    mesh: &TriangularLattice,
    sources: Vec<[f64; 2]>,
    prior: &[[f64; 2]],
    walking: &[f64],
    quarter: f64,
) -> Vec<[f64; 2]> {
    let mut next = sources.clone();
    for c in 0..mesh.len() {
        if walking[c] == 0. {
            continue;
        }
        let mut carried = [0.; 2];
        for edge in 0..3 {
            let Some(b) = mesh.neighbor(c, edge) else {
                continue;
            };
            let passage = walking[c].min(walking[b]);
            if passage <= 0. {
                continue;
            }
            let reach = (-mesh.edge_length(c, edge) / (2. * quarter * passage)).exp();
            for k in 0..2 {
                let previous = prior.get(b).map_or(sources[b][k], |v| v[k]);
                carried[k] = f64::max(carried[k], reach * (sources[b][k] + previous) * 0.5);
            }
        }
        for k in 0..2 {
            next[c][k] = 0.84 * sources[c][k] + 0.33 * carried[k];
        }
    }
    next
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    #[test]
    fn neighborhood_activity_spreads_without_roads_and_stops_on_reserved_ground() {
        let mesh = crate::lattice::WorldLatticeOptions::default()
            .build(atlas_map::Bounds(0., 0., 300., 300.), 2500., 0., |_, _| {
                true
            })
            .unwrap();
        let centre = mesh.cell_at(0., 0.).unwrap();
        let next = (0..3).find_map(|e| mesh.neighbor(centre, e)).unwrap();
        let mut sources = vec![[0.; 2]; mesh.len()];
        sources[centre] = [1., 0.6];
        let mut walking = vec![1.; mesh.len()];
        let first = neighbor_activity(&mesh, sources.clone(), &[], &walking, 120.);
        assert!(first[next][0] > first[next][1] && first[next][1] > 0.);
        walking[next] = 0.;
        let blocked = neighbor_activity(&mesh, sources, &first, &walking, 120.);
        assert_eq!(blocked[next], [0.; 2]);
    }
    #[test]
    fn junctions_count_connected_ground_arms() {
        let k = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let road = |p: &[[f64; 2]]| {
            Element::way(
                Geometry::LineString {
                    coordinates: p.iter().copied().map(super::super::geometry::pos).collect(),
                },
                "thoroughfare",
                "Road",
                8.,
            )
        };
        let bent = road(&[[0., 0.], [10., 0.], [10., 10.]]);
        let branch = road(&[[5., 0.], [5., 5.]]);
        let mut bridge = road(&[[7., -5.], [7., 5.]]);
        bridge.attributes.insert(
            "roadFeatures".into(),
            serde_json::json!([{"kind":"bridge","segment":0}]),
        );
        let at = junctions(&k, &[bent.clone(), bent, branch, bridge]).unwrap();
        assert_eq!(at, vec![Position::xy(5., 0.)]);
    }
}
