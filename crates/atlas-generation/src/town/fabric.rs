//! One owner for holdings, occupation and persistent access; edits preserve existing identities.
mod network;
mod projects;
use super::{
    catalogue::Kind, geometry::Point, network::Street, plots::Slot, seat::Seat, story::Layout,
};
use crate::town::catalogue::PlaceRules;
use atlas_map::{
    spatial::{Overlay, SpatialKernel},
    Geometry, Position,
};
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct HoldingId(pub u32);
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Endpoint {
    Premises { town: String, holding: HoldingId },
    Field(String),
    Catchment(String),
    External(String),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OperatingTie {
    pub purpose: super::catalogue::Operation,
    pub destination: Endpoint,
    pub entrance: Point,
    pub access: super::catalogue::AccessUse,
    pub strength: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Holding {
    pub sponsors: Vec<HoldingId>,
    pub ties: Vec<OperatingTie>,
    pub storeys: Vec<u32>,
    pub id: HoldingId,
    pub slot: Slot,
    pub outline: Geometry,
    pub buildings: Vec<Geometry>,
    pub kind: Kind,
    pub secondary: Option<Kind>,
    pub craft: Option<i32>,
    pub access_via: Option<HoldingId>,
    pub institution: Option<HoldingId>,
    pub means: f64,
    pub support: f64,
    pub condition: f64,
    pub occupation: f64,
    pub crowding: f64,
    pub established: u32,
    pub public: bool,
    pub outdoor: bool,
    pub cause: String,
    pub claim: f64,
}
impl Holding {
    pub(crate) fn pledge(&self) -> f64 {
        self.means * self.occupation.clamp(0., 1.) * self.condition.clamp(0., 1.) * 0.4
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Town {
    pub seat: Seat,
    pub layout: Layout,
    streets: Vec<Street>,
    growing_ways: Vec<(super::network::Arm, usize)>,
    passages: Vec<Geometry>,
    wear: Vec<f64>,
    traffic: Vec<super::access::StreetLoad>,
    holdings: Vec<Holding>,
    pub round: u32,
    pub effort: f64,
    pub access_effort: f64,
    purposes: Vec<Purpose>,
}
impl Holding {
    pub fn mode_for(
        &self,
        purpose: super::catalogue::Operation,
    ) -> Option<super::catalogue::AccessUse> {
        let primary = self.kind.definition().operating_mode(purpose);
        let secondary = self
            .secondary
            .and_then(|k| k.definition().operating_mode(purpose));
        match (primary, secondary) {
            (Some(super::catalogue::AccessUse::Freight), _) => primary,
            (_, Some(mode)) => Some(mode),
            _ => primary,
        }
    }
    /// Allocate the holding's occupied activity across its commitments.
    pub fn operating_shares(&self) -> impl Iterator<Item = (&OperatingTie, f64)> {
        let total = 1. + self.ties.iter().map(|tie| tie.strength).sum::<f64>();
        self.ties.iter().map(move |tie| (tie, tie.strength / total))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Purpose {
    pub site: Anchor,
    pub relationships: Vec<Relationship>,
    pub investment: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Anchor {
    Settlement,
    Approach(usize),
    Premises(HoldingId),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Relationship {
    Accommodation(Kind),
    GatheringSpace {
        for_use: Kind,
    },
    Access {
        from: Anchor,
        to: Kind,
        use_: super::catalogue::AccessUse,
    },
    Protection {
        of: Anchor,
        provider: Kind,
    },
}
pub enum FabricEdit {
    Sponsored {
        contributors: Vec<HoldingId>,
        placement: Box<FabricEdit>,
    },
    Project(Vec<FabricEdit>),
    Optional(Box<FabricEdit>),
    Join {
        partner: HoldingId,
        placement: Box<FabricEdit>,
    },
    Bind {
        premises: HoldingId,
        partner: HoldingId,
    },
    Raise {
        premises: HoldingId,
    },
    ExtendFrontage {
        premises: HoldingId,
        host: HoldingId,
        strip: Geometry,
    },
    Enclose {
        institution: HoldingId,
        premises: HoldingId,
    },
    Establish {
        conditions: super::influence::Conditions,
        proposal: Proposal,
        buildings: Vec<Geometry>,
        outdoor: bool,
        purpose: Option<(Anchor, Relationship)>,
    },
    Share {
        conditions: super::influence::Conditions,
        premises: HoldingId,
        use_: Kind,
    },
    Reuse {
        conditions: super::influence::Conditions,
        premises: HoldingId,
        use_: Kind,
    },
    Connect {
        street: Street,
        priority: f64,
    },
    Divide {
        conditions: super::influence::Conditions,
        premises: HoldingId,
        use_: Kind,
        front: Geometry,
        rear: Geometry,
        slot: Slot,
        passage: Geometry,
    },
}
pub enum EditOutcome {
    Project(Vec<EditOutcome>),
    Declined,
    Premises(HoldingId),
    Route(usize),
}
impl FabricEdit {
    pub(crate) fn accommodation(&self) -> Option<(Kind, Option<HoldingId>)> {
        match self {
            Self::Establish { proposal, .. } => Some((proposal.kind, None)),
            Self::Share { premises, use_, .. } | Self::Reuse { premises, use_, .. } => {
                Some((*use_, Some(*premises)))
            }
            _ => None,
        }
    }
}
pub trait FabricOwner {
    fn apply(&mut self, edit: FabricEdit, spatial: &dyn SpatialKernel) -> io::Result<EditOutcome>;
}
pub trait Specification {
    fn admits_frontage(&self, site: Anchor, town: &Town, front: Point, depth: f64) -> bool;
    fn satisfied(&self, site: Anchor, town: &Town, spatial: &dyn SpatialKernel)
        -> io::Result<bool>;
}
#[derive(Default, Serialize, Deserialize)]
pub struct Fabric {
    pub towns: Vec<Town>,
    pub fields: Vec<super::land::Field>,
    pub fallow: Vec<super::land::Field>,
}
pub struct Proposal {
    pub slot: Slot,
    pub kind: Kind,
    pub means: f64,
    pub priority: f64,
    pub cause: String,
}
pub fn polygon(points: &[Point]) -> Geometry {
    Geometry::Polygon {
        coordinates: vec![points.iter().map(|p| Position::xy(p[0], p[1])).collect()],
    }
}
impl Town {
    pub fn streets(&self) -> &[Street] {
        &self.streets
    }
    pub fn holdings(&self) -> &[Holding] {
        &self.holdings
    }
    pub fn passages(&self) -> &[Geometry] {
        &self.passages
    }
    pub fn wear(&self) -> &[f64] {
        &self.wear
    }
    pub fn purposes(&self) -> &[Purpose] {
        &self.purposes
    }
    pub fn seek(&mut self, site: Anchor, kind: Kind) {
        if !self
            .purposes
            .iter()
            .any(|p| p.site == site && p.relationships.contains(&Relationship::Accommodation(kind)))
        {
            self.purposes.push(Purpose {
                site,
                relationships: vec![Relationship::Accommodation(kind)],
                investment: 0.,
            });
        }
    }
    pub fn invest(&mut self, index: usize, effort: f64) {
        self.purposes[index].investment += effort;
    }
    pub fn set_approaches(&mut self, streets: Vec<Street>) {
        self.wear.resize(streets.len(), 0.);
        self.streets = streets;
    }
    pub(crate) fn seed_approach(&mut self, way: super::network::Arm, street: Street) {
        self.follow_course(way, self.streets.len());
        self.streets.push(street);
        self.wear.push(0.);
    }
    pub(crate) fn follow_course(&mut self, way: super::network::Arm, street: usize) {
        self.growing_ways.push((way, street));
    }
    pub(crate) fn growing_ways(&self) -> &[(super::network::Arm, usize)] {
        &self.growing_ways
    }
    pub fn retain_practice(&mut self, id: HoldingId, code: i32) {
        self.holdings[id.0 as usize].craft = Some(code);
    }
    pub fn bind(&mut self, id: HoldingId, ties: Vec<OperatingTie>) {
        self.holdings[id.0 as usize].ties = ties;
    }
    pub fn frontage_wear(&self, slot: &Slot) -> f64 {
        self.traffic
            .iter()
            .filter(|load| {
                Some(load.street) == slot.street && (load.start..=load.end).contains(&slot.along)
            })
            .map(|load| load.value)
            .fold(0., f64::max)
    }
    pub fn register_traffic(&mut self, loads: Vec<super::access::StreetLoad>, exposure: f64) {
        let retained = (-exposure.max(0.)).exp();
        let mut events = vec![Vec::new(); self.streets.len()];
        for (load, weight) in self
            .traffic
            .drain(..)
            .map(|l| (l, retained))
            .chain(loads.into_iter().map(|l| (l, 1. - retained)))
        {
            events[load.street].extend([
                (load.start, load.value * weight),
                (load.end, -load.value * weight),
            ]);
        }
        for (street, mut events) in events.into_iter().enumerate() {
            events.sort_by(|a, b| a.0.total_cmp(&b.0));
            let (mut prev, mut value, mut usage) = (0., 0., 0.);
            for (along, change) in events {
                if along > prev && value > 0.001 {
                    self.traffic.push(super::access::StreetLoad {
                        street,
                        start: prev,
                        end: along,
                        value,
                    });
                    usage += value * (along - prev);
                }
                prev = along;
                value += change;
            }
            self.wear[street] = usage / self.streets[street].length().max(1.);
        }
    }
    pub fn occupy(
        &mut self,
        id: HoldingId,
        support: f64,
        means: f64,
        occupation: f64,
        crowding: f64,
    ) {
        let holding = &mut self.holdings[id.0 as usize];
        holding.support = support;
        holding.means = means;
        holding.occupation = occupation;
        holding.crowding = crowding;
    }
    pub fn maintain(&mut self, id: HoldingId, condition: f64, claim: f64, occupation: f64) {
        let holding = &mut self.holdings[id.0 as usize];
        holding.condition = condition;
        holding.claim = claim;
        holding.occupation = occupation;
    }
    pub fn position(&self, anchor: Anchor) -> Point {
        match anchor {
            Anchor::Settlement => self.seat.centre,
            Anchor::Approach(i) => self.seat.arms[i]
                .points
                .last()
                .copied()
                .unwrap_or(self.seat.centre),
            Anchor::Premises(id) => self.holdings[id.0 as usize].slot.front,
        }
    }
    pub fn new(seat: Seat, forced: Option<Layout>) -> Self {
        let layout = super::story::layout(&seat.story, forced);
        let purposes = Purpose::for_seat(&seat);
        Self {
            seat,
            layout,
            streets: vec![],
            growing_ways: vec![],
            passages: vec![],
            wear: vec![],
            traffic: vec![],
            holdings: vec![],
            round: 0,
            effort: 0.,
            access_effort: 0.,
            purposes,
        }
    }
    // owner-direction(2026-11-17): projects adapt shared existing fabric; they must not stamp finished neighbourhoods.
    pub fn establish(
        &mut self,
        proposal: Proposal,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Option<HoldingId>> {
        if let Some(id) = proposal.slot.participant {
            let Some(host) = self.holdings.get(id.0 as usize) else {
                return Ok(None);
            };
            if !host
                .kind
                .definition()
                .roles
                .frontage_activities
                .contains(&proposal.kind.definition().activity)
            {
                return Ok(None);
            }
            let [x, y] = proposal.slot.front;
            if spatial
                .distance(
                    &host.outline,
                    &Geometry::Point {
                        coordinates: Position::xy(x, y),
                    },
                )
                .map_err(io::Error::other)?
                > 0.002
            {
                return Ok(None);
            }
        }
        let mut outline = polygon(&proposal.slot.corners);
        let existing: Vec<_> = self.holdings.iter().map(|h| h.outline.clone()).collect();
        let Some(free) = fit_around(outline, existing, spatial)? else {
            return Ok(None);
        };
        outline = free;
        let mut roads = Vec::new();
        for street in &self.streets {
            let gap = spatial
                .distance(&outline, &super::edits::line(&street.points))
                .map_err(io::Error::other)?;
            if gap <= street.width() / 2. {
                roads.extend(street.corridor(0., spatial).map_err(io::Error::other)?);
            }
        }
        let Some(free) = fit_around(outline, roads, spatial)? else {
            return Ok(None);
        };
        outline = free;
        let definition = proposal.kind.definition();
        if !proposal.kind.open() {
            let Some(part) = entrance_part(outline, proposal.slot.front, spatial)? else {
                return Ok(None);
            };
            outline = part;
        }
        if spatial.area(&outline).map_err(io::Error::other)?
            < definition.frontage.low * definition.depth.low * 0.25
        {
            return Ok(None);
        }
        let id = HoldingId(self.holdings.len() as u32);
        let public = proposal.kind.open();
        let mut slot = proposal.slot;
        if public {
            let [_, entrance] = spatial
                .nearest_points(
                    &Geometry::Point {
                        coordinates: Position::xy(slot.front[0], slot.front[1]),
                    },
                    &outline,
                )
                .map_err(io::Error::other)?;
            let [x, y, _] = entrance.coordinates();
            slot.front = [x, y];
        }
        let access_via = slot.participant;
        self.holdings.push(Holding {
            sponsors: Vec::new(),
            ties: vec![],
            storeys: Vec::new(),
            id,
            slot,
            outline,
            buildings: vec![],
            kind: proposal.kind,
            secondary: None,
            craft: None,
            access_via,
            institution: None,
            means: proposal.means,
            support: 0.5,
            condition: 0.8,
            occupation: 0.,
            crowding: 0.,
            established: self.round,
            public,
            outdoor: false,
            cause: proposal.cause,
            claim: proposal.priority,
        });
        Ok(Some(id))
    }
    pub fn subdivide(
        &mut self,
        id: HoldingId,
        parts: &[Geometry],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        let Some(original) = self.holdings.get(id.0 as usize) else {
            return Ok(false);
        };
        if parts.len() < 2 || original.public {
            return Ok(false);
        }
        let areas = spatial
            .intersection_areas(&original.outline, parts)
            .map_err(io::Error::other)?;
        for (part, area) in parts.iter().zip(areas) {
            if (spatial.area(part).map_err(io::Error::other)? - area).abs() > 0.1 {
                return Ok(false);
            }
        }
        for i in 0..parts.len() {
            if spatial
                .intersection_areas(&parts[i], &parts[i + 1..])
                .map_err(io::Error::other)?
                .iter()
                .any(|a| *a > 0.1)
            {
                return Ok(false);
            }
        }
        let original = original.clone();
        let assignments = assign_buildings(&original.buildings, parts, spatial)?;
        let Some(assignments) = assignments else {
            return Ok(false);
        };
        for (i, (part, indices)) in parts.iter().zip(assignments).enumerate() {
            let mut child = original.clone();
            child.outline = part.clone();
            child.buildings = indices
                .iter()
                .map(|&i| original.buildings[i].clone())
                .collect();
            child.storeys = indices.iter().map(|&i| original.storeys[i]).collect();
            if i == 0 {
                self.holdings[id.0 as usize] = child;
            } else {
                child.id = HoldingId(self.holdings.len() as u32);
                self.holdings.push(child);
            }
        }
        Ok(true)
    }
    pub fn fit_building(
        &mut self,
        id: HoldingId,
        shape: Geometry,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        let Some(holding) = self.holdings.get_mut(id.0 as usize) else {
            return Ok(false);
        };
        if holding.public {
            return Ok(false);
        }
        let Some(clipped) = spatial
            .overlay(&shape, &holding.outline, Overlay::Intersection)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        else {
            return Ok(false);
        };
        let area = spatial.area(&clipped).map_err(io::Error::other)?;
        if area <= 0.0 {
            return Ok(false);
        }
        if spatial
            .intersection_areas(&clipped, &holding.buildings)
            .map_err(io::Error::other)?
            .iter()
            .any(|a| *a > 0.1)
        {
            return Ok(false);
        }
        holding.buildings.push(clipped);
        holding.storeys.push(1);
        Ok(true)
    }
}
fn fit_around(
    outline: Geometry,
    obstacles: Vec<Geometry>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    if obstacles.is_empty() {
        return Ok(Some(outline));
    }
    let areas = spatial
        .intersection_areas(&outline, &obstacles)
        .map_err(io::Error::other)?;
    if !areas.iter().any(|area| *area > 0.1) {
        return Ok(Some(outline));
    }
    let touching: Vec<_> = obstacles
        .into_iter()
        .zip(areas)
        .filter_map(|(shape, area)| (area > 0.).then_some(shape))
        .collect();
    subtract(&outline, &touching, spatial)
}
fn subtract(
    shape: &Geometry,
    obstacles: &[Geometry],
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    let Some(mask) = spatial.union_all(obstacles).map_err(io::Error::other)? else {
        return Ok(Some(shape.clone()));
    };
    Ok(spatial
        .overlay(shape, &mask, Overlay::Difference)
        .map_err(io::Error::other)?
        .and_then(atlas_map::regions::polygon))
}
fn polygons(shape: Geometry) -> Vec<Geometry> {
    match shape {
        Geometry::Polygon { .. } => vec![shape],
        Geometry::MultiPolygon { coordinates } => coordinates
            .into_iter()
            .map(|coordinates| Geometry::Polygon { coordinates })
            .collect(),
        Geometry::GeometryCollection { geometries } => {
            geometries.into_iter().flat_map(polygons).collect()
        }
        _ => vec![],
    }
}
fn entrance_part(
    shape: Geometry,
    front: Point,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    let parts = polygons(shape);
    let index = spatial.index(&parts).map_err(io::Error::other)?;
    let p = Position::xy(front[0], front[1]);
    let Some(i) = index.nearest(p).map_err(io::Error::other)? else {
        return Ok(None);
    };
    // Two millimetres accommodates the real-scale geometry precision at a shared frontage.
    if spatial
        .distance(&Geometry::Point { coordinates: p }, &parts[i])
        .map_err(io::Error::other)?
        > 0.002
    {
        return Ok(None);
    }
    Ok(Some(parts[i].clone()))
}
fn assign_buildings(
    buildings: &[Geometry],
    parts: &[Geometry],
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Vec<Vec<usize>>>> {
    let mut assigned = vec![vec![]; parts.len()];
    for (index, building) in buildings.iter().enumerate() {
        let covers = parts
            .iter()
            .map(|part| {
                spatial
                    .relation(part, building, atlas_map::spatial::Predicate::Covers)
                    .map_err(io::Error::other)
            })
            .collect::<io::Result<Vec<_>>>()?;
        let mut owners = covers.iter().enumerate().filter(|(_, cover)| **cover);
        let Some((owner, _)) = owners.next() else {
            return Ok(None);
        };
        if owners.next().is_some() {
            return Ok(None);
        }
        assigned[owner].push(index);
    }
    Ok(Some(assigned))
}
