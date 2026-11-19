//! A settlement's story decides how big it is and how its streets were laid out.

/// How big a place is; the town tools share it (`atlas_map::town`).
pub use atlas_map::town::Size;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Layout {
    Organic,
    Grid,
    Radial,
    Linear,
    Walled,
}
impl Layout {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Organic => "organic",
            Self::Grid => "grid",
            Self::Radial => "radial",
            Self::Linear => "linear",
            Self::Walled => "walled",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::Organic,
            Self::Grid,
            Self::Radial,
            Self::Linear,
            Self::Walled,
        ]
        .into_iter()
        .find(|layout| layout.as_str() == value)
    }
}
/// What the settlement's record and its land say about how it grew.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Story {
    pub people: f64,
    /// Built land recorded at the parent scale, in square metres.
    pub built_area: f64,
    /// A capital or regional capital holds the seat of a realm or province.
    pub seat: bool,
    /// The record calls it a fortress, or a way through it is strategic.
    pub guarded: bool,
    /// Main streets entering from the ways.
    pub ways: usize,
    /// Its site is a river, river mouth or harbour.
    pub waterside: bool,
    /// Its site is a pass, where the place strings out along the way over high ground.
    pub pass: bool,
    pub upland: bool,
    /// Eras in which the place held townsfolk, and eras in its whole record.
    pub town_eras: usize,
    pub eras: usize,
}
impl Story {
    pub fn size(&self) -> Size {
        Size::of(self.people)
    }
    /// A place that became a town only in its last era, in a longer history, was laid out
    /// at once rather than growing.
    pub fn planned(&self) -> bool {
        self.eras >= 2 && self.town_eras <= 1
    }
    pub fn old(&self) -> bool {
        self.town_eras >= 2
    }
}
/// The layout a settlement's own story gives it, unless the creator forces one.
pub fn layout(story: &Story, forced: Option<Layout>) -> Layout {
    if let Some(layout) = forced {
        return layout;
    }
    let size = story.size();
    if size >= Size::Town && (story.seat || story.guarded) && story.old() {
        Layout::Walled
    } else if size <= Size::Hamlet || (size == Size::Village && (story.pass || story.ways <= 1)) {
        Layout::Linear
    } else if story.planned() && !story.upland {
        Layout::Grid
    } else if size >= Size::Town && story.ways >= 4 {
        Layout::Radial
    } else if size == Size::Village && story.waterside && story.ways <= 2 {
        Layout::Linear
    } else {
        Layout::Organic
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn story(people: f64) -> Story {
        Story {
            people,
            ways: 2,
            town_eras: 3,
            eras: 3,
            ..Story::default()
        }
    }
    #[test]
    fn size_follows_people() {
        assert_eq!(Size::of(5.0), Size::Farmstead);
        assert_eq!(Size::of(60.0), Size::Hamlet);
        assert_eq!(Size::of(400.0), Size::Village);
        assert_eq!(Size::of(3_000.0), Size::Town);
        assert_eq!(Size::of(20_000.0), Size::City);
    }
    #[test]
    fn layout_follows_the_settlements_story() {
        assert_eq!(layout(&story(60.0), None), Layout::Linear);
        assert_eq!(layout(&story(400.0), None), Layout::Organic);
        let pass = Story {
            pass: true,
            ..story(400.0)
        };
        assert_eq!(layout(&pass, None), Layout::Linear);
        let seat = Story {
            seat: true,
            ..story(5_000.0)
        };
        assert_eq!(layout(&seat, None), Layout::Walled);
        let crossroads = Story {
            ways: 5,
            ..story(5_000.0)
        };
        assert_eq!(layout(&crossroads, None), Layout::Radial);
    }
    #[test]
    fn a_late_town_is_planned_unless_its_ground_is_upland_or_the_creator_chooses() {
        let new_town = Story {
            town_eras: 1,
            ..story(2_000.0)
        };
        assert_eq!(layout(&new_town, None), Layout::Grid);
        let new_upland = Story {
            upland: true,
            ..new_town.clone()
        };
        assert_eq!(layout(&new_upland, None), Layout::Organic);
        assert_eq!(layout(&new_town, Some(Layout::Radial)), Layout::Radial);
        assert_eq!(Layout::parse("walled"), Some(Layout::Walled));
        assert_eq!(Layout::parse("story"), None);
    }
}
