//! Enduring commissions share one development path regardless of who first proposed them.
pub use super::catalogue::works::{WorkDesign, WorkFamily};
use super::{
    fabric::{HoldingId, Town},
    geometry::{add, left, scale, Point},
    story::Story,
    templates::SiteEvidence,
};
use crate::noise::hash_unit;
use serde::{Deserialize, Serialize};

mod construction;
mod grounds;
pub use construction::advance;

/// Located physical prerequisites that cannot be inferred from a political title or city size.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct WorkLandscape {
    pub lake_shore: Option<Point>,
    pub floodplain: Option<Point>,
    pub timber: Option<Point>,
    pub deep_water: Option<Point>,
    pub frost: bool,
    pub salt_pan: Option<Point>,
    pub ice_record: Option<Point>,
    pub paired_door: Option<Point>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkOrigin {
    Inherited,
    Commissioned,
    Organic,
}
impl WorkOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inherited => "inherited",
            Self::Commissioned => "commissioned",
            Self::Organic => "organic",
        }
    }
}
#[derive(Clone)]
pub struct InheritedWork {
    pub family: WorkFamily,
    pub id: atlas_map::Id,
    pub anchor: Point,
    pub design: Option<WorkDesign>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Commission {
    pub family: WorkFamily,
    pub design: WorkDesign,
    pub origin: WorkOrigin,
    pub anchor: Point,
    pub inherited_id: Option<atlas_map::Id>,
    pub members: Vec<HoldingId>,
    pub grounds: Option<atlas_map::Geometry>,
    grounds_bounds: Option<atlas_map::Bounds>,
    pub counterpart: Option<Point>,
    connected: bool,
    pub sponsors: Vec<HoldingId>,
    direction: Point,
    frame: Option<Point>,
}
impl Commission {
    fn check_route(&mut self, door: Option<Point>, links: &[(Point, Point, f64)]) {
        if self.family.definition().kept_door {
            self.connected = door.zip(self.counterpart).is_some_and(|ends| {
                links
                    .iter()
                    .any(|&(a, b, _)| ends == (a, b) || ends == (b, a))
            });
        }
    }
    fn target(&self) -> Option<Point> {
        let part = self.design.parts.get(self.members.len())?;
        if part.station.remote() {
            self.counterpart
        } else {
            Some(self.position(part.offset))
        }
    }
    fn position(&self, offset: Point) -> Point {
        add(
            add(
                self.frame.unwrap_or(self.anchor),
                scale(self.direction, offset[0]),
            ),
            scale(left(self.direction), offset[1]),
        )
    }
    pub fn complete(&self) -> bool {
        self.members.len() == self.design.component_count()
    }
    /// Constituent premises age and lose occupants through the ordinary town processes.
    pub fn operating(&self, town: &Town) -> bool {
        self.complete()
            && self.connected
            && self.members.iter().all(|id| {
                let place = &town.holdings()[id.0 as usize];
                place.condition > 0.2 && place.occupation > 0.
            })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct MajorWorks {
    pub commissions: Vec<Commission>,
    seed: Option<i32>,
    observed: Vec<(WorkFamily, Point)>,
}
impl MajorWorks {
    pub(crate) fn obstructions(
        &self,
        atlas_map::Bounds(w, s, e, n): atlas_map::Bounds,
    ) -> impl Iterator<Item = &atlas_map::Geometry> {
        self.commissions.iter().filter_map(move |work| {
            let atlas_map::Bounds(a, b, c, d) = work.grounds_bounds?;
            if c < w || a > e || d < s || b > n {
                return None;
            }
            work.grounds.as_ref()
        })
    }
    pub fn active_sites(&self) -> impl Iterator<Item = Point> + '_ {
        self.commissions.iter().filter_map(Commission::target)
    }
    /// A working harbor can commission a floating structure without allowing general housing afloat.
    pub(crate) fn water_sites(
        &self,
        ground: &super::ground::Ground,
        round: u32,
    ) -> Vec<super::plots::Slot> {
        let anchors = self
            .commissions
            .iter()
            .filter(|w| {
                w.design
                    .parts
                    .get(w.members.len())
                    .is_some_and(|p| p.station.wet())
            })
            .filter_map(Commission::target);
        super::land_sites::around(anchors, 50., 12., 25., round)
            .into_iter()
            .filter_map(|mut slot| {
                if ground.owner(slot.front) != super::ground::WATER {
                    return None;
                }
                slot.habitat = super::templates::Habitat::Floating;
                slot.tenure = super::templates::Tenure::Institutional;
                Some(slot)
            })
            .collect()
    }
    fn established_near(&self, family: WorkFamily, site: Point) -> bool {
        self.commissions.iter().any(|work| {
            work.family == family
                && super::geometry::distance(work.anchor, site)
                    < family.definition().sponsor_reach()
        })
    }
    fn consider(&mut self, family: WorkFamily, site: Point) -> bool {
        let event = (family, site);
        if self.observed.contains(&event) {
            return false;
        }
        self.observed.push(event);
        true
    }
    fn start(
        &mut self,
        family: WorkFamily,
        origin: WorkOrigin,
        anchor: Point,
        site: &SiteEvidence,
        design: WorkDesign,
    ) -> &mut Commission {
        let bearing = design.bearing;
        self.commissions.push(Commission {
            family,
            design,
            origin,
            anchor,
            inherited_id: None,
            sponsors: vec![],
            members: vec![],
            grounds: None,
            grounds_bounds: None,
            counterpart: (family.definition().counterpart)(site),
            connected: !family.definition().kept_door,
            frame: None,
            direction: super::geometry::heading(bearing),
        });
        self.commissions.last_mut().unwrap()
    }
}

/// Linear interpolation in population between the owner's representative city bands.
/// The small remaining organic chance contributes to the same population distribution.
fn expected_commissions(people: f64) -> f64 {
    let points = [
        (0., 0.),
        (1_000., 0.),
        (22_000., 0.43),
        (300_000., 2.25),
        (500_000., 2.75),
        (1_000_000., 5.15),
        (2_000_000., 5.75),
    ];
    for pair in points.windows(2) {
        let [(a, lo), (b, hi)] = [pair[0], pair[1]];
        if people <= b {
            return lo + (hi - lo) * ((people - a) / (b - a)).clamp(0., 1.);
        }
    }
    points.last().unwrap().1
}
// owner-direction(2026-11-19): major works are independent of the settlement template, can be preselected for larger cities and can arise organically.
pub fn commission(town: &mut Town, seed: i32, inherited: &[InheritedWork]) {
    if town.works.seed.is_some() {
        return;
    }
    town.works.seed = Some(seed);
    for work in inherited {
        if !town
            .works
            .commissions
            .iter()
            .any(|w| w.inherited_id == Some(work.id))
        {
            let design = work.design.clone().unwrap_or_else(|| {
                work.family.definition().design(
                    &town.template.site,
                    work.anchor,
                    &[],
                    seed.wrapping_add(work.family as i32),
                )
            });
            town.works
                .start(
                    work.family,
                    WorkOrigin::Inherited,
                    work.anchor,
                    &town.template.site,
                    design,
                )
                .inherited_id = Some(work.id);
        }
    }
    let [x, y] = town.seat.centre;
    let expectation = expected_commissions(town.seat.story.people);
    let count = (expectation + hash_unit(seed ^ 0x554f, x, y)).floor() as usize;
    let needed = count.saturating_sub(town.works.commissions.len());
    if needed == 0 {
        return;
    }
    for (family, anchor, _) in offers(&town.template.site, &town.seat.story, seed)
        .into_iter()
        .filter(|(f, site, _)| !town.works.established_near(*f, *site))
        .take(needed)
        .collect::<Vec<_>>()
    {
        start_commission(town, seed, family, anchor);
    }
}
/// A city map's major works: as many as its population band expects, each a different work
/// type at a site its own rules accept in the city's evidence.
pub fn city_works(site: &SiteEvidence, people: f64, seed: i32) -> Vec<(WorkFamily, Point)> {
    let story = Story {
        people,
        ..Story::default()
    };
    let [x, y] = site.centre;
    let count = (expected_commissions(people) + hash_unit(seed ^ 0x554f, x, y)).floor() as usize;
    let mut chosen: Vec<(WorkFamily, Point)> = Vec::new();
    for (family, anchor, _) in offers(site, &story, seed) {
        if chosen.len() >= count {
            break;
        }
        if chosen.iter().all(|(f, _)| *f != family) {
            chosen.push((family, anchor));
        }
    }
    chosen
}
pub fn commission_requested(
    town: &mut Town,
    seed: i32,
    requested: WorkFamily,
) -> std::io::Result<()> {
    let (_, anchor, _) = offers(&town.template.site, &town.seat.story, seed)
        .into_iter()
        .find(|(family, _, _)| *family == requested)
        .ok_or_else(|| {
            std::io::Error::other(format!(
                "No site for a {} in {}",
                requested.label(),
                town.seat.name
            ))
        })?;
    start_commission(town, seed, requested, anchor);
    Ok(())
}
fn start_commission(town: &mut Town, seed: i32, family: WorkFamily, anchor: Point) {
    let site = &town.template.site;
    let design = family
        .definition()
        .design(site, anchor, &[], seed.wrapping_add(family as i32));
    town.works
        .start(family, WorkOrigin::Commissioned, anchor, site, design);
}
fn offers(site: &SiteEvidence, story: &Story, seed: i32) -> Vec<(WorkFamily, Point, f64)> {
    let mut offers = WorkFamily::ALL
        .iter()
        .copied()
        .flat_map(|f| {
            f.definition()
                .sites(site, story)
                .into_iter()
                .map(move |anchor| {
                    (
                        f,
                        anchor,
                        hash_unit(seed.wrapping_add(f as i32), anchor[0], anchor[1]),
                    )
                })
        })
        .collect::<Vec<_>>();
    // hpc-exempt: a small catalogue of distinctive works competing for actual founding sites.
    offers.sort_by(|a, b| b.2.total_cmp(&a.2));
    offers
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commission_expectations_follow_population_and_allow_small_exceptions() {
        assert_eq!(expected_commissions(40.), 0.);
        assert!((0.4..0.5).contains(&expected_commissions(22_000.)));
        assert!((2.0..3.).contains(&expected_commissions(400_000.)));
        assert!((5.0..6.).contains(&expected_commissions(1_500_000.)));
    }
    #[test]
    fn specialized_work_requires_its_own_site_and_offers_each_opportunity_once() {
        let mut s = SiteEvidence::default();
        assert!((WorkFamily::PortalHostel.definition().locate)(&s, &Story::default()).is_none());
        s.door = Some([4., 18.]);
        s.works.paired_door = Some([200., 300.]);
        assert_eq!(
            (WorkFamily::PortalHostel.definition().locate)(&s, &Story::default()),
            s.door
        );
        let mut works = MajorWorks::default();
        assert!(works.consider(WorkFamily::PortalHostel, [0., 0.]));
        assert!(!works.consider(WorkFamily::PortalHostel, [0., 0.]));
        assert!(works.consider(WorkFamily::PortalHostel, [1350., 900.]));
        assert!(works.consider(WorkFamily::SoundingStation, [0., 0.]));
    }

    #[test]
    fn a_harbor_can_launch_a_fleet_without_having_a_sacred_lake_or_sounding_practice() {
        let mut site = SiteEvidence {
            shore: Some([0., 0.]),
            institution: Some([40., 0.]),
            ..Default::default()
        };
        let locate = |family: WorkFamily, s: &SiteEvidence| {
            (family.definition().locate)(s, &Story::default())
        };
        site.works.deep_water = Some([0., 200.]);
        assert_eq!(locate(WorkFamily::Shipyard, &site), None);
        site.works.timber = Some([100., 0.]);
        assert_eq!(locate(WorkFamily::Shipyard, &site), site.shore);
        assert_eq!(locate(WorkFamily::LakeSanctuary, &site), None);
        assert_eq!(locate(WorkFamily::SoundingStation, &site), None);
        site.works.lake_shore = Some([35., 60.]);
        site.practice[2] = 0.5;
        assert_eq!(
            locate(WorkFamily::LakeSanctuary, &site),
            site.works.lake_shore
        );
        assert_eq!(locate(WorkFamily::SoundingStation, &site), site.shore);
    }
}
