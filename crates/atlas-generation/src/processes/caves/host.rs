//! Which bed beneath a cell holds a cave, and how it opened. Rock facts come from the
//! catalogue; magic opens rock through its own medium, never by adding to a rock fact.
use super::settings::{OPEN_FROM, REACH, SOLUBLE_FROM, STANDS_FROM, TUBE_CRUST};
use crate::rock::catalogue::{kind_of_code, RockFamily};

/// How a cave opened: each form has its own cause and its own passage shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Form {
    /// Groundwater dissolved soluble rock along its own flow.
    Dissolved,
    /// Stress opened joints in hard, fractured rock.
    Fissure,
    /// A lava flow drained out beneath its own cooled crust.
    LavaTube,
    /// Fire's heat runs its veins through the fracture network and holds a conduit open.
    Thermal,
}
impl Form {
    pub const ALL: [Self; 4] = [
        Self::Dissolved,
        Self::Fissure,
        Self::LavaTube,
        Self::Thermal,
    ];
    pub fn id(self) -> &'static str {
        match self {
            Self::Dissolved => "dissolved",
            Self::Fissure => "fissure",
            Self::LavaTube => "lavaTube",
            Self::Thermal => "thermal",
        }
    }
    /// The published kind of this form's passages.
    pub fn passage_kind(self) -> &'static str {
        match self {
            Self::Dissolved => "dissolvedPassage",
            Self::Fissure => "fissure",
            Self::LavaTube => "lavaTube",
            Self::Thermal => "thermalPassage",
        }
    }
    pub fn passage_label(self) -> &'static str {
        match self {
            Self::Dissolved => "Dissolved passage",
            Self::Fissure => "Fissure",
            Self::LavaTube => "Lava tube",
            Self::Thermal => "Thermal passage",
        }
    }
    /// The generic term a cave of this form is named with.
    pub fn term(self) -> &'static str {
        match self {
            Self::Dissolved => "Cave",
            Self::Fissure => "Rift",
            Self::LavaTube => "Lava Tube",
            Self::Thermal => "Vents",
        }
    }
}
/// The magic system whose own medium opened a cave, when one did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Magic {
    /// Fire's veins and spent basalt.
    Fire,
    /// Greenwood's failed water, which leaves sinkholes whatever the rock.
    Greenwood,
}
impl Magic {
    pub fn id(self) -> &'static str {
        match self {
            Self::Fire => "fire",
            Self::Greenwood => "greenwood",
        }
    }
}
/// One bed of a cell's rock section. Depths are metres below the ground.
#[derive(Clone, Copy, Debug)]
pub struct Bed {
    pub kind: usize,
    pub top: f64,
    pub thickness: f64,
    pub strength: f64,
    pub loose: bool,
}
/// What else the ground says at a cell.
#[derive(Clone, Copy, Debug, Default)]
pub struct Signs {
    /// Fracture openness, conductance per thousand.
    pub fracture: f64,
    /// Volcanic construction built this ground.
    pub volcanic: bool,
    /// Fire's thermal vein runs here.
    pub fire_vein: bool,
    /// Fire's basalt flat lies here.
    pub fire_basalt: bool,
    /// Greenwood's sinkhole ground lies here.
    pub greenwood_sinkhole: bool,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Host {
    pub form: Form,
    pub magic: Option<Magic>,
    /// Depth of the host bed's top below the ground, metres.
    pub top: f64,
    /// The host bed's thickness within reach, metres.
    pub thickness: f64,
    /// How far the rock is opened: solubility for dissolved rock, fracture openness otherwise.
    pub openness: f64,
}
/// The first bed within reach that some cause has opened; loose cover holds no open space.
pub fn host(beds: &[Bed], signs: &Signs) -> Option<Host> {
    beds.iter()
        .filter(|bed| !bed.loose && bed.top < REACH)
        .find_map(|bed| opened(bed, signs))
}
fn opened(bed: &Bed, signs: &Signs) -> Option<Host> {
    let kind = kind_of_code(bed.kind);
    let facts = &kind.facts;
    let held = |form, magic, openness| {
        Some(Host {
            form,
            magic,
            top: bed.top,
            thickness: bed.thickness.min(REACH - bed.top),
            openness,
        })
    };
    if signs.fire_vein {
        return held(
            Form::Thermal,
            Some(Magic::Fire),
            signs.fracture.max(facts.jointing),
        );
    }
    let lava = signs.fire_basalt || signs.volcanic;
    if lava && kind.family == RockFamily::Igneous && bed.top <= TUBE_CRUST {
        return held(
            Form::LavaTube,
            signs.fire_basalt.then_some(Magic::Fire),
            1.0,
        );
    }
    if signs.greenwood_sinkhole {
        return held(
            Form::Dissolved,
            Some(Magic::Greenwood),
            facts.solubility.max(SOLUBLE_FROM),
        );
    }
    if facts.solubility >= SOLUBLE_FROM {
        return held(Form::Dissolved, None, facts.solubility);
    }
    if bed.strength >= STANDS_FROM && signs.fracture >= OPEN_FROM {
        return held(Form::Fissure, None, signs.fracture);
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::rock::catalogue::{BASALT, GRANITE, LIMESTONE, SHALE, SOIL};
    fn bed(kind: usize, top: f64, strength: f64) -> Bed {
        Bed {
            kind,
            top,
            thickness: 40.0,
            strength,
            loose: kind == SOIL,
        }
    }
    #[test]
    fn karst_rock_under_cover_dissolves_and_shale_does_not() {
        let beds = [
            bed(SOIL, 0.0, 250.0),
            bed(SHALE, 1.0, 600.0),
            bed(LIMESTONE, 12.0, 1200.0),
        ];
        let found = host(&beds, &Signs::default()).unwrap();
        assert_eq!(
            (found.form, found.top, found.magic),
            (Form::Dissolved, 12.0, None)
        );
        assert!(host(&beds[..2], &Signs::default()).is_none());
    }
    #[test]
    fn hard_rock_opens_only_where_fractures_are_open() {
        let beds = [bed(GRANITE, 0.0, 2400.0)];
        assert!(host(&beds, &Signs::default()).is_none());
        let signs = Signs {
            fracture: 0.6,
            ..Default::default()
        };
        assert_eq!(host(&beds, &signs).unwrap().form, Form::Fissure);
        assert!(host(&[bed(GRANITE, 0.0, 900.0)], &signs).is_none());
    }
    #[test]
    fn volcanic_ground_keeps_tubes_only_under_its_own_crust() {
        let signs = Signs {
            volcanic: true,
            ..Default::default()
        };
        let tube = host(&[bed(BASALT, 0.0, 2600.0)], &signs).unwrap();
        assert_eq!((tube.form, tube.magic), (Form::LavaTube, None));
        assert!(host(&[bed(BASALT, 30.0, 2600.0)], &signs).is_none());
        let fire = Signs {
            fire_basalt: true,
            ..Default::default()
        };
        let tube = host(&[bed(BASALT, 0.0, 2600.0)], &fire).unwrap();
        assert_eq!(tube.magic, Some(Magic::Fire));
    }
    #[test]
    fn magic_opens_rock_through_its_own_medium() {
        let beds = [bed(SHALE, 0.0, 600.0)];
        let vein = Signs {
            fire_vein: true,
            fracture: 0.5,
            ..Default::default()
        };
        assert_eq!(host(&beds, &vein).unwrap().form, Form::Thermal);
        let sinkhole = Signs {
            greenwood_sinkhole: true,
            ..Default::default()
        };
        let found = host(&beds, &sinkhole).unwrap();
        assert_eq!(
            (found.form, found.magic),
            (Form::Dissolved, Some(Magic::Greenwood))
        );
    }
    #[test]
    fn beds_beyond_reach_hold_nothing() {
        let beds = [bed(SHALE, 0.0, 600.0), bed(LIMESTONE, REACH + 1.0, 1200.0)];
        assert!(host(&beds, &Signs::default()).is_none());
    }
}
