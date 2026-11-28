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
    scale::{Measure, TownScale},
    settings::{FOUNDING_FRONTAGE, GATE_WIDTH},
};
use crate::spatial::SpatialKernel;
use std::io;
mod district;
pub(crate) use district::occupy_district;

#[derive(Clone)]
pub(crate) struct TractAccess {
    pub origin: Point,
    /// The existing streets serving this tract before its interior blocks are opened.
    pub streets: Vec<usize>,
}

/// The least radius an enclosure's gate is measured against. Street metres, resolved by
/// `Measure::Layout`.
const LEAST_ENCLOSURE: f64 = 5.;
/// What a transfer between the founding landings adds to the walk across it. Street metres,
/// resolved by `Measure::Travel`.
const TRANSFER_COST: f64 = 6.;

/// Distance from the captured place within which its first occupants seek parcels: three plot
/// depths at `scale`.
pub(crate) fn reach(scale: TownScale, size: atlas_map::town::Size) -> f64 {
    scale.plot(size).1 * 3.
}

pub fn establish(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    conditions: impl Fn(Point) -> io::Result<Option<Conditions>>,
) -> io::Result<bool> {
    let size = town.seat.story.size();
    let scale = town.scale();
    let depth = town.plot().1;
    let frontage = scale.length(FOUNDING_FRONTAGE, Measure::Plot);
    let reach = reach(scale, size);
    seed_roads(town, ground, depth);
    let local_street = seed_local_street(town, ground, reach);
    use super::templates::FounderUse;
    let street_sites = town
        .streets()
        .iter()
        .enumerate()
        .flat_map(|(i, s)| slots(i, s, frontage, depth, scale))
        .collect::<Vec<_>>();
    for (i, founder) in town.template.kernel().iter().enumerate() {
        let Some(anchor) = town.template.site.founding_point(founder.anchor, reach) else {
            return Ok(false);
        };
        let seed = 1301_i32.wrapping_add(i as i32 * 677);
        let mut plots = super::land_sites::around([anchor], reach * 1.5, frontage, depth, 0);
        plots.extend(
            street_sites
                .iter()
                .filter(|s| {
                    distance(anchor, s.front) <= reach
                        && town.template.habitat(s.front, ground.is_water(s.front))
                            == founder.habitat
                })
                .cloned(),
        );
        let score = |s: &Slot| {
            crate::chance::Chance::of(seed, 0).unit([s.front[0], s.front[1]])
                / (1. + distance(anchor, s.front) / depth)
        };
        // hpc-exempt: rank the land choices of one founding occupation.
        plots.sort_by(|a, b| {
            (local_street && b.street.is_some())
                .cmp(&(local_street && a.street.is_some()))
                .then_with(|| score(b).total_cmp(&score(a)))
        });
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
                    scale,
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
            let Some(edit) = placement(&plot, kind, local, ground, scale) else {
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
    let scale = town.scale();
    for way in town.seat.arms.clone() {
        if let Some(mut street) = main_street(&way, depth * 1.6, size, ground, scale) {
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

/// A town can have a public street serving its founders even when no regional
/// route crosses it. Survey the ground at their place of trade, work or assembly.
fn seed_local_street(town: &mut Town, ground: &Ground, reach: f64) -> bool {
    use super::templates::{FounderUse, Habitat};
    if !town.streets().is_empty()
        || town.seat.story.size() < atlas_map::town::Size::Town
        || town.scale().fidelity() != super::scale::Fidelity::Street
    {
        return false;
    }
    let mut streets = Vec::new();
    for habitat in [Habitat::Ground, Habitat::Lower, Habitat::Upper] {
        let founders = town
            .template
            .kernel()
            .iter()
            .filter(|f| f.habitat == habitat)
            .filter_map(|f| {
                let centre = town.template.site.founding_point(f.anchor, reach)?;
                Some((matches!(f.use_, FounderUse::Household), centre))
            });
        let Some((_, centre)) = founders.min_by(|(a, p), (b, q)| {
            a.cmp(b).then_with(|| {
                distance(*p, town.seat.centre).total_cmp(&distance(*q, town.seat.centre))
            })
        }) else {
            continue;
        };
        let preferred = founding_bearing(town, ground, centre);
        if let Some(street) = survey_public_street(town, ground, centre, reach, preferred) {
            streets.push(street);
        }
    }
    let founded = !streets.is_empty();
    town.set_approaches(streets);
    founded
}

fn founding_bearing(town: &Town, ground: &Ground, centre: Point) -> f64 {
    use super::geometry::{angle, sub};
    town.template
        .align(centre)
        .map(angle)
        .or_else(|| {
            (distance(centre, town.seat.centre) > ground.cell)
                .then(|| angle(sub(town.seat.centre, centre)))
        })
        .unwrap_or_else(|| {
            crate::chance::Chance::of(0, 1301).unit([centre[0], centre[1]]) * std::f64::consts::PI
        })
}

pub(crate) fn survey_public_street(
    town: &Town,
    ground: &Ground,
    centre: Point,
    reach: f64,
    preferred: f64,
) -> Option<super::network::Street> {
    use super::{
        geometry::{add, heading, scale},
        network::{lane, stops_lane, Class, Street},
    };
    let form = town.street_form(Class::Main);
    let mut best: Option<Street> = None;
    // Try the preferred bearing first. Where a hillside or the shore interrupts it,
    // choose the continuous route that serves the most frontage near the founders.
    for i in 0..8 {
        let direction = heading(preferred + std::f64::consts::PI * f64::from(i) / 8.);
        let leg = |length| {
            lane(
                &[centre, add(centre, scale(direction, length))],
                form,
                ground,
                stops_lane,
                form.width(),
            )
        };
        let mut points = leg(-reach)
            .map(|s| s.points.into_iter().rev().collect::<Vec<_>>())
            .unwrap_or_else(|| vec![centre]);
        if let Some(other) = leg(reach) {
            points.extend(other.points.into_iter().skip(1));
        }
        let length = line_length(&points);
        if length >= town.plot().1
            && best
                .as_ref()
                .is_none_or(|r| length > r.length() + ground.cell)
        {
            best = Some(Street::new_at(points, Class::Main, form.size, form.scale));
        }
    }
    best
}

/// Trace a defensible precinct around its actual ground. The route from
/// outside ends at the gap in the line, even when an escarpment shortens it.
fn enclosure(town: &Town, ground: &Ground) -> Vec<Vec<Point>> {
    use super::geometry::{add, angle, heading, scale, sub};
    let Some(anchor) = town.template.enclosed_seat() else {
        return vec![];
    };
    let unit = town.plot().1;
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
    let town_scale = town.scale();
    let gate = (town_scale.length(GATE_WIDTH, Measure::Width)
        / radius.max(town_scale.length(LEAST_ENCLOSURE, Measure::Layout)))
    .min(0.4);
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
                cost: distance(a, b) + self.scale().length(TRANSFER_COST, Measure::Travel),
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
    scale: TownScale,
) -> super::catalogue::Kind {
    household(
        &HousingSite {
            scale,
            conditions,
            distance_from_seat,
            trade_demand,
            means: 0.45,
            form_sample: crate::chance::Chance::of(0, 111).unit([point[0], point[1]]),
            livelihood_sample: crate::chance::Chance::of(0, 73).unit([point[0], point[1]]),
        },
        &housing_offers(),
    )
}
fn placement(
    slot: &Slot,
    kind: super::catalogue::Kind,
    local: Conditions,
    ground: &Ground,
    scale: TownScale,
) -> Option<FabricEdit> {
    let def = kind.definition();
    sized_placement(
        slot,
        kind,
        local,
        ground,
        scale,
        (scale.range(def.frontage).low, scale.range(def.depth).low),
    )
}
fn sized_placement(
    slot: &Slot,
    kind: super::catalogue::Kind,
    local: Conditions,
    ground: &Ground,
    scale: TownScale,
    size: (f64, f64),
) -> Option<FabricEdit> {
    let mut slot = slot.clone();
    (slot.frontage, slot.depth) = size;
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
        buildings: roofs::components_at(&slot, kind, 0.45, 0.5, scale),
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
        let scale = town.scale();
        let home = founding_household(
            conditions[1],
            self.plots[1].front,
            distance(self.plots[1].front, town.seat.centre),
            self.source.demand,
            scale,
        );
        let develop = |index: usize, kind: super::catalogue::Kind| {
            let mut slot = survey_slot(town, walking_ground, self.plots[index].clone())?;
            let unit = town.plot().1;
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
            placement(&slot, kind, conditions[index], ground, scale)
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
    let scale = town.scale();
    let depth = town.plot().1;
    let frontage = scale.length(FOUNDING_FRONTAGE, Measure::Plot);
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
        let mut slots =
            super::land_sites::around([source.position], reach, frontage, depth, town.round);
        slots.extend(
            town.streets()
                .iter()
                .enumerate()
                .flat_map(|(i, s)| super::plots::slots(i, s, frontage, depth, scale))
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

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::town::{scale::Fidelity, seat::Seat, story::Story};

    /// A commons founded on open ground at `fidelity`.
    fn founded(fidelity: Fidelity) -> Town {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let ground = Ground::new([-1500., -1500., 1500., 1500.], 3.);
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("open commons"),
                name: "Open commons".into(),
                centre: [0., 0.],
                story: Story {
                    people: 5000.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.fidelity = fidelity;
        let land = |_| Ok(Some(Conditions::default()));
        assert!(establish(&mut town, &ground, &spatial, land).unwrap());
        town
    }

    fn assert_catalogue_plots(town: &Town, factor: f64) {
        assert!(!town.holdings().is_empty());
        for h in town.holdings() {
            let definition = h.kind.definition();
            assert_eq!(h.slot.depth, definition.depth.low * factor);
            assert_eq!(h.slot.frontage, definition.frontage.low * factor);
        }
    }
    #[test]
    fn the_two_dry_landings_each_survey_a_street_clear_of_the_cliff_between_them() {
        use super::super::{ground::STEEP, templates::Template};
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("two shelves"),
                name: "Two shelves".into(),
                centre: [0., 0.],
                story: Story {
                    people: 5000.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.template.selected = Template::Landings;
        town.template.site.lower = Some([-30., 0.]);
        town.template.site.upper = Some([30., 0.]);
        let mut ground = Ground::new([-120., -120., 120., 120.], 1.);
        for i in 0..ground.count() {
            if ground.centre(i)[0].abs() < 5. {
                ground.withhold(i, STEEP);
            }
        }
        assert!(seed_local_street(&mut town, &ground, 60.));
        assert_eq!(town.streets().len(), 2);
        let lower = &town.streets()[0];
        let upper = &town.streets()[1];
        assert!(lower.points.iter().all(|p| p[0] < -5. - lower.width() / 2.));
        assert!(upper.points.iter().all(|p| p[0] > 5. + upper.width() / 2.));
    }

    #[test]
    fn a_founding_lays_street_plots_at_street_fidelity_and_blocks_at_city_fidelity() {
        let street = founded(Fidelity::Street);
        let city = founded(Fidelity::City);
        assert_eq!(street.streets().len(), 1);
        let main = &street.streets()[0];
        assert_eq!(main.class, super::super::network::Class::Main);
        assert!(!main.through_route);
        assert!(street.holdings().iter().all(|h| h.slot.street == Some(0)));
        assert!(city.streets().is_empty());
        let block = city.scale().length(1., Measure::Plot);
        assert!(block > 1.);
        // At street fidelity each founding premises takes its kind's least catalogue plot, as
        // it always has; at city fidelity the same kind takes a block that many times larger.
        assert_catalogue_plots(&street, 1.);
        assert_catalogue_plots(&city, block);
        let deepest = |town: &Town| {
            town.holdings()
                .iter()
                .map(|h| h.slot.depth)
                .fold(0., f64::max)
        };
        assert!(deepest(&city) > 100., "{}", deepest(&city));
        assert!(deepest(&street) < 60., "{}", deepest(&street));
    }
}
