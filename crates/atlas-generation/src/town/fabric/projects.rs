use super::*;
use crate::town::siting::feasible;
use crate::town::{access::Access, catalogue::ServiceRole, geometry::distance};

impl Town {
    pub fn access_destinations(&self, kind: Kind) -> impl Iterator<Item = Point> + '_ {
        self.operating_premises(kind).map(|h| h.slot.front)
    }
    fn operating_premises(&self, kind: Kind) -> impl Iterator<Item = &Holding> {
        self.holdings.iter().filter(move |h| {
            h.condition > 0.2
                && (h.public || h.outdoor || !h.buildings.is_empty())
                && (h.kind == kind || h.secondary == Some(kind))
        })
    }
}
impl Relationship {
    /// Construction already evaluated existing holdings when it opened bidding.
    /// Check the premises established by intervening bids before funding another.
    pub(crate) fn served_since(
        self,
        site: Anchor,
        first: usize,
        town: &Town,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        // A whole-town check reads only holdings near the site when the relationship has
        // a fixed reach; a holding's front lies on its own outline.
        if let Some(reach) = self.reach().filter(|_| first == 0) {
            let [x, y] = town.position(site);
            let pad = reach + 5.;
            for i in town.nearby_holdings(Bounds(x - pad, y - pad, x + pad, y + pad), spatial)? {
                if self.served_by(&town.holdings[i], site, town, spatial)? {
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        for holding in &town.holdings[first..] {
            if self.served_by(holding, site, town, spatial)? {
                return Ok(true);
            }
        }
        Ok(false)
    }
    /// The furthest a serving front may lie from the site, when it does not depend on
    /// the serving holding.
    fn reach(self) -> Option<f64> {
        match self {
            Self::Accommodation(kind) => Some(6. * kind.definition().depth.high),
            Self::GatheringSpace { for_use } => Some(3. * for_use.definition().depth.high),
            Self::Protection { .. } | Self::Access { .. } => None,
        }
    }
    fn served_by(
        self,
        h: &Holding,
        site: Anchor,
        town: &Town,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        if h.condition <= 0.2
            || !(h.public || h.outdoor || !h.buildings.is_empty())
            || !self.admits_frontage(site, town, h.slot.front, h.slot.depth)
        {
            return Ok(false);
        }
        Ok(match self {
            Self::Accommodation(kind) => h.kind == kind || h.secondary == Some(kind),
            Self::GatheringSpace { for_use } => {
                let size = for_use.definition();
                h.public
                    && h.kind.definition().roles.gathering_space
                    && spatial.area(&h.outline).map_err(io::Error::other)?
                        >= size.frontage.low * size.depth.low
            }
            Self::Protection { .. } => h.kind.definition().roles.service == ServiceRole::Protection,
            Self::Access { .. } => false,
        })
    }
    pub fn use_kind(self) -> Kind {
        match self {
            Self::Accommodation(kind) | Self::Access { to: kind, .. } => kind,
            Self::Protection { provider, .. } => provider,
            Self::GatheringSpace { for_use } => for_use,
        }
    }
}
impl Specification for Relationship {
    fn admits_frontage(&self, site: Anchor, town: &Town, front: Point, depth: f64) -> bool {
        match *self {
            Self::Accommodation(kind) => {
                distance(town.position(site), front) <= 6. * kind.definition().depth.high
            }
            Self::GatheringSpace { for_use } => {
                distance(town.position(site), front) < for_use.definition().depth.high * 3.
            }
            Self::Protection { of, .. } => distance(town.position(of), front) < depth * 4.,
            Self::Access { .. } => false,
        }
    }
    fn satisfied(
        &self,
        site: Anchor,
        town: &Town,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        match *self {
            Self::Accommodation(_) | Self::GatheringSpace { .. } | Self::Protection { .. } => {
                self.served_since(site, 0, town, spatial)
            }
            Self::Access { from, to, use_ } => {
                use crate::town::access::Entrance;
                let targets: Vec<_> = town.operating_premises(to).collect();
                if targets.is_empty() {
                    return Ok(false);
                }
                let start = town.position(from);
                let origin = match from {
                    Anchor::Premises(id) => Entrance::holding(town, &town.holdings[id.0 as usize]),
                    _ => Entrance::external(start),
                };
                let places: Vec<_> = std::iter::once(origin)
                    .chain(targets.iter().map(|h| Entrance::holding(town, h)))
                    .collect();
                let graph =
                    Access::over_town_streets(town, spatial)?.bind(&places, use_, spatial)?;
                let routes = graph.routes(0);
                Ok(targets.into_iter().enumerate().any(|(i, holding)| {
                    let cost = routes.cost(i + 1);
                    let target = holding.slot.front;
                    cost <= distance(start, target) * 1.6
                        + distance(town.position(site), target) * 0.1
                        + 15.
                }))
            }
        }
    }
}

fn initial_operation(
    kind: Kind,
    target: &Holding,
) -> Option<(
    super::super::catalogue::Operation,
    super::super::catalogue::AccessUse,
)> {
    use super::super::catalogue::Operation;
    let consumer = kind.definition();
    [
        Operation::Work,
        Operation::Customers,
        Operation::Service,
        Operation::Supply,
    ]
    .into_iter()
    .find_map(|purpose| {
        let mode = consumer.operating_mode(purpose)?;
        std::iter::once(target.kind)
            .chain(target.secondary)
            .any(|k| purpose.offered_by(k.definition().activity))
            .then_some((purpose, mode))
    })
}
impl FabricOwner for Town {
    fn apply(&mut self, edit: FabricEdit, spatial: &dyn SpatialKernel) -> io::Result<EditOutcome> {
        match edit {
            FabricEdit::Sponsored {
                contributors,
                placement,
            } => self.sponsor(contributors, *placement, spatial),
            // owner-direction(2026-11-20): a project's steps stand as they are built; one that cannot be built stops the project, leaving what was finished
            FabricEdit::Project(edits) => {
                let mut results = Vec::new();
                for edit in edits {
                    let optional = matches!(edit, FabricEdit::Optional(_));
                    let result = self.apply(edit, spatial)?;
                    if matches!(result, EditOutcome::Declined) {
                        if optional {
                            continue;
                        }
                        break;
                    }
                    results.push(result);
                }
                if results.is_empty() {
                    return Ok(EditOutcome::Declined);
                }
                Ok(EditOutcome::Project(results))
            }
            FabricEdit::Optional(edit) => self.apply(*edit, spatial),
            FabricEdit::Join { partner, placement } => {
                let Some(target) = self.holdings.get(partner.0 as usize) else {
                    return Ok(EditOutcome::Declined);
                };
                let kind = match placement.as_ref() {
                    FabricEdit::Establish { proposal, .. } => proposal.kind,
                    FabricEdit::Share { premises, use_, .. }
                    | FabricEdit::Reuse { premises, use_, .. }
                        if *premises != partner =>
                    {
                        *use_
                    }
                    _ => return Ok(EditOutcome::Declined),
                };
                if initial_operation(kind, target).is_none() {
                    return Ok(EditOutcome::Declined);
                }
                let EditOutcome::Premises(premises) = self.apply(*placement, spatial)? else {
                    return Ok(EditOutcome::Declined);
                };
                self.apply(FabricEdit::Bind { premises, partner }, spatial)
            }
            FabricEdit::Bind { premises, partner } => {
                let (Some(home), Some(target)) = (
                    self.holdings.get(premises.0 as usize),
                    self.holdings.get(partner.0 as usize),
                ) else {
                    return Ok(EditOutcome::Declined);
                };
                if premises == partner {
                    return Ok(EditOutcome::Declined);
                }
                let Some((purpose, access)) =
                    initial_operation(home.secondary.unwrap_or(home.kind), target)
                else {
                    return Ok(EditOutcome::Declined);
                };
                let tie = OperatingTie {
                    purpose,
                    destination: Endpoint::Premises {
                        town: self.seat.key.clone(),
                        holding: partner,
                    },
                    entrance: target.slot.front,
                    access,
                    strength: 0.5,
                };
                let ties = &mut self.holdings[premises.0 as usize].ties;
                ties.retain(|old| old.purpose != purpose);
                ties.push(tie);
                Ok(EditOutcome::Premises(premises))
            }
            FabricEdit::Raise { premises } => {
                let Some(h) = self.holdings.get_mut(premises.0 as usize) else {
                    return Ok(EditOutcome::Declined);
                };
                if !h.kind.definition().roles.dwelling
                    || h.buildings.is_empty()
                    || h.condition <= 0.35
                {
                    return Ok(EditOutcome::Declined);
                }
                let definition = h.kind.definition();
                let Some((_, storeys)) = h
                    .storeys
                    .iter_mut()
                    .enumerate()
                    .filter(|(i, _)| definition.building(*i).roles.dwelling)
                    .min_by_key(|(_, floors)| **floors)
                else {
                    return Ok(EditOutcome::Declined);
                };
                *storeys += 1;
                h.crowding *= (*storeys - 1) as f64 / *storeys as f64;
                h.cause = "Households added an upper storey on their occupied frontage".into();
                Ok(EditOutcome::Premises(premises))
            }
            FabricEdit::ExtendFrontage {
                premises,
                host,
                strip,
            } => self.extend_frontage(premises, host, &strip, spatial),
            FabricEdit::Establish {
                conditions,
                proposal,
                buildings,
                outdoor,
                purpose,
            } => {
                if !feasible(proposal.kind, conditions, proposal.slot.street) {
                    return Ok(EditOutcome::Declined);
                }
                let Some(id) = self.establish(proposal, spatial)? else {
                    return Ok(EditOutcome::Declined);
                };
                self.holdings[id.0 as usize].outdoor = outdoor;
                for roof in buildings {
                    if let Err(error) = self.fit_building(id, roof, spatial) {
                        self.holdings.pop();
                        return Err(error);
                    }
                }
                let h = &self.holdings[id.0 as usize];
                if !h.public && !outdoor && h.buildings.is_empty() {
                    self.holdings.pop();
                    return Ok(EditOutcome::Declined);
                }
                if let Some((site, relation)) = purpose {
                    match relation.served_by(h, site, self, spatial) {
                        Ok(true) => {}
                        result => {
                            self.holdings.pop();
                            return result.map(|_| EditOutcome::Declined);
                        }
                    }
                }
                let kind = h.kind;
                if !h.buildings.is_empty()
                    && kind.definition().roles.attached_range
                    && h.means + conditions.density > 0.65
                {
                    self.holdings[id.0 as usize].storeys.fill(2);
                }
                Ok(self.established(kind, id, conditions))
            }
            FabricEdit::Share {
                premises,
                use_,
                conditions,
            } => {
                let Some(h) = self.holdings.get_mut(premises.0 as usize) else {
                    return Ok(EditOutcome::Declined);
                };
                if h.secondary.is_some()
                    || !feasible(use_, conditions, h.slot.street)
                    || !h
                        .kind
                        .definition()
                        .premises
                        .shares_with
                        .contains(&use_.definition().activity)
                    || h.condition <= 0.4
                {
                    return Ok(EditOutcome::Declined);
                }
                h.secondary = Some(use_);
                h.cause = format!(
                    "{} adapted to share {}",
                    h.kind.definition().label,
                    use_.definition().label
                );
                Ok(self.established(use_, premises, conditions))
            }
            FabricEdit::Reuse {
                premises,
                use_,
                conditions,
            } => Ok(
                if self
                    .holdings
                    .get(premises.0 as usize)
                    .is_some_and(|h| feasible(use_, conditions, h.slot.street))
                    && self.repurpose(premises, use_)
                {
                    self.established(use_, premises, conditions)
                } else {
                    EditOutcome::Declined
                },
            ),
            FabricEdit::Enclose {
                institution,
                premises,
            } => {
                let (Some(sponsor), Some(subject)) = (
                    self.holdings.get(institution.0 as usize),
                    self.holdings.get(premises.0 as usize),
                ) else {
                    return Ok(EditOutcome::Declined);
                };
                if institution == premises
                    || subject.public
                    || subject.institution.is_some()
                    || !subject
                        .slot
                        .tenure
                        .permits_neighbor_claim(subject.occupation, subject.condition)
                    || sponsor.kind.definition().activity
                        != super::super::catalogue::Activity::Institution
                    || sponsor.claim <= subject.claim
                {
                    return Ok(EditOutcome::Declined);
                }
                let gap = spatial
                    .distance(&sponsor.outline, &subject.outline)
                    .map_err(io::Error::other)?;
                if gap > subject.slot.frontage
                    || sponsor.slot.street != subject.slot.street
                    || (sponsor.slot.street.is_some() && sponsor.slot.side != subject.slot.side)
                {
                    return Ok(EditOutcome::Declined);
                }
                let claim = sponsor.claim;
                let subject = &mut self.holdings[premises.0 as usize];
                subject.institution = Some(institution);
                subject.claim = claim;
                subject.cause =
                    "An established institution extended its precinct across neighbouring land"
                        .into();
                Ok(EditOutcome::Premises(premises))
            }
            FabricEdit::Connect { street, priority } => {
                let index = self.streets.len();
                Ok(if self.connect_route(street, priority, spatial)? {
                    EditOutcome::Route(index)
                } else {
                    EditOutcome::Declined
                })
            }
            FabricEdit::Divide {
                conditions,
                premises,
                use_,
                front,
                rear,
                slot,
                passage,
            } => {
                let Some(original) = self.holdings.get(premises.0 as usize).cloned() else {
                    return Ok(EditOutcome::Declined);
                };
                if !self.subdivide(premises, &[front, rear], spatial)? {
                    return Ok(EditOutcome::Declined);
                }
                let child = self.holdings.last_mut().unwrap();
                child.kind = use_;
                child.secondary = None;
                child.craft = None;
                child.ties.clear();
                child.sponsors.clear();
                child.access_via = Some(premises);
                child.slot = slot;
                child.slot.tenure = original.slot.tenure;
                child.slot.habitat = original.slot.habitat;
                child.established = self.round;
                child.occupation = 0.;
                child.crowding = 0.;
                child.cause = "Crowding divided a rear garden, retaining a shared passage".into();
                let id = child.id;
                for roof in
                    crate::town::roofs::components(&child.slot, child.kind, child.means, 0.5)
                {
                    if let Err(error) = self.fit_building(id, roof, spatial) {
                        self.holdings.pop();
                        self.holdings[premises.0 as usize] = original;
                        return Err(error);
                    }
                }
                if self.holdings[id.0 as usize].buildings.is_empty() {
                    self.holdings.pop();
                    self.holdings[premises.0 as usize] = original;
                    return Ok(EditOutcome::Declined);
                }
                self.passages.push(passage);
                self.holdings[premises.0 as usize].crowding *= 0.6;
                Ok(self.established(use_, id, conditions))
            }
        }
    }
}

impl Town {
    fn sponsor(
        &mut self,
        mut contributors: Vec<HoldingId>,
        placement: FabricEdit,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<EditOutcome> {
        let Some((kind, existing)) = placement.accommodation() else {
            return Ok(EditOutcome::Declined);
        };
        contributors.sort_unstable();
        contributors.dedup();
        let mut offers = Vec::new();
        for id in contributors {
            let Some(h) = self.holdings.get(id.0 as usize) else {
                return Ok(EditOutcome::Declined);
            };
            let amount = h.pledge();
            if Some(id) == existing || amount <= 0. {
                return Ok(EditOutcome::Declined);
            }
            offers.push((id, amount));
        }
        let pledged: f64 = offers.iter().map(|(_, amount)| amount).sum();
        let cost = kind.definition().investment_cost();
        if pledged < cost {
            return Ok(EditOutcome::Declined);
        }
        let EditOutcome::Premises(id) = self.apply(placement, spatial)? else {
            return Ok(EditOutcome::Declined);
        };
        for (sponsor, amount) in offers {
            self.holdings[sponsor.0 as usize].means -= cost * amount / pledged;
            let sponsors = &mut self.holdings[id.0 as usize].sponsors;
            if !sponsors.contains(&sponsor) {
                sponsors.push(sponsor);
            }
        }
        Ok(EditOutcome::Premises(id))
    }
    fn extend_frontage(
        &mut self,
        premises: HoldingId,
        host: HoldingId,
        strip: &Geometry,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<EditOutcome> {
        let (Some(h), Some(space)) = (
            self.holdings.get(premises.0 as usize),
            self.holdings.get(host.0 as usize),
        ) else {
            return Ok(EditOutcome::Declined);
        };
        if h.slot.participant != Some(host)
            || !space.public
            || !space
                .slot
                .tenure
                .permits_neighbor_claim(space.occupation, space.condition)
            || h.claim * h.occupation <= space.claim * (1. + space.occupation)
            || h.public
        {
            return Ok(EditOutcome::Declined);
        }
        let Some(taken) = spatial
            .overlay(&space.outline, strip, Overlay::Intersection)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        else {
            return Ok(EditOutcome::Declined);
        };
        let Some(left) = spatial
            .overlay(&space.outline, &taken, Overlay::Difference)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        else {
            return Ok(EditOutcome::Declined);
        };
        let Some(remainder) = entrance_part(left, space.slot.front, spatial)? else {
            return Ok(EditOutcome::Declined);
        };
        let purpose = space.kind.definition();
        if spatial.area(&remainder).map_err(io::Error::other)?
            < purpose.frontage.low * purpose.depth.low
        {
            return Ok(EditOutcome::Declined);
        }
        let Some(expanded) = spatial
            .union_all(&[h.outline.clone(), taken])
            .map_err(io::Error::other)?
        else {
            return Ok(EditOutcome::Declined);
        };
        self.holdings[host.0 as usize].outline = remainder;
        self.fitting.get_mut().holdings = BoundsIndex::default();
        self.holdings[premises.0 as usize].outline = expanded;
        self.holdings[premises.0 as usize].cause =
            "Occupied frontage extended into a neighbouring open holding".into();
        Ok(EditOutcome::Premises(premises))
    }
    fn established(
        &mut self,
        kind: Kind,
        id: HoldingId,
        conditions: crate::town::influence::Conditions,
    ) -> EditOutcome {
        if let Some(after) = kind.definition().roles.on_established {
            after(self, id, conditions);
        }
        EditOutcome::Premises(id)
    }
}
/// Reuse a sound hull at another berth. Its premises, fittings and history
/// keep their identity; local access is resolved from the new entrance.
impl Town {
    pub fn berth(
        &mut self,
        id: HoldingId,
        site: &super::super::plots::Slot,
        ground: &super::super::ground::Ground,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        use super::super::{
            geometry::{add, distance, sub},
            ground::{Rectangle, FREE},
            templates::Habitat,
        };
        use atlas_map::authoring::{transform_geometry, Transform};
        let i = id.0 as usize;
        let Some(h) = self.holdings.get(i) else {
            return Ok(false);
        };
        if h.slot.habitat != Habitat::Floating
            || site.participant.is_some()
            || h.access_via.is_some()
            || !matches!(site.habitat, Habitat::Floating | Habitat::Ground)
        {
            return Ok(false);
        }
        let shift = sub(site.front, h.slot.front);
        let sailed = distance(site.front, h.slot.front);
        if sailed < h.slot.depth {
            return Ok(false);
        }
        let passage = ground.wet_runs(&[h.slot.front, site.front]);
        if !matches!(passage.as_slice(), [(start,end)] if *start<=ground.cell && *end+site.depth+ground.cell>=sailed)
        {
            return Ok(false);
        }
        let old_front = h.slot.front;
        let mut slot = h.slot.clone();
        slot.front = site.front;
        slot.street = site.street;
        slot.along = site.along;
        slot.habitat = site.habitat;
        for p in &mut slot.corners {
            *p = add(*p, shift);
        }
        if !ground.open_with(&Rectangle(&slot.corners), |mark| {
            slot.habitat.fits(mark, |mark| mark == FREE)
        }) {
            return Ok(false);
        }
        let shift = Transform {
            translate: shift,
            rotate: 0.,
            scale: 1.,
            about: [0., 0.],
        };
        let outline = transform_geometry(&h.outline, &shift);
        let bounds = spatial.bounds(&outline).map_err(io::Error::other)?;
        let near = self.nearby_holdings(bounds, spatial)?;
        let obstacles: Vec<_> = near
            .into_iter()
            .filter(|&j| j != i && self.holdings[j].slot.habitat.shares_surface(slot.habitat))
            .map(|j| self.holdings[j].outline.clone())
            .collect();
        if spatial
            .intersection_areas(&outline, &obstacles)
            .map_err(io::Error::other)?
            .iter()
            .any(|&a| a > 0.)
        {
            return Ok(false);
        }
        if !self.nearby_roads(bounds, spatial)?.is_empty() {
            return Ok(false);
        }
        let h = &mut self.holdings[i];
        h.slot = slot;
        h.outline = outline;
        h.cause = if h.slot.habitat == Habitat::Ground {
            "An old hull was drawn onto the working bank"
        } else {
            "An inhabited hull moved to a working berth"
        }
        .into();
        for b in &mut h.buildings {
            *b = transform_geometry(b, &shift);
        }
        self.fitting.get_mut().holdings.replace(i, bounds);
        if let Some(approach) = self.approaches.get_mut(i) {
            *approach = None;
        }
        self.footpaths.retain(|path| {
            path.points
                .iter()
                .all(|p| distance(*p, old_front) > ground.cell)
        });
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::plots::{Side, Slot};

    fn town_with_a_house() -> Town {
        let seat = crate::town::seat::Seat {
            key: atlas_map::Id::from_name("seat"),
            name: "Seat".into(),
            centre: [0., 0.],
            story: Default::default(),
            arms: vec![],
            culture: None,
        };
        let mut town = Town::new(seat, None);
        let kind = *crate::town::catalogue::PLACES
            .iter()
            .find(|k| k.definition().roles.dwelling)
            .unwrap();
        let square = Geometry::Polygon {
            coordinates: vec![[[0., 0.], [10., 0.], [10., 10.], [0., 10.], [0., 0.]]
                .map(|[x, y]| atlas_map::Position::xy(x, y))
                .to_vec()],
        };
        town.holdings.push(Holding {
            sponsors: vec![],
            ties: vec![],
            storeys: vec![1],
            id: HoldingId(0),
            slot: Slot {
                habitat: Default::default(),
                tenure: Default::default(),
                participant: None,
                street: None,
                side: Side::Left,
                along: 0.,
                corners: vec![],
                front: [5., 0.],
                direction: [1., 0.],
                inward: [0., 1.],
                frontage: 10.,
                depth: 10.,
            },
            outline: square.clone(),
            buildings: vec![square],
            kind,
            secondary: None,
            craft: None,
            access_via: None,
            institution: None,
            means: 0.5,
            support: 0.5,
            condition: 0.8,
            occupation: 1.,
            crowding: 1.,
            established: 0,
            public: false,
            outdoor: false,
            cause: String::new(),
            claim: 0.,
        });
        town
    }

    #[test]
    fn a_project_keeps_what_was_built_when_a_later_step_cannot_be() {
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let mut town = town_with_a_house();
        let raise = || FabricEdit::Raise {
            premises: HoldingId(0),
        };
        let missing = FabricEdit::Raise {
            premises: HoldingId(7),
        };
        let outcome = town
            .apply(
                FabricEdit::Project(vec![raise(), missing, raise()]),
                &spatial,
            )
            .unwrap();
        assert!(matches!(outcome, EditOutcome::Project(ref steps) if steps.len() == 1));
        assert_eq!(town.holdings()[0].storeys, vec![2]);

        let skipped = FabricEdit::Optional(Box::new(FabricEdit::Raise {
            premises: HoldingId(7),
        }));
        town.apply(FabricEdit::Project(vec![skipped, raise()]), &spatial)
            .unwrap();
        assert_eq!(town.holdings()[0].storeys, vec![3]);
    }
}
