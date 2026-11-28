//! How alike two finished maps are. Each map is read from its published GIS storage and
//! tallied into mixes: its premises, homes, storeys, households' means, plots, ways,
//! districts and land uses. The share two maps have in common in a mix is what both hold
//! of each entry, summed: all of it for two maps with the same proportions, none for two
//! with nothing alike. Two maps of the same ground are also set over each other, to say
//! how much stands in the same places. Each map's own figures follow: how far apart its
//! households' means lie, how far rich and poor streets stand apart, and how far its
//! streets keep to two directions.
//!
//! Premises are counted by holding. A holding publishes one building feature for each of
//! its buildings, and each repeats the holding's label, means, street and number.
use crate::{client::Server, report::features};
use atlas_map::{Geometry, MapFeature, MapRef, Position};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

/// The mixes a map is tallied into, in the order they are printed.
const MIXES: [&str; 13] = [
    "premises other than homes",
    "homes",
    "homes that also trade",
    "storeys",
    "household means",
    "premises by how mixed their street is",
    "plot sizes",
    "ways by length",
    "districts by economic role",
    "districts by resident character",
    "district traits",
    "civic places",
    "land use by area",
];
/// The ways people travel by land. A published `lane` is a sea lane and is left out.
const WAYS: [&str; 5] = ["thoroughfare", "road", "street", "footpath", "trail"];
/// The ways laid as streets, whose directions show how a place was laid out. Paths worn to
/// doors and trails are left out.
const LAID: [&str; 3] = ["thoroughfare", "road", "street"];
/// The least difference in means, summed in squares over a map's homes, that is a
/// difference and not the residue of adding equal numbers.
const LEAST_DIFFERENCE: f64 = 1e-9;

type Bands = &'static [(f64, &'static str)];
const MEANS: (Bands, &str) = (
    &[
        (0.2, "very poor"),
        (0.4, "poor"),
        (0.6, "middling"),
        (0.8, "comfortable"),
    ],
    "rich",
);
const PLOTS: (Bands, &str) = (
    &[
        (100., "under 100 m2"),
        (200., "100 to 200 m2"),
        (400., "200 to 400 m2"),
        (800., "400 to 800 m2"),
        (1600., "800 to 1,600 m2"),
    ],
    "over 1,600 m2",
);
/// A street by the share of its premises that are not homes.
const MIXING: (Bands, &str) = (
    &[
        (0.02, "homes only"),
        (0.25, "mostly homes"),
        (0.6, "homes and other premises mixed"),
    ],
    "mostly other premises",
);
fn band(value: f64, (edges, last): (Bands, &'static str)) -> &'static str {
    edges
        .iter()
        .find(|(edge, _)| value < *edge)
        .map_or(last, |(_, name)| name)
}

// hpc-exempt: a few dozen named tallies per map, printed in name order.
type Mix = BTreeMap<String, f64>;
type Attributes = BTreeMap<String, Value>;

/// One holding, as each of its buildings publishes it.
struct Holding {
    label: String,
    /// Whether any of its buildings is a dwelling.
    home: bool,
    means: Option<f64>,
    street: Option<String>,
    trade: Option<String>,
}
impl Holding {
    /// What every building of one holding repeats, and no two holdings are likely to share.
    fn key(attributes: &Attributes) -> String {
        ["placeLabel", "means", "street", "addressNumber"]
            .map(|name| attributes.get(name).map_or(String::new(), Value::to_string))
            .join("|")
    }
    fn of(attributes: &Attributes) -> Self {
        let text = |name: &str| {
            let value = attributes.get(name).and_then(Value::as_str);
            value.filter(|text| !text.is_empty()).map(str::to_owned)
        };
        Self {
            label: text("placeLabel").unwrap_or_else(|| "unnamed".into()),
            home: false,
            means: attributes.get("means").and_then(Value::as_f64),
            street: text("street"),
            trade: text("secondaryUse"),
        }
    }
}

/// How far a map's laid streets keep to two directions square to each other. Each street
/// is a length and a direction turned four times over, so a street and the streets square
/// to it point the same way, and a street that bends points nowhere.
#[derive(Default)]
struct Directions(Vec<[f64; 3]>);
impl Directions {
    fn way(&mut self, lines: &[&[Position]]) {
        let mut street = [0.; 3];
        for pair in lines.iter().flat_map(|line| line.windows(2)) {
            let ([ax, ay, _], [bx, by, _]) = (pair[0].coordinates(), pair[1].coordinates());
            let (dx, dy) = (bx - ax, by - ay);
            let (length, turned) = (dx.hypot(dy), 4. * dy.atan2(dx));
            street[0] += length * turned.cos();
            street[1] += length * turned.sin();
            street[2] += length;
        }
        if street[2] > 0. {
            self.0.push(street);
        }
    }
    /// The share of street length that keeps to the two directions: all of it on a
    /// surveyed grid. Beside it, the share streets of these lengths and straightness keep
    /// when each takes its direction independently of the others.
    fn kept(&self) -> Option<[f64; 2]> {
        let sum = |part: usize| -> f64 { self.0.iter().map(|street| street[part]).sum() };
        let length = sum(2);
        let independent: f64 = self.0.iter().map(|s| s[0] * s[0] + s[1] * s[1]).sum();
        (length > 0.).then(|| [sum(0).hypot(sum(1)) / length, independent.sqrt() / length])
    }
}

/// The sides, in metres, of the squares two maps of one ground are set over each other
/// on. A street is the same street when the other map's runs on its square or the next,
/// so within a street's width or two and nearer than the back lane a plot's depth away. A
/// building is in the same place when it stands on the same square, about a house plot.
const STREET_SQUARE: f64 = 10.;
const BUILDING_SQUARE: f64 = 20.;
type Square = [i64; 2];
fn square(x: f64, y: f64, side: f64) -> Square {
    [(x / side).floor() as i64, (y / side).floor() as i64]
}

/// Where a map's own streets run and its buildings stand, by square, so that two maps made
/// of the same ground can be set over each other. The mixes say what a map holds; this
/// says whether it holds it in the same places.
#[derive(Default)]
struct Ground {
    // hpc-exempt: the sparse squares one map's streets cross.
    streets: std::collections::BTreeSet<Square>,
    // hpc-exempt: the sparse squares one map's buildings stand on, by kind.
    buildings: BTreeMap<Square, Mix>,
}
impl Ground {
    fn way(&mut self, lines: &[&[Position]]) {
        for pair in lines.iter().flat_map(|line| line.windows(2)) {
            let ([ax, ay, _], [bx, by, _]) = (pair[0].coordinates(), pair[1].coordinates());
            let steps = ((bx - ax).hypot(by - ay) / (STREET_SQUARE / 4.))
                .ceil()
                .max(1.);
            for step in 0..=steps as usize {
                let along = step as f64 / steps;
                let (x, y) = (ax + (bx - ax) * along, ay + (by - ay) * along);
                self.streets.insert(square(x, y, STREET_SQUARE));
            }
        }
    }
    fn building(&mut self, shape: &Geometry, label: &str) {
        let corner = match shape {
            Geometry::Polygon { coordinates } => coordinates.first().and_then(|ring| ring.first()),
            _ => None,
        };
        if let Some([x, y, _]) = corner.map(|corner| corner.coordinates()) {
            let here = self
                .buildings
                .entry(square(x, y, BUILDING_SQUARE))
                .or_default();
            *here.entry(label.to_owned()).or_default() += 1.;
        }
    }
    /// The squares of this map's streets that have a street of `other` on them or on a
    /// square beside them.
    fn streets_beside(&self, other: &Self) -> usize {
        let beside = |[x, y]: Square| {
            (-1..=1).any(|dx| (-1..=1).any(|dy| other.streets.contains(&[x + dx, y + dy])))
        };
        self.streets.iter().filter(|at| beside(**at)).count()
    }
    /// The share of both maps' street squares that have the other map's street on or
    /// beside them, and the share of both maps' buildings standing on a square where the
    /// other has a building of the same kind. Nothing for maps that share no ground.
    fn shared(&self, other: &Self) -> Option<[f64; 2]> {
        let streets = self.streets_beside(other) + other.streets_beside(self);
        let count =
            |ground: &Self| -> f64 { ground.buildings.values().flat_map(Mix::values).sum() };
        let same: f64 = self
            .buildings
            .iter()
            .filter_map(|(at, here)| other.buildings.get(at).map(|there| (here, there)))
            .flat_map(|(here, there)| {
                here.iter()
                    .map(|(kind, held)| held.min(there.get(kind).copied().unwrap_or(0.)))
            })
            .sum();
        let whole = [
            (self.streets.len() + other.streets.len()) as f64,
            count(self) + count(other),
        ];
        (streets > 0 && whole[1] > 0.).then(|| [streets as f64 / whole[0], 2. * same / whole[1]])
    }
}

/// What a map's own figures are measured from, gathered as its holdings are settled.
#[derive(Default)]
struct Layout {
    /// Every home's means.
    means: Vec<f64>,
    /// Each addressed home's street and means.
    homes: Vec<(String, f64)>,
    // hpc-exempt: a few hundred named streets of one map.
    /// The premises addressed on each street: all of them, and those that are not homes.
    premises: BTreeMap<String, [f64; 2]>,
    directions: Directions,
}
impl Layout {
    fn holding(&mut self, holding: &Holding) {
        let means = holding.means.filter(|_| holding.home);
        self.means.extend(means);
        let Some(street) = &holding.street else {
            return;
        };
        let on_street = self.premises.entry(street.clone()).or_default();
        on_street[0] += 1.;
        on_street[1] += f64::from(!holding.home);
        self.homes
            .extend(means.map(|means| (street.clone(), means)));
    }
    /// The tenth and ninetieth of a hundred homes ranked by their means.
    fn spread(&self) -> Option<[f64; 2]> {
        let mut means = self.means.clone();
        // hpc-exempt: one map's homes, ranked once for a printed figure.
        means.sort_by(f64::total_cmp);
        let last = means.len().checked_sub(1)?;
        Some([means[last / 10], means[last * 9 / 10]])
    }
}

/// The share of the difference in homes' means that lies between streets, not within
/// them, beside the share chance alone leaves between streets of these sizes.
fn apart(homes: &[(String, f64)]) -> Option<[f64; 2]> {
    let count = homes.len() as f64;
    let mean = homes.iter().map(|(_, means)| means).sum::<f64>() / count;
    let whole: f64 = homes.iter().map(|(_, means)| (means - mean).powi(2)).sum();
    // hpc-exempt: a few hundred named streets of one map.
    let mut streets = BTreeMap::<&str, [f64; 2]>::new();
    for (street, means) in homes {
        let street = streets.entry(street).or_default();
        street[0] += 1.;
        street[1] += means;
    }
    let between: f64 = streets
        .values()
        .map(|[homes, means]| homes * (means / homes - mean).powi(2))
        .sum();
    (whole > LEAST_DIFFERENCE && homes.len() > 1)
        .then(|| [between / whole, (streets.len() as f64 - 1.) / (count - 1.)])
}

/// One map's tallies, by mix, and what its own figures are measured from.
#[derive(Default)]
struct Tallies {
    mixes: BTreeMap<&'static str, Mix>,
    // hpc-exempt: one map's holdings by what their buildings repeat.
    holdings: BTreeMap<String, Holding>,
    layout: Layout,
    ground: Ground,
}
impl Tallies {
    fn add(&mut self, mix: &'static str, entry: &str, amount: f64) {
        *self
            .mixes
            .entry(mix)
            .or_default()
            .entry(entry.to_owned())
            .or_default() += amount;
    }
    fn building(&mut self, attributes: &Attributes, shape: &Geometry) {
        if let Some(storeys) = attributes.get("storeys").and_then(Value::as_u64) {
            self.add("storeys", &storeys.to_string(), 1.);
        }
        let function = attributes.get("buildingFunction").and_then(Value::as_str);
        let holding = self
            .holdings
            .entry(Holding::key(attributes))
            .or_insert_with(|| Holding::of(attributes));
        holding.home |= function == Some("residential");
        self.ground.building(shape, &holding.label);
    }
    fn district(&mut self, feature: &MapFeature) {
        let Some(program) = feature.attributes.get("districtProgram") else {
            return;
        };
        for (mix, key) in [
            ("districts by economic role", "economic"),
            ("districts by resident character", "social"),
        ] {
            if let Some(entry) = program.get(key).and_then(Value::as_str) {
                self.add(mix, entry, 1.);
            }
        }
        for entry in program
            .get("traits")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            self.add("district traits", entry, 1.);
        }
    }
    fn way(&mut self, feature: &MapFeature) {
        let class = feature.attributes.get("roadClass").and_then(Value::as_str);
        let lines = lines(&feature.geometry);
        let length: f64 = lines.iter().map(|line| length(line)).sum();
        self.add("ways by length", class.unwrap_or(&feature.kind), length);
        if LAID.contains(&feature.kind.as_str()) {
            self.layout.directions.way(&lines);
        }
        // A district's roads and thoroughfares come down from its City; its streets are
        // what its own rounds laid.
        if feature.kind == "street" {
            self.ground.way(&lines);
        }
    }
    fn feature(&mut self, feature: &MapFeature) {
        let named = |names: &[&str]| {
            let found = names.iter().find_map(|name| feature.attributes.get(*name));
            found.and_then(Value::as_str).unwrap_or("unnamed")
        };
        match feature.kind.as_str() {
            "building" => self.building(&feature.attributes, &feature.geometry),
            "district" => self.district(feature),
            "yard" => self.add("plot sizes", band(area(&feature.geometry), PLOTS), 1.),
            "cityPlace" => self.add(
                "civic places",
                named(&["catalogueUse", "use", "symbol"]),
                1.,
            ),
            "urbanGround" => {
                self.add(
                    "land use by area",
                    named(&["groundUse"]),
                    area(&feature.geometry),
                );
            }
            kind if WAYS.contains(&kind) => self.way(feature),
            _ => {}
        }
    }
    /// Tallies the holdings once every building is read, then sorts each street's premises
    /// into how mixed that street is.
    fn settle(&mut self) {
        for holding in std::mem::take(&mut self.holdings).into_values() {
            self.layout.holding(&holding);
            if !holding.home {
                self.add("premises other than homes", &holding.label, 1.);
                continue;
            }
            self.add("homes", &holding.label, 1.);
            let trade = holding.trade.as_deref().unwrap_or("no trade");
            self.add("homes that also trade", trade, 1.);
            if let Some(means) = holding.means {
                self.add("household means", band(means, MEANS), 1.);
            }
        }
        let streets = std::mem::take(&mut self.layout.premises);
        for [premises, others] in streets.values() {
            let mixing = band(others / premises, MIXING);
            self.add("premises by how mixed their street is", mixing, *premises);
        }
        self.layout.premises = streets;
    }
    /// The map's own figures, one printed line each.
    fn figures(&self) -> Vec<String> {
        let percent = |share: f64| format!("{:.0}%", 100. * share);
        let spread = self.layout.spread().map(|[low, high]| {
            format!("homes' means, tenth to ninetieth of a hundred: {low:.2} to {high:.2}")
        });
        let apart = apart(&self.layout.homes).map(|[between, chance]| {
            format!(
                "difference in means lying between streets: {} (chance alone {})",
                percent(between),
                percent(chance)
            )
        });
        let kept = self.layout.directions.kept().map(|[kept, independent]| {
            format!(
                "street length keeping to two directions square to each other: {} (streets \
                 laid independently {}, a grid 100%)",
                percent(kept),
                percent(independent)
            )
        });
        [spread, apart, kept].into_iter().flatten().collect()
    }
}

fn lines(shape: &Geometry) -> Vec<&[Position]> {
    match shape {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(Vec::as_slice).collect()
        }
        _ => Vec::new(),
    }
}
fn length(line: &[Position]) -> f64 {
    line.windows(2)
        .map(|pair| {
            let ([ax, ay, _], [bx, by, _]) = (pair[0].coordinates(), pair[1].coordinates());
            (bx - ax).hypot(by - ay)
        })
        .sum()
}
fn ring_area(ring: &[Position]) -> f64 {
    let mut twice = 0.;
    for pair in ring.windows(2) {
        let ([ax, ay, _], [bx, by, _]) = (pair[0].coordinates(), pair[1].coordinates());
        twice += ax * by - bx * ay;
    }
    twice.abs() / 2.
}
/// A polygon's area: its outer ring less its holes.
fn polygon_area(rings: &[Vec<Position>]) -> f64 {
    let holes: f64 = rings.iter().skip(1).map(|ring| ring_area(ring)).sum();
    (rings.first().map_or(0., |ring| ring_area(ring)) - holes).max(0.)
}
fn area(shape: &Geometry) -> f64 {
    match shape {
        Geometry::Polygon { coordinates } => polygon_area(coordinates),
        Geometry::MultiPolygon { coordinates } => {
            coordinates.iter().map(|rings| polygon_area(rings)).sum()
        }
        _ => 0.,
    }
}

/// The share two mixes have in common: for each entry the lesser of its shares, summed.
fn in_common(a: &Mix, b: &Mix) -> f64 {
    let (whole_a, whole_b): (f64, f64) = (a.values().sum(), b.values().sum());
    if whole_a <= 0. || whole_b <= 0. {
        return 0.;
    }
    a.iter()
        .map(|(entry, amount)| (amount / whole_a).min(b.get(entry).map_or(0., |v| v / whole_b)))
        .sum()
}
/// A mix's largest entries with their shares, largest first.
fn leading(mix: &Mix, count: usize) -> String {
    let whole: f64 = mix.values().sum();
    if whole <= 0. {
        return "nothing measured".into();
    }
    let mut entries: Vec<_> = mix.iter().collect();
    // hpc-exempt: a few dozen entries of one printed mix.
    entries.sort_by(|a, b| b.1.total_cmp(a.1).then(a.0.cmp(b.0)));
    entries
        .into_iter()
        .take(count)
        .map(|(entry, amount)| format!("{entry} {:.0}%", 100. * amount / whole))
        .collect::<Vec<_>>()
        .join(", ")
}

fn tally(server: &Server, reference: &MapRef) -> io::Result<Tallies> {
    let map: Value = server.call("maps/read", &json!({"method": "open", "args": [reference]}))?;
    let primary = map["primarySpaceId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let mut tallies = Tallies::default();
    features(server, reference, &primary, None, |feature| {
        tallies.feature(&feature);
    })?;
    tallies.settle();
    Ok(tallies)
}

/// Prints, for every mix both maps hold, the share they have in common and each map's
/// leading entries, then each map's own figures.
pub fn compare(server: &Server, maps: [(&str, &MapRef); 2]) -> io::Result<()> {
    let [(name_a, a), (name_b, b)] = maps;
    let (a, b) = (tally(server, a)?, tally(server, b)?);
    println!("{name_a} against {name_b}");
    for mix in MIXES {
        let (Some(mix_a), Some(mix_b)) = (a.mixes.get(mix), b.mixes.get(mix)) else {
            continue;
        };
        println!("  {mix}: {:.0}% in common", 100. * in_common(mix_a, mix_b));
        println!("    {name_a}: {}", leading(mix_a, 6));
        println!("    {name_b}: {}", leading(mix_b, 6));
    }
    if let Some([streets, buildings]) = a.ground.shared(&b.ground) {
        println!(
            "  on the same ground: {:.0}% of their own streets run together (within about \
             {STREET_SQUARE:.0} m), {:.0}% of buildings stand where the other has one of the \
             same kind (the same {BUILDING_SQUARE:.0} m square)",
            100. * streets,
            100. * buildings
        );
    }
    for (name, tallies) in [(name_a, &a), (name_b, &b)] {
        for figure in tallies.figures() {
            println!("  {name}: {figure}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mix(entries: &[(&str, f64)]) -> Mix {
        entries
            .iter()
            .map(|(entry, amount)| ((*entry).to_owned(), *amount))
            .collect()
    }
    fn ring(points: &[[f64; 2]]) -> Vec<Position> {
        points.iter().map(|[x, y]| Position::xy(*x, *y)).collect()
    }
    /// A building's outline with its first corner at `x`, `y`.
    fn plot(x: f64, y: f64) -> Geometry {
        Geometry::Polygon {
            coordinates: vec![ring(&[[x, y], [x + 5., y], [x + 5., y + 5.], [x, y]])],
        }
    }
    /// A straight street of a hundred metres at `degrees`.
    fn street(degrees: f64) -> Vec<Position> {
        let turn = degrees.to_radians();
        ring(&[[0., 0.], [100. * turn.cos(), 100. * turn.sin()]])
    }
    fn building(label: &str, function: &str, means: f64, street: &str, number: u32) -> Attributes {
        [
            ("placeLabel", json!(label)),
            ("buildingFunction", json!(function)),
            ("use", json!("house")),
            ("means", json!(means)),
            ("street", json!(street)),
            ("addressNumber", json!(number)),
            ("secondaryUse", json!("")),
            ("storeys", json!(1)),
        ]
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value))
        .collect()
    }

    #[test]
    fn maps_with_the_same_proportions_have_everything_in_common_whatever_their_size() {
        let town = mix(&[("brewhouse", 2.), ("smithy", 6.)]);
        let city = mix(&[("brewhouse", 50.), ("smithy", 150.)]);
        assert!((in_common(&town, &city) - 1.).abs() < 1e-12);
        // A town nine parts smiths and one nine parts brewers share only what both hold.
        let brewers = mix(&[("brewhouse", 9.), ("smithy", 1.)]);
        let smiths = mix(&[("brewhouse", 1.), ("smithy", 9.)]);
        assert!((in_common(&brewers, &smiths) - 0.2).abs() < 1e-12);
        // Nothing alike, and nothing to compare.
        assert_eq!(in_common(&mix(&[("inn", 3.)]), &mix(&[("mill", 3.)])), 0.);
        assert_eq!(in_common(&mix(&[]), &town), 0.);
        assert_eq!(leading(&mix(&[("road", 0.)]), 3), "nothing measured");
    }

    #[test]
    fn a_polygon_is_measured_less_its_holes() {
        let block = Geometry::Polygon {
            coordinates: vec![
                ring(&[[0., 0.], [10., 0.], [10., 10.], [0., 10.], [0., 0.]]),
                ring(&[[2., 2.], [4., 2.], [4., 4.], [2., 4.], [2., 2.]]),
            ],
        };
        assert_eq!(area(&block), 96.);
        assert_eq!(leading(&mix(&[("a", 3.), ("b", 1.)]), 1), "a 75%");
        assert_eq!(band(150., PLOTS), "100 to 200 m2");
        assert_eq!(band(5_000., PLOTS), "over 1,600 m2");
    }

    #[test]
    fn a_grid_keeps_to_two_directions_and_streets_every_way_keep_to_none() {
        // A grid turned twenty degrees: streets one way and the streets square to them.
        let mut grid = Directions::default();
        for degrees in [20., 110., 20., 110.] {
            grid.way(&[&street(degrees)]);
        }
        let [kept, independent] = grid.kept().expect("streets were laid");
        assert!((kept - 1.).abs() < 1e-9, "{kept}");
        // Four equal streets laid independently would keep half as much.
        assert!((independent - 0.5).abs() < 1e-9, "{independent}");
        // A street for every degree keeps to no direction.
        let mut every_way = Directions::default();
        for degree in 0..180 {
            every_way.way(&[&street(f64::from(degree))]);
        }
        assert!(every_way.kept().expect("streets were laid")[0] < 1e-9);
        // A street that turns half a right angle has no direction of its own to keep.
        let mut bent = Directions::default();
        bent.way(&[&ring(&[[0., 0.], [100., 0.], [200., 100.]])]);
        let [kept, independent] = bent.kept().expect("a street was laid");
        assert!(kept < 0.2 && (kept - independent).abs() < 1e-9, "{kept}");
        assert_eq!(Directions::default().kept(), None);
    }

    #[test]
    fn means_lie_between_streets_only_where_rich_and_poor_live_on_different_streets() {
        let home = |street: &str, means: f64| (street.to_owned(), means);
        // A rich street and a poor street: all of the difference lies between them.
        let sorted = [
            home("high", 0.9),
            home("high", 0.9),
            home("low", 0.1),
            home("low", 0.1),
        ];
        assert!((apart(&sorted).expect("homes")[0] - 1.).abs() < 1e-12);
        // Each street houses both: none of it does.
        let mingled = [
            home("high", 0.9),
            home("high", 0.1),
            home("low", 0.9),
            home("low", 0.1),
        ];
        let [between, chance] = apart(&mingled).expect("homes");
        assert!(between.abs() < 1e-12);
        assert!((chance - 1. / 3.).abs() < 1e-12);
        assert_eq!(apart(&[home("only", 0.5)]), None);
        // Homes of one means differ in nothing, whatever adding them up leaves over.
        let alike = [home("a", 0.1), home("a", 0.1), home("b", 0.1)];
        assert_eq!(apart(&alike), None);
    }

    #[test]
    fn a_holding_is_counted_once_however_many_buildings_it_has() {
        let mut tallies = Tallies::default();
        let mut add = |label, function, means, street, number| {
            let attributes = building(label, function, means, street, number);
            tallies.building(&attributes, &plot(0., 0.));
        };
        // A courtyard household of three buildings, and a farmstead with its barn.
        for _ in 0..3 {
            add("courtyard household", "residential", 0.7, "High", 1);
        }
        add("farmstead", "residential", 0.3, "High", 2);
        add("farmstead", "economic", 0.3, "High", 2);
        // An almshouse is published as a house and is no household's home.
        add("almshouse", "civic", 0.5, "Low", 1);
        tallies.settle();
        assert_eq!(
            tallies.mixes["homes"],
            mix(&[("courtyard household", 1.), ("farmstead", 1.)])
        );
        assert_eq!(
            tallies.mixes["premises other than homes"],
            mix(&[("almshouse", 1.)])
        );
        assert_eq!(tallies.mixes["storeys"], mix(&[("1", 6.)]));
        assert_eq!(tallies.layout.spread(), Some([0.3, 0.3]));
        assert_eq!(tallies.layout.premises["High"], [2., 0.]);
        assert_eq!(tallies.layout.premises["Low"], [1., 1.]);
    }

    #[test]
    fn two_maps_of_one_ground_share_what_stands_in_the_same_places() {
        // A street running east with a smithy and a brewhouse along it.
        let town = |north: f64, second: &str| {
            let mut ground = Ground::default();
            ground.way(&[&ring(&[[0., north], [200., north]])]);
            ground.building(&plot(50., north + 5.), "smithy");
            ground.building(&plot(150., north + 5.), second);
            ground
        };
        let first = town(10., "brewhouse");
        // The same town is all shared with itself.
        assert_eq!(first.shared(&town(10., "brewhouse")), Some([1., 1.]));
        // A street a few metres over still runs together; a different trade in one of its
        // two buildings leaves half the buildings shared.
        assert_eq!(first.shared(&town(12., "inn")), Some([1., 0.5]));
        // A street laid a hundred metres away shares nothing, and so says nothing.
        assert_eq!(first.shared(&town(110., "brewhouse")), None);
    }
}
