//! Extract retained settlement facts. Publication never advances a town process.
use crate::town::catalogue::PlaceRules;
use crate::{
    atlas::state::State,
    features::{chart::Chart, generated::Publisher, records::Attributes, Feature},
    field::poi::map_records::{generated, Record},
    town::{
        fabric::{Fabric, Holding, Town},
        geometry::Point,
    },
};
use atlas_map::{Geometry, Id, Position};
use serde_json::{json, Value};
use std::io;
mod landmarks;
pub(crate) use landmarks::work_name;
fn attrs(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Attributes {
    let mut values: Attributes = pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    values.insert("developedBy".into(), json!("regional"));
    values
}
fn write(
    state: &mut impl TownWriter,
    key: &str,
    name: &str,
    kind_layer: (&str, &str),
    geometry: Geometry,
    attributes: Attributes,
) -> io::Result<Feature> {
    let feature = state.record(Record {
        key,
        name,
        kind: kind_layer.0,
        layer: kind_layer.1,
        geometry,
        attributes,
    })?;
    if kind_layer.1 == "roads" {
        state.network(feature.clone())?;
    } else {
        state.save(feature.clone())?;
    }
    Ok(feature)
}
fn line(points: &[Point]) -> Geometry {
    Geometry::LineString {
        coordinates: points.iter().map(|p| Position::xy(p[0], p[1])).collect(),
    }
}
pub trait TownWriter {
    fn record(&mut self, record: Record<'_>) -> io::Result<Feature>;
    fn save(&mut self, feature: Feature) -> io::Result<()>;
    fn network(&mut self, feature: Feature) -> io::Result<()>;
    fn feature(&self, id: Id) -> io::Result<Option<Feature>>;
    fn inherited(&self, id: Id) -> io::Result<Option<Feature>> {
        self.feature(id)
    }
    fn feature_id(&self, key: &str) -> Id;
    fn part_name(&self, key: &str, work: &str, position: Point, town: &Town) -> io::Result<String>;
    fn spatial(&self) -> &dyn crate::spatial::SpatialKernel;
}
pub fn publish(state: &mut impl TownWriter, fabric: &Fabric) -> io::Result<()> {
    for field in &fabric.fields {
        let mut feature = write(
            state,
            &format!("town:field:{}", field.id),
            if field.pasture { "Pasture" } else { "Field" },
            ("field", "plots"),
            field.outline.clone(),
            attrs([
                (
                    "fieldUse",
                    json!(if field.pasture { "pasture" } else { "arable" }),
                ),
                ("nameStatus", json!("label")),
            ]),
        )?;
        if let Some(worker) = &field.worked_by {
            feature.relations.push(crate::features::records::Relation {
                target_id: state.feature_id(&format!(
                    "town:{}:holding:{}:yard",
                    worker.town, worker.holding.0
                )),
                kind: "workedBy".into(),
            });
            state.save(feature)?;
        }
    }
    for town in &fabric.towns {
        landmarks::publish(state, town)?;
        publish_footpaths(state, town)?;
        for (i, passage) in town.passages().iter().enumerate() {
            write(
                state,
                &format!("town:{}:passage:{i}", town.seat.key),
                "Shared passage",
                ("street", "roads"),
                passage.clone(),
                attrs([
                    ("roadClass", json!("lane")),
                    ("widths", json!([0.7, 0.7])),
                    ("nameStatus", json!("label")),
                ]),
            )?;
        }
        let streets = publish_streets(state, town)?;
        let numbers = crate::town::addresses::assign(town, state.spatial())?;
        let wards = if town.district.is_some() {
            vec![Some(town.seat.name.clone()); town.holdings().len()]
        } else {
            publish_wards(state, town)?
        };
        let characters = crate::town::neighbourhood::characters(town, state.spatial())?;
        for (holding, character) in town.holdings().iter().zip(characters) {
            holding_records(
                state,
                town,
                holding,
                &streets,
                numbers[holding.id.0 as usize],
                Neighbourhood {
                    character,
                    ward: wards[holding.id.0 as usize].as_deref(),
                },
            )?;
        }
        if town.district.is_none() {
            publish_settlement(state, town)?;
        }
    }
    Ok(())
}

fn publish_settlement(state: &mut impl TownWriter, town: &Town) -> io::Result<()> {
    let mut settlement = match state.feature(town.seat.key)? {
        Some(feature) => feature,
        None => {
            let [x, y] = town.seat.centre;
            let key = town.seat.key.to_string();
            let mut feature = state.record(Record {
                key: &key,
                name: &town.seat.name,
                kind: "settlement",
                layer: "settlements",
                geometry: Geometry::Point {
                    coordinates: Position::xy(x, y),
                },
                attributes: attrs([("population", json!(town.seat.story.people))]),
            })?;
            feature.id = town.seat.key;
            feature
        }
    };
    if matches!(settlement.geometry, Geometry::Point { .. }) && !town.holdings().is_empty() {
        let [x, y] = town.seat.centre;
        settlement.geometry = Geometry::Point {
            coordinates: Position::xy(x, y),
        };
    }
    settlement
        .attributes
        .insert("layout".into(), json!(town.layout.as_str()));
    settlement
        .attributes
        .insert("townOrder".into(), json!(town.order));
    if let Some(civic) = town.template.civic {
        settlement
            .attributes
            .insert("civicOrder".into(), json!(civic.name()));
    }
    let crafts: Vec<_> = crate::field::people::crafts::CRAFTS
        .iter()
        .filter(|craft| town.template.crafts.contains(&craft.code))
        .map(|craft| craft.system)
        .collect();
    if !crafts.is_empty() {
        settlement
            .attributes
            .insert("cityCrafts".into(), json!(crafts));
    }
    settlement.attributes.insert(
        "settlementTemplate".into(),
        json!(town.template.selected.name()),
    );
    settlement.attributes.insert(
        "templateChoices".into(),
        json!(town
            .template
            .ranked
            .iter()
            .map(|c| json!({"template":c.template.name(),"weight":c.weight,"reasons":c.reasons}))
            .collect::<Vec<_>>()),
    );
    settlement.attributes.insert("majorWorkCommissions".into(), json!(town.works.commissions.iter().map(|work|
        json!({"family":work.family.key(),"program":work.design.program(),"origin":work.origin.as_str(),"builtParts":work.members.len(),"totalParts":work.design.component_count()})
    ).collect::<Vec<_>>()));
    settlement
        .attributes
        .insert("developmentRounds".into(), json!(town.round));
    let households = town
        .holdings()
        .iter()
        .filter(|h| h.kind.definition().roles.household)
        .count();
    settlement
        .attributes
        .insert("households".into(), json!(households));
    state.save(settlement)
}
fn publish_footpaths(state: &mut impl TownWriter, town: &Town) -> io::Result<()> {
    for path in town.beaten_paths() {
        let [a, b] = crate::town::fabric::walks::path_key(path.points[0], path.points[1]);
        write(
            state,
            &format!(
                "town:{}:footpath:{},{}:{},{}",
                town.seat.key, a.0, a.1, b.0, b.1
            ),
            "Footpath",
            ("footpath", "roads"),
            line(&path.points),
            attrs([
                ("roadClass", json!("path")),
                ("widths", json!([path.width(), path.width()])),
                ("wear", json!(path.wear)),
                ("nameStatus", json!("label")),
                ("settlement", json!(town.seat.name)),
            ]),
        )?;
    }
    Ok(())
}
pub(crate) fn high_street(town: &Town) -> usize {
    town.streets()
        .iter()
        .position(|road| road.class == crate::town::network::Class::Main)
        .unwrap_or(0)
}
pub(crate) fn street_name(
    state: &impl TownWriter,
    town: &Town,
    i: usize,
    high_street: usize,
) -> io::Result<String> {
    if let Some((_, name)) = town
        .district
        .as_ref()
        .and_then(|district| district.streets.get(i))
    {
        return Ok(name.clone());
    }
    let street = &town.streets()[i];
    match &street.destination {
        Some(place) => Ok(format!("{place} Road")),
        None if i == high_street => Ok("High Street".into()),
        _ => state.part_name(
            &format!("town:{}:street:{i}", town.seat.key),
            street.class.work(),
            street.points[street.points.len() / 2],
            town,
        ),
    }
}
fn publish_streets(state: &mut impl TownWriter, town: &Town) -> io::Result<Vec<(Id, String)>> {
    let mut streets = Vec::new();
    let high_street = high_street(town);
    for (i, street) in town.streets().iter().enumerate() {
        if let Some(retained) = town.district.as_ref().and_then(|d| d.streets.get(i)) {
            streets.push(retained.clone());
            continue;
        }
        let key = format!("town:{}:street:{i}", town.seat.key);
        let name = street_name(state, town, i, high_street)?;
        let feature = state.record(Record {
            key: &key,
            name: &name,
            kind: "street",
            layer: "roads",
            geometry: line(&street.points),
            attributes: attrs([
                ("widths", json!(street.widths)),
                ("roadClass", json!(street.class.as_str())),
                ("bridgeSpans", json!(street.bridges)),
                ("settlement", json!(town.seat.name)),
                ("wear", json!(town.wear().get(i))),
                ("townProcess", json!("town.movement")),
            ]),
        })?;
        state.network(feature.clone())?;
        streets.push((feature.id, name));
    }
    Ok(streets)
}
fn publish_wards(state: &mut impl TownWriter, town: &Town) -> io::Result<Vec<Option<String>>> {
    use crate::town::{
        geometry::{angle, sub},
        network::Class,
        story::Size,
        wards::Wards,
    };
    let mut names = vec![None; town.holdings().len()];
    if town.seat.story.size() < Size::Town {
        return Ok(names);
    }
    let headings: Vec<_> = town
        .streets()
        .iter()
        .filter(|street| street.class == Class::Main)
        .filter_map(|street| {
            street
                .points
                .get(1)
                .map(|p| angle(sub(*p, street.points[0])))
        })
        .collect();
    let wards = Wards::new(town.seat.centre, &headings, None);
    let mut members = vec![Vec::new(); wards.count()];
    for h in town.holdings() {
        members[wards.of(h.slot.front)].push(h);
    }
    for (i, holdings) in members.into_iter().enumerate() {
        let Some(first) = holdings.first() else {
            continue;
        };
        let key = format!("town:{}:ward:{i}", town.seat.key);
        let name = state.part_name(&key, "ward", first.slot.front, town)?;
        let plots: Vec<_> = holdings.iter().map(|h| h.outline.clone()).collect();
        let Some(outline) = state
            .spatial()
            .union_all(&plots)
            .map_err(io::Error::other)?
        else {
            continue;
        };
        write(
            state,
            &key,
            &name,
            ("ward", "settlements"),
            outline,
            attrs([
                ("settlement", json!(town.seat.name)),
                (
                    "buildings",
                    json!(holdings.iter().map(|h| h.buildings.len()).sum::<usize>()),
                ),
            ]),
        )?;
        for h in holdings {
            names[h.id.0 as usize] = Some(name.clone());
        }
    }
    Ok(names)
}
struct Neighbourhood<'a> {
    character: &'a str,
    ward: Option<&'a str>,
}
struct HouseAddress<'a> {
    street_id: Id,
    street: &'a str,
    resolved: crate::town::addresses::Address,
    label: String,
}
impl HouseAddress<'_> {
    /// The address a holder shows. Its street is its `fronts` or `accessFrom` relation.
    fn attributes(&self) -> [(String, Value); 4] {
        [
            ("street".into(), json!(self.street)),
            ("address".into(), json!(self.label)),
            ("addressNumber".into(), json!(self.resolved.number)),
            ("addressJunction".into(), json!(self.resolved.junction)),
        ]
    }
    fn fronts(&self) -> crate::features::records::Relation {
        crate::features::records::Relation {
            target_id: self.street_id,
            kind: if self.resolved.indirect {
                "accessFrom"
            } else {
                "fronts"
            }
            .into(),
        }
    }
}
fn operating_partner(
    state: &impl TownWriter,
    endpoint: &crate::town::fabric::Endpoint,
) -> io::Result<Option<Id>> {
    use crate::town::fabric::Endpoint;
    let id = match endpoint {
        Endpoint::Premises { town, holding } => {
            return Ok(Some(
                state.feature_id(&format!("town:{town}:holding:{}:yard", holding.0)),
            ))
        }
        Endpoint::Field(id) => state.feature_id(&format!("town:field:{id}")),
        Endpoint::External(id) => *id,
        Endpoint::Catchment { .. } => return Ok(None),
    };
    Ok(state.feature(id)?.map(|feature| feature.id))
}

fn operating_relations(
    state: &impl TownWriter,
    town: &Town,
    holding: &Holding,
    yard: &mut Feature,
) -> io::Result<()> {
    for (id, relation) in [
        (holding.institution, "inPrecinct"),
        (holding.access_via, "accessVia"),
        (holding.slot.participant, "frontsOnto"),
    ]
    .into_iter()
    .filter_map(|(id, relation)| id.map(|id| (id, relation)))
    .chain(
        holding
            .sponsors
            .iter()
            .copied()
            .map(|id| (id, "sponsoredBy")),
    ) {
        yard.relations.push(crate::features::records::Relation {
            target_id: state.feature_id(&format!("town:{}:holding:{}:yard", town.seat.key, id.0)),
            kind: relation.into(),
        });
    }
    for tie in &holding.ties {
        let Some(target_id) = operating_partner(state, &tie.destination)? else {
            continue;
        };
        yard.relations.push(crate::features::records::Relation {
            target_id,
            kind: tie.purpose.relation().into(),
        });
    }
    Ok(())
}
fn holding_records(
    state: &mut impl TownWriter,
    town: &Town,
    holding: &Holding,
    streets: &[(Id, String)],
    resolved: Option<crate::town::addresses::Address>,
    neighbourhood: Neighbourhood<'_>,
) -> io::Result<()> {
    let definition = holding.kind.definition();
    let key = format!("town:{}:holding:{}", town.seat.key, holding.id.0);
    let address = resolved
        .and_then(|a| Some((streets.get(a.street)?, a)))
        .map(|((street_id, street), resolved)| HouseAddress {
            street_id: *street_id,
            street,
            resolved,
            label: crate::town::addresses::address(resolved.number, street),
        });
    let common = || {
        let mut values = attrs([
            ("settlement", json!(town.seat.name)),
            ("entrance", json!(holding.slot.front)),
            ("use", json!(definition.legacy_use.as_str())),
            ("placeKind", json!(holding.kind)),
            ("habitat", json!(holding.slot.habitat)),
            ("tenure", json!(holding.slot.tenure)),
            ("secondaryKind", json!(holding.secondary)),
            (
                "craft",
                json!(holding
                    .craft
                    .and_then(|code| crate::field::people::crafts::CRAFTS
                        .iter()
                        .find(|c| c.code == code)
                        .map(|c| c.name))),
            ),
            ("placeLabel", json!(definition.label)),
            (
                "secondaryUse",
                json!(holding.secondary.map(|kind| kind.definition().label)),
            ),
            ("means", json!(holding.means)),
            ("tradingSupport", json!(holding.support)),
            ("condition", json!(holding.condition)),
            ("occupation", json!(holding.occupation)),
            ("operatingTier", json!(holding.operation_tier)),
            ("consecration", json!(holding.consecration)),
            ("openOccupation", json!(holding.outdoor)),
            ("crowding", json!(holding.crowding)),
            ("ward", json!(neighbourhood.ward)),
            ("character", json!(neighbourhood.character)),
            ("developmentCause", json!(holding.cause)),
            ("townProcess", json!("town.construction")),
        ]);
        values.extend(address.iter().flat_map(HouseAddress::attributes));
        if let Some(route) = town.approach(holding.id).filter(|route| {
            route.points.len() > 1 && address.as_ref().is_some_and(|a| a.resolved.indirect)
        }) {
            values.insert("accessRoute".into(), json!(line(&route.points)));
        }
        values
    };
    let mut yard_attributes = common();
    if let Some((role, _)) = town.founding_sites.iter().find(|(_, id)| *id == holding.id) {
        yard_attributes.insert("foundingRole".into(), json!(role));
    }
    if let Some(cover) = definition.roles.ground_cover {
        yard_attributes.insert("publicSurface".into(), json!(cover));
    }
    if !holding.public {
        yard_attributes.insert("nameStatus".into(), json!("label"));
    }
    let mut yard = write(
        state,
        &format!("{key}:yard"),
        if holding.public {
            definition.label
        } else {
            address.as_ref().map_or(definition.label, |a| &a.label)
        },
        (if holding.public { "square" } else { "yard" }, "plots"),
        holding.outline.clone(),
        yard_attributes,
    )?;
    landmarks::relate_component(state, town, holding.id, &mut yard)?;
    operating_relations(state, town, holding, &mut yard)?;
    yard.relations
        .extend(address.iter().map(HouseAddress::fronts));
    if !yard.relations.is_empty() {
        state.save(yard)?;
    }
    if let Some(furnishing) = definition.roles.furnishing.and_then(|f| f(&town.seat)) {
        let position = state
            .spatial()
            .interior_position(&holding.outline)
            .map_err(io::Error::other)?;
        write(
            state,
            &format!("{key}:furnishing"),
            furnishing,
            (furnishing, "objects"),
            Geometry::Point {
                coordinates: position,
            },
            attrs([("nameStatus", json!("label"))]),
        )?;
    }
    for (i, geometry) in holding.buildings.iter().enumerate() {
        let mut attributes = common();
        attributes.insert("walkingDestination".into(), true.into());
        attributes.insert("storeys".into(), json!(holding.storeys[i]));
        attributes.insert(
            "occupants".into(),
            json!((5. * holding.occupation * (1. + holding.crowding)).round() as u32),
        );
        let building = definition.building(i);
        attributes.insert("use".into(), json!(building.legacy_use.as_str()));
        attributes.insert("buildingFunction".into(), json!(building.function));
        let name = state.part_name(
            &format!("{key}:building:{i}"),
            building.naming_work,
            holding.slot.front,
            town,
        )?;
        let mut feature = write(
            state,
            &format!("{key}:building:{i}"),
            &format!("{name} {}", building.label),
            ("building", "structures"),
            geometry.clone(),
            attributes,
        )?;
        feature
            .relations
            .extend(address.iter().map(HouseAddress::fronts));
        feature.causes.push(holding.cause.clone());
        state.save(feature)?;
    }
    Ok(())
}

fn network(state: &mut State, feature: Feature) -> io::Result<()> {
    let contracted = state.scope.contracted.contains(&feature.id);
    let scope = &state.scope;
    let publisher = Publisher {
        world: scope.world,
        area: scope.area,
        space: Some(scope.space),
        owns_map_geography: scope.owns_map_geography,
        chart: Chart {
            domain: &scope.domain,
            bounds: scope.domain_bounds,
            cylindrical: scope.cylindrical,
        },
        precision: scope.precision,
    };
    publisher.network(
        state.records.features.as_mut(),
        state.records.networks.as_mut(),
        feature,
        contracted,
    )?;
    Ok(())
}
impl TownWriter for State {
    fn record(&mut self, record: Record<'_>) -> io::Result<Feature> {
        generated(self, record)
    }
    fn save(&mut self, feature: Feature) -> io::Result<()> {
        self.write_feature(feature).map(|_| ())
    }
    fn network(&mut self, feature: Feature) -> io::Result<()> {
        network(self, feature)
    }
    fn feature(&self, id: Id) -> io::Result<Option<Feature>> {
        self.records.features.get(id)
    }
    fn inherited(&self, id: Id) -> io::Result<Option<Feature>> {
        match self.records.source_features.as_deref() {
            Some(reader) => reader.get(id),
            None => self.feature(id),
        }
    }
    fn feature_id(&self, key: &str) -> Id {
        crate::identity::generated_id(self.scope.area, key)
    }
    fn part_name(&self, key: &str, work: &str, position: Point, town: &Town) -> io::Result<String> {
        Ok(self
            .naming
            .work(
                &self.scope,
                key,
                work,
                position,
                town.seat.culture.as_deref(),
            )?
            .name)
    }
    fn spatial(&self) -> &dyn crate::spatial::SpatialKernel {
        self.spatial.as_ref()
    }
}
