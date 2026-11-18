//! Purposes offered by place definitions when a settlement first develops.
use super::{AccessUse, Kind, PlaceRules, PLACES};
use crate::town::{
    fabric::{Anchor, Purpose, Relationship},
    seat::Seat,
};

impl Purpose {
    pub fn for_seat(seat: &Seat) -> Vec<Self> {
        PLACES
            .iter()
            .filter_map(|&kind| (kind.definition().roles.intention?)(kind, seat))
            .collect()
    }
}
pub(super) fn approach(seat: &Seat) -> Anchor {
    if seat.arms.is_empty() {
        Anchor::Settlement
    } else {
        Anchor::Approach(0)
    }
}

pub(super) fn access(kind: Kind, site: Anchor, from: Anchor) -> Purpose {
    Purpose {
        site,
        relationships: vec![
            Relationship::Accommodation(kind),
            Relationship::Access {
                from,
                to: kind,
                use_: AccessUse::Freight,
            },
        ],
        investment: 0.,
    }
}
