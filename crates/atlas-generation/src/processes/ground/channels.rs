//! A channel at its real size from the water it carries and the bed it runs on: one declared
//! hydraulic-geometry relation. On a real-scale map the water model sizes every channel cell
//! with it (`water/channel_geometry.rs`), so the drawn rivers, crossings and trails read the
//! same widths and depths. The width per bed is a rock-family fact in the rock catalogue.
use super::settings::{VELOCITY_AT_UNIT_DISCHARGE, VELOCITY_EXPONENT};
use crate::rock::catalogue::RockFamily;

/// A channel's bank-to-bank width and mean depth, in metres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Channel {
    pub width: f64,
    pub depth: f64,
}
/// The channel that carries a mean `discharge` (cubic metres a second) over a bed of `bed`:
/// width grows with the square root of discharge; depth carries the discharge at that width
/// and the mean velocity, which grows slowly with discharge.
pub fn channel(discharge: f64, bed: RockFamily) -> Channel {
    let discharge = discharge.max(0.0);
    let width = bed.channel_width_per_root_discharge() * discharge.sqrt();
    Channel {
        width,
        depth: depth(discharge, width),
    }
}
/// The mean depth at which a channel `width` metres wide carries `discharge`.
pub fn depth(discharge: f64, width: f64) -> f64 {
    let velocity = VELOCITY_AT_UNIT_DISCHARGE * discharge.max(0.0).powf(VELOCITY_EXPONENT);
    if width <= 0.0 || velocity <= 0.0 {
        return 0.0;
    }
    discharge / (width * velocity)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_width_per_bed_is_the_rock_familys_catalogue_fact() {
        for family in [
            RockFamily::Loose,
            RockFamily::Broken,
            RockFamily::Sedimentary,
            RockFamily::Ice,
            RockFamily::Metamorphic,
            RockFamily::Igneous,
        ] {
            let made = channel(1.0, family);
            assert_eq!(made.width, family.channel_width_per_root_discharge());
        }
    }
    #[test]
    fn width_grows_with_the_square_root_of_discharge() {
        let small = channel(1.0, RockFamily::Loose);
        let large = channel(4.0, RockFamily::Loose);
        assert!((large.width / small.width - 2.0).abs() < 1e-9);
        assert!((small.width - 4.5).abs() < 1e-9);
    }
    #[test]
    fn loose_beds_spread_wider_and_shallower_than_bedrock() {
        let alluvial = channel(10.0, RockFamily::Loose);
        let bedrock = channel(10.0, RockFamily::Igneous);
        assert!(alluvial.width > bedrock.width);
        assert!(alluvial.depth < bedrock.depth);
    }
    #[test]
    fn a_channel_carries_its_discharge_at_its_width_and_velocity() {
        let made = channel(20.0, RockFamily::Sedimentary);
        let velocity = VELOCITY_AT_UNIT_DISCHARGE * 20f64.powf(VELOCITY_EXPONENT);
        assert!((made.width * made.depth * velocity - 20.0).abs() < 1e-9);
        // A brook of a cubic metre a second is a few metres wide and a few decimetres deep.
        let brook = channel(1.0, RockFamily::Loose);
        assert!(brook.depth > 0.2 && brook.depth < 0.5);
    }
    #[test]
    fn no_water_makes_no_channel() {
        assert_eq!(
            channel(0.0, RockFamily::Loose),
            Channel {
                width: 0.0,
                depth: 0.0
            }
        );
    }
}
