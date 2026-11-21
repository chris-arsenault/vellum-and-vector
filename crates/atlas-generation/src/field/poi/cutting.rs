//! A people-built pass: where a busy way crosses a col the map shows, people cut and grade the
//! road over it. The grading is people's own rule on the `climbing` question
//! (`field::people::travel::graded`), so the cut road climbs cheaper and steeper; this entry
//! publishes it where it crosses a pass. The old society cycle made such cuttings a work on a
//! pass.
use super::{
    community_records::{self, CommunityState},
    contract::*,
    kinds::{Group, Kind},
    map_records::Record,
    places,
    realized::shown_pass,
    values::*,
};
use crate::{features::Feature, field::people::travel::graded, human::HumanField};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};

/// Whether a way is cut over a pass: the map shows a pass there and the way is graded.
pub fn cut(pass: bool, traffic: f64) -> bool {
    pass && graded(traffic)
}
fn traffic(state: &impl CommunityState, cell: usize) -> io::Result<f64> {
    state.field()?.people.view(HumanField::WalkedRoute).get(cell)
}
fn found(state: &impl CommunityState) -> io::Result<Vec<Place>> {
    let mut found = Vec::new();
    for cell in 0..state.field()?.mesh.len() {
        // The traffic is read first: few cells carry a graded way, and showing a pass costs more.
        let traffic = traffic(state, cell)?;
        if graded(traffic) && cut(shown_pass(state, cell)?, traffic) {
            let mut place = Place::at(Kind::Cutting, cell, vec![cell]);
            place.id = format!("cutting:{cell}");
            found.push(place);
        }
    }
    Ok(found)
}
/// How busy a cut pass is, against the traffic that cut it.
fn busy(state: &impl CommunityState, place: &Place) -> io::Result<f64> {
    Ok((traffic(state, place.anchor)? / (4.0 * crate::field::people::travel::WORN)).min(1.0))
}
fn record<S: CommunityState>(state: &S, place: &Place) -> io::Result<Option<Feature>> {
    let field = state.field()?;
    let [x, y] = field.mesh.position(place.anchor);
    let [ox, oy] = field.mesh.origin();
    let mut attributes = crate::features::records::Attributes::new();
    attributes.insert("travellerYears".into(), traffic(state, place.anchor)?.round().into());
    Ok(Some(community_records::local_record(
        state,
        Record {
            key: &place.id,
            name: "Cut pass",
            kind: "pass",
            layer: "transportSites",
            geometry: Geometry::Point { coordinates: Position::xy(x + ox, y + oy) },
            attributes,
        },
    )?))
}
fn movement<S: CommunityState + 'static>() -> Movement<S> {
    Movement {
        on_foot: None,
        statement: Must::Value("A cut and graded road climbs the col at less cost and steeper; people's travel grades it through the climbing question.".into()),
        roads: Slot::NotApplicable("The grading is people's rule on the climb, not a road cost."),
        boats: Slot::NotApplicable("Boats do not cross cols."),
        drainage: Slot::NotApplicable("A cutting leads no water."),
        magic: Slot::NotApplicable("A cutting carries no magic."),
        links: Slot::NotApplicable("A cutting joins no distant cells."),
        crosses: Slot::Value(Rc::new(|_, _| Ok(vec![Barrier::Ridge]))),
    }
}
fn roles<S: CommunityState + 'static>() -> Roles<S> {
    Roles {
        true_size: super::true_sizes::sited(&super::true_sizes::PASS),
        variety: Slot::Unwritten,
        appearance: Slot::Unwritten,
        account: super::true_sizes::account(Kind::Cutting),
        fields: Fields {
            statement: Must::Value("The cutting is a road's work; it changes no ground at map scale.".into()),
            terrain: Slot::NotApplicable("A road's cut is below the map's relief."),
            water: Slot::NotApplicable("It takes no water."),
            climate: Slot::NotApplicable("It changes no climate."),
            cover: Slot::NotApplicable("It clears only its road."),
            magic: Slot::NotApplicable("It keeps no magic."),
        },
        movement: movement(),
        others: Others {
            statement: Must::Value("A cutting lies on a col that busy ways cross.".into()),
            needs: Slot::Value(vec![Relation { kind: Kind::Pass, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }]),
            excludes: Slot::NotApplicable("Nothing excludes it."),
            contains: Slot::NotApplicable("It is one place."),
            pairs_with: Slot::NotApplicable("It pairs with its own pass."),
        },
        people: People {
            statement: Must::Value("It offers nothing in itself; it eases the way.".into()),
            offers: Slot::NotApplicable("Its worth is the cheaper way, read by travel."),
            threatens: Slot::NotApplicable("A cutting endangers no one."),
        },
        time: ThroughTime {
            statement: Must::Value("A cut road stays cut: the ground keeps the traffic that made it.".into()),
            fate: Slot::Value(Rc::new(|_, _| Ok(Fate::Persists))),
        },
        visibility: Visibility {
            statement: Must::Value("Its traffic makes it notable.".into()),
            magnitude: Slot::Value(Rc::new(|state, place| busy(state, place))),
            local_conditions: Slot::NotApplicable("It stands out by its traffic."),
            isolation: Slot::NotApplicable("Its distance from others does not matter."),
            cultural: Slot::NotApplicable("Its people's attachment is to the way."),
            importance: Must::Value(Rc::new(|state: &S, place| busy(state, place))),
        },
        naming: Naming {
            statement: Must::Value("The people who cut it name it.".into()),
            named_by: Slot::Value(Rc::new(places::naming_culture_near)),
            takes_name_from: Slot::NotApplicable("It takes no name from another place."),
            lends_name_to: Slot::NotApplicable("It lends no name."),
            term: Slot::Unwritten,
        },
    }
}
pub fn entry<S: CommunityState + 'static, Schedule>() -> Entry<S, Schedule> {
    let find: Places<S> = Rc::new(|s: &S| found(s));
    let finding = find.clone();
    Entry {
        id: Kind::Cutting,
        group: Group::Settlements,
        name: "Cut pass".into(),
        recognition: Recognition {
            distinct: Must::Value("A road people cut over a col; the col itself is a natural pass.".into()),
            is_a: Must::Value(Rc::new(move |state, cell| {
                places::holds_record(state, Kind::Cutting, cell, || finding(state))
            })),
            landform: Slot::NotApplicable("It is a work, not a landform."),
        },
        existence: Existence {
            origins: Slot::Unwritten,
            statement: Must::Value("People cut the road over a col their ways cross busily.".into()),
            way: Must::Value(ExistenceWay::Emerges),
            requires: Slot::NotApplicable("The col and its traffic decide it."),
            suitability: Slot::NotApplicable("The col and its traffic decide it."),
            places: Must::Value(find),
        },
        publication: Publication {
            delivery: Delivery::Landforms,
            statement: Must::Value("Publish it at its col.".into()),
            moment: Must::Value(Moment::Society),
            record: Must::Value(Rc::new(|state: &S, place: &Place| record(state, place))),
        },
        across_maps: AcrossMaps {
            statement: Must::Value("A finer map finds it again from its own cols and ways.".into()),
            stands_on: Slot::Unwritten,
            carry: Slot::NotApplicable("It is found again, not carried."),
            realize: Slot::NotApplicable("It shapes no ground."),
            counterpart: Slot::NotApplicable("It is found again from the ways."),
            unrealized: Slot::NotApplicable("It is found again from the ways."),
            settle: Slot::NotApplicable("It does not move with water."),
            schedule: Slot::NotApplicable("It adds no refinement step."),
        },
        event: None,
        roles: roles(),
    }
}
#[cfg(test)]
mod tests {
    use super::cut;
    use crate::field::people::travel::WORN;

    #[test]
    fn only_a_shown_pass_that_busy_ways_cross_is_cut() {
        assert!(cut(true, WORN));
        assert!(!cut(true, WORN / 2.0));
        assert!(!cut(false, 10.0 * WORN));
    }
}
