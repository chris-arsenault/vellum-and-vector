//! Founders occupy workable ground. A captured approach may already serve some of it.
use super::{
    catalogue::{
        development::{household, housing_offers, HousingSite},
        founding_work, PlaceRules,
    },
    fabric::{EditOutcome, FabricEdit, FabricOwner, Proposal, Town},
    geometry::{distance, line_length, rectangle, Point},
    ground::{Ground, Rectangle, FIRST_STREET, FREE},
    influence::Conditions,
    network::main_street,
    plots::{slots, Slot},
    roofs,
};
use crate::spatial::SpatialKernel;
use std::io;

/// Distance from the captured place within which its first occupants seek parcels.
pub(crate) fn reach(size: atlas_map::town::Size) -> f64 {
    atlas_map::town::plot_size(size).1 * 3.
}

pub fn establish(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    conditions: impl Fn(Point) -> io::Result<Option<Conditions>>,
) -> io::Result<bool> {
    let size = town.seat.story.size();
    let depth = atlas_map::town::plot_size(size).1;
    seed_roads(town, ground, depth);
    use super::templates::FounderUse;
    let street_sites = town
        .streets()
        .iter()
        .enumerate()
        .flat_map(|(i, s)| slots(i, s, 10., depth))
        .collect::<Vec<_>>();
    for (i, founder) in town.template.kernel().iter().enumerate() {
        let Some(anchor) = town
            .template
            .site
            .founding_point(founder.anchor, reach(size))
        else {
            return Ok(false);
        };
        let seed = 1301_i32.wrapping_add(i as i32 * 677);
        let mut plots = super::land_sites::around([anchor], reach(size) * 1.5, 10., depth, 0);
        plots.extend(
            street_sites
                .iter()
                .filter(|s| distance(anchor, s.front) <= reach(size))
                .cloned(),
        );
        let score = |s: &Slot| {
            crate::noise::hash_unit(seed, s.front[0], s.front[1])
                / (1. + distance(anchor, s.front) / depth)
        };
        // hpc-exempt: rank the land choices of one founding occupation.
        plots.sort_by(|a, b| score(b).total_cmp(&score(a)));
        let mut occupied = false;
        for mut plot in plots {
            let Some(local) = conditions(plot.front)? else {
                continue;
            };
            plot.habitat = founder.habitat;
            plot.tenure = founder.tenure;
            align(&mut plot, &town.template);
            let kind = match founder.use_ {
                FounderUse::Household => founding_household(
                    local,
                    plot.front,
                    distance(town.seat.centre, plot.front),
                    0.,
                ),
                FounderUse::Livelihood => founding_work(local),
                FounderUse::Place(kind) => kind,
            };
            if matches!(founder.use_, FounderUse::Household | FounderUse::Livelihood)
                && town
                    .template
                    .affinity(kind.definition().activity, plot.front, depth)
                    <= 0.
            {
                continue;
            }
            let Some(edit) = placement(&plot, kind, local, ground) else {
                continue;
            };
            if let EditOutcome::Premises(id) = town.apply(edit, spatial)? {
                town.occupy(id, 0.5, 0.45, 0.75, 0.);
                town.founding_sites.push((founder.anchor, id));
                occupied = true;
                break;
            }
        }
        if !occupied {
            return Ok(false);
        }
    }
    town.defences = enclosure(town, ground);
    Ok(!town.founding_sites.is_empty())
}

fn seed_roads(town: &mut Town, ground: &Ground, depth: f64) {
    let size = town.seat.story.size();
    for way in town.seat.arms.clone() {
        if let Some(mut street) = main_street(&way, depth * 1.6, size, ground) {
            if town
                .streets()
                .iter()
                .any(|existing| existing.points == street.points)
            {
                continue;
            }
            street.through_route &= street.length() + ground.cell >= line_length(&way.points);
            town.seed_approach(way, street);
        }
    }
}

/// Trace a defensible precinct around its actual ground. The route from
/// outside ends at the gap in the line, even when an escarpment shortens it.
fn enclosure(town: &Town, ground: &Ground) -> Vec<Vec<Point>> {
    use super::geometry::{add, angle, heading, scale, sub};
    let Some(anchor) = town.template.enclosed_seat() else {
        return vec![];
    };
    let unit = atlas_map::town::plot_size(town.seat.story.size()).1;
    let Some(radius) = town.template.enclosure_radius(unit) else {
        return vec![];
    };
    let Some(centre) = town.template.site.point(anchor) else {
        return vec![];
    };
    let entry = town
        .template
        .site
        .lower
        .or_else(|| town.template.site.approaches.first().copied())
        .unwrap_or(add(centre, [0., -radius]));
    let bearing = angle(sub(entry, centre));
    let gate = (4. / radius.max(5.)).min(0.4);
    let boundary: Vec<_> = (0..=24)
        .map(|i| {
            let d = heading(bearing + gate + (std::f64::consts::TAU - 2. * gate) * i as f64 / 24.);
            let reach = ground.reach(&[centre, add(centre, scale(d, radius))], |m| {
                matches!(
                    m,
                    super::ground::STEEP | super::ground::WATER | super::ground::OUTSIDE
                )
            });
            add(centre, scale(d, (reach - ground.cell * 0.5).max(0.)))
        })
        .collect();
    if line_length(&boundary) > unit {
        vec![boundary]
    } else {
        vec![]
    }
}

fn align(slot: &mut Slot, selection: &super::templates::Selection) {
    if slot.street.is_none() && slot.participant.is_none() {
        if let Some(direction) = selection.align(slot.front) {
            slot.direction = direction;
            slot.inward = super::geometry::left(direction);
            slot.corners = rectangle(
                slot.front,
                direction,
                slot.inward,
                slot.frontage,
                slot.depth,
            );
        }
    }
}

pub(crate) fn survey_slot(town: &Town, ground: &Ground, mut slot: Slot) -> Option<Slot> {
    let mark = ground.owner(slot.front);
    if slot.participant.is_none() {
        slot.habitat = town
            .template
            .habitat(slot.front, mark == super::ground::WATER);
    }
    if !slot.habitat.fits(mark, |owner| {
        owner == FREE || slot.street.is_some() || slot.participant.is_some()
    }) {
        return None;
    }
    align(&mut slot, &town.template);
    Some(slot)
}

impl super::templates::Habitat {
    pub fn wet(self) -> bool {
        matches!(self, Self::Floating | Self::Submerged)
    }
    pub fn shares_surface(self, other: Self) -> bool {
        !matches!(
            (self, other),
            (Self::Upper, Self::Lower) | (Self::Lower, Self::Upper)
        ) && (self == Self::Submerged) == (other == Self::Submerged)
    }
    pub(crate) fn fits(self, owner: u32, dry: impl FnOnce(u32) -> bool) -> bool {
        if self.wet() {
            owner == super::ground::WATER
        } else {
            dry(owner)
        }
    }
}

/// A public transfer only operates while the two founding landings remain inhabited.
pub struct KernelLink {
    pub kind: &'static str,
    pub ends: [Point; 2],
    pub cost: f64,
}
impl Town {
    /// The compound's entrance remains a physical gap in its defended boundary.
    pub fn kernel_walls(&self) -> &[Vec<Point>] {
        &self.defences
    }
    pub fn kernel_links(&self) -> Vec<KernelLink> {
        let Some((a, b, kind)) = self.template.connector() else {
            return vec![];
        };
        let landing = |role| {
            self.founding_sites.iter().find_map(|&(anchor, id)| {
                let h = &self.holdings()[id.0 as usize];
                (role == anchor
                    && anchor.supports(h.slot.habitat)
                    && h.condition > 0.2
                    && h.occupation > 0.)
                    .then_some(h.slot.front)
            })
        };
        match (landing(a), landing(b)) {
            (Some(a), Some(b)) if distance(a, b) > 0. => vec![KernelLink {
                kind,
                ends: [a, b],
                cost: distance(a, b) + 6.,
            }],
            _ => vec![],
        }
    }
}

fn founding_household(
    conditions: Conditions,
    point: Point,
    distance_from_seat: f64,
    trade_demand: f64,
) -> super::catalogue::Kind {
    household(
        &HousingSite {
            conditions,
            distance_from_seat,
            trade_demand,
            means: 0.45,
            form_sample: crate::noise::hash_unit(111, point[0], point[1]),
            livelihood_sample: crate::noise::hash_unit(73, point[0], point[1]),
        },
        &housing_offers(),
    )
}
fn placement(
    slot: &Slot,
    kind: super::catalogue::Kind,
    local: Conditions,
    ground: &Ground,
) -> Option<FabricEdit> {
    let def = kind.definition();
    let mut slot = slot.clone();
    slot.depth = def.depth.low;
    slot.frontage = def.frontage.low;
    slot.corners = rectangle(
        slot.front,
        slot.direction,
        slot.inward,
        slot.frontage,
        slot.depth,
    );
    (super::siting::feasible(kind, local, slot.street)
        && ground.open_with(&Rectangle(&slot.corners), |owner| {
            slot.habitat.fits(owner, |mark| {
                mark == FREE || Some(mark) == slot.street.map(|i| FIRST_STREET + i as u32)
            })
        }))
    .then(|| FabricEdit::Establish {
        conditions: local,
        outdoor: kind.open(),
        purpose: None,
        buildings: roofs::components(&slot, kind, 0.45, 0.5),
        proposal: Proposal {
            slot,
            kind,
            means: 0.45,
            priority: 1.,
            cause: "Households settle together with a local livelihood".into(),
        },
    })
}

/// A distant field or captured place can attract local settlement when occupied
/// premises already make journeys there and can finance a workplace nearer the source.
pub struct OutlyingSite {
    source: super::influence::OpportunitySource,
    sponsors: Vec<super::fabric::HoldingId>,
    plots: [Slot; 2],
    pub benefit: f64,
}
impl OutlyingSite {
    pub fn samples(&self) -> [Point; 2] {
        [self.plots[0].front, self.plots[1].front]
    }
    pub fn settle(
        &self,
        town: &mut Town,
        ground: &mut Ground,
        walking_ground: &Ground,
        spatial: &dyn SpatialKernel,
        conditions: [Conditions; 2],
    ) -> io::Result<bool> {
        use super::{
            catalogue::Operation,
            fabric::{HoldingId, OperatingTie},
            ground::PLOT,
        };
        let work = founding_work(conditions[0]);
        let definition = work.definition();
        let network = super::access::Access::for_town(town, spatial)?.on_ground(walking_ground);
        let endpoints = [
            super::access::Entrance::slot(town, &self.plots[0]),
            super::access::Entrance::source(town, &self.source.endpoint, self.source.position),
        ];
        let mut operating = None;
        for purpose in [
            Operation::Supply,
            Operation::Work,
            Operation::Service,
            Operation::Customers,
        ]
        .into_iter()
        .filter(|p| p.offered_by(self.source.activity))
        {
            let Some(mode) = definition.operating_mode(purpose) else {
                continue;
            };
            if network
                .bind(&endpoints, mode, spatial)?
                .routes(0)
                .cost(1)
                .is_finite()
            {
                operating = Some((purpose, mode));
                break;
            }
        }
        let Some((purpose, access)) = operating else {
            return Ok(false);
        };
        let home = founding_household(
            conditions[1],
            self.plots[1].front,
            distance(self.plots[1].front, town.seat.centre),
            self.source.demand,
        );
        let develop = |index: usize, kind: super::catalogue::Kind| {
            let mut slot = survey_slot(town, walking_ground, self.plots[index].clone())?;
            let unit = atlas_map::town::plot_size(town.seat.story.size()).1;
            if town
                .template
                .affinity(kind.definition().activity, slot.front, unit)
                <= 0.
            {
                return None;
            }
            slot.tenure = town
                .template
                .tenure(kind.definition().activity, slot.front, unit);
            placement(&slot, kind, conditions[index], ground)
        };
        let Some(job) = develop(0, work) else {
            return Ok(false);
        };
        let job_id = HoldingId(town.holdings().len() as u32);
        let mut edits = vec![FabricEdit::Sponsored {
            contributors: self.sponsors.clone(),
            placement: Box::new(job),
        }];
        if let Some(home) = develop(1, home) {
            edits.push(FabricEdit::Optional(Box::new(FabricEdit::Join {
                partner: job_id,
                placement: Box::new(home),
            })));
        }
        let EditOutcome::Project(accepted) = town.apply(FabricEdit::Project(edits), spatial)?
        else {
            return Ok(false);
        };
        let strength = self.source.demand + self.source.capability;
        town.bind(
            job_id,
            vec![OperatingTie {
                productive: None,
                clientele: None,
                purpose,
                destination: self.source.endpoint.clone(),
                entrance: self.source.position,
                access,
                strength,
            }],
        );
        for id in accepted.into_iter().filter_map(|outcome| {
            if let EditOutcome::Premises(id) = outcome {
                Some(id)
            } else {
                None
            }
        }) {
            town.occupy(id, 0.5, 0.45, 0.75, 0.);
            ground.take(
                &Rectangle(&town.holdings()[id.0 as usize].slot.corners),
                PLOT,
            );
        }
        Ok(true)
    }
}

pub fn outlying_sites(
    town: &Town,
    sources: &[super::influence::OpportunitySource],
    ground: &Ground,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<OutlyingSite>> {
    use super::fabric::Endpoint;
    use atlas_map::{Geometry, Position};
    // hpc-exempt: sparse operating counterparties of occupied premises.
    let mut commitments = std::collections::BTreeMap::<&Endpoint, Vec<_>>::new();
    for holding in town.holdings().iter().filter(|h| h.pledge() > 0.) {
        for (tie, share) in holding.operating_shares().filter(|(_, share)| *share > 0.) {
            commitments.entry(&tie.destination).or_default().push((
                holding.id,
                tie.purpose,
                share * holding.occupation,
            ));
        }
    }
    if commitments.is_empty() {
        return Ok(vec![]);
    }
    let premises: Vec<_> = town.holdings().iter().map(|h| h.outline.clone()).collect();
    let index = spatial.index(&premises).map_err(io::Error::other)?;
    let size = town.seat.story.size();
    let depth = atlas_map::town::plot_size(size).1;
    let mut result = Vec::new();
    for source in sources.iter().filter(|s| {
        matches!(s.endpoint, Endpoint::Field(_) | Endpoint::External(_))
            && s.demand + s.capability > 0.
    }) {
        let sponsors: Vec<_> = commitments
            .get(&source.endpoint)
            .into_iter()
            .flatten()
            .filter(|(_, purpose, _)| purpose.offered_by(source.activity))
            .map(|(id, _, share)| (*id, *share))
            .collect();
        if sponsors.is_empty() {
            continue;
        }
        let p = Position::xy(source.position[0], source.position[1]);
        let Some(i) = index.nearest(p).map_err(io::Error::other)? else {
            continue;
        };
        let gap = spatial
            .distance(&premises[i], &Geometry::Point { coordinates: p })
            .map_err(io::Error::other)?;
        if gap <= 2. * depth {
            continue;
        }
        let reach = depth * 2.;
        let mut slots = super::land_sites::around([source.position], reach, 10., depth, town.round);
        slots.extend(
            town.streets()
                .iter()
                .enumerate()
                .flat_map(|(i, s)| super::plots::slots(i, s, 10., depth))
                .filter(|s| distance(s.front, source.position) <= reach),
        );
        // hpc-exempt: rank independent parcels by their distance to the undertaking they would serve.
        slots.sort_by(|a, b| {
            distance(a.front, source.position).total_cmp(&distance(b.front, source.position))
        });
        let Some(first) = slots.iter().find(|s| ground.owner(s.front) == FREE) else {
            continue;
        };
        let Some(other) = slots
            .iter()
            .find(|s| distance(s.front, first.front) > depth)
        else {
            continue;
        };
        let saved = sponsors.iter().map(|(_, share)| share).sum::<f64>() * gap / depth;
        let mut contributors = sponsors.into_iter().map(|(id, _)| id).collect::<Vec<_>>();
        contributors.sort();
        contributors.dedup();
        result.push(OutlyingSite {
            source: source.clone(),
            sponsors: contributors,
            plots: [first.clone(), other.clone()],
            benefit: saved,
        });
    }
    Ok(result)
}
