//! Edit descriptions for authored terrain: pixel rectangles, brush strokes and height shapes.
//! Positions and distances are map units; heights are metres with sea level at 0.
use serde::{Deserialize, Serialize};
use std::io;
use ts_rs::TS;

/// A half-open pixel rectangle: columns from the west edge, rows from the north edge.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rect {
    pub col0: u32,
    pub row0: u32,
    pub col1: u32,
    pub row1: u32,
}
impl Rect {
    pub fn is_empty(self) -> bool {
        self.col0 >= self.col1 || self.row0 >= self.row1
    }
    pub fn width(self) -> u32 {
        self.col1.saturating_sub(self.col0)
    }
    pub fn height(self) -> u32 {
        self.row1.saturating_sub(self.row0)
    }
    pub fn area(self) -> usize {
        self.width() as usize * self.height() as usize
    }
    pub fn intersect(self, other: Self) -> Self {
        Self {
            col0: self.col0.max(other.col0),
            row0: self.row0.max(other.row0),
            col1: self.col1.min(other.col1),
            row1: self.row1.min(other.row1),
        }
    }
    /// The smallest rectangle holding both; an empty rectangle adds nothing.
    pub fn union(self, other: Self) -> Self {
        if self.is_empty() {
            return other;
        }
        if other.is_empty() {
            return self;
        }
        Self {
            col0: self.col0.min(other.col0),
            row0: self.row0.min(other.row0),
            col1: self.col1.max(other.col1),
            row1: self.row1.max(other.row1),
        }
    }
    pub fn grow(self, pixels: u32) -> Self {
        Self {
            col0: self.col0.saturating_sub(pixels),
            row0: self.row0.saturating_sub(pixels),
            col1: self.col1.saturating_add(pixels),
            row1: self.row1.saturating_add(pixels),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum BrushMode {
    Raise,
    Lower,
    Smooth,
    /// Blend toward the stroke's target height, scaled by strength.
    Flatten,
    /// Blend toward the stroke's target height at full strength.
    Set,
}

/// A brush path: soft round dabs stamped along the points.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stroke {
    pub points: Vec<[f64; 2]>,
    pub radius: f64,
    /// 0 to 1.
    pub strength: f64,
    pub mode: BrushMode,
    /// Metres; read by Flatten and Set.
    pub target: f32,
    /// Metres a full-strength dab at its centre adds or removes; read by Raise and Lower.
    pub step_height: f32,
}
/// A guide line carrying a height per vertex; cells near it follow the height along it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeightLine {
    pub points: Vec<[f64; 2]>,
    pub heights: Vec<f32>,
    pub half_width: f64,
}
/// A polygon (outer ring first, holes after) raised or lowered to one height; `feather` is the
/// width in map units of the soft skirt outside its edge, 0 for a hard edge.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeightArea {
    pub rings: Vec<Vec<[f64; 2]>>,
    pub height: f32,
    pub feather: f64,
}
/// A point summit: a smooth bump of `height` metres fading out at `radius`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeightPeak {
    pub at: [f64; 2],
    pub height: f32,
    pub radius: f64,
}

fn bad(message: &str) -> io::Error {
    io::Error::other(message)
}
pub(super) fn check_points(points: &[[f64; 2]], what: &str) -> io::Result<()> {
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return Err(io::Error::other(format!(
            "{what} has a non-finite position"
        )));
    }
    Ok(())
}
fn check_size(value: f64, what: &str) -> io::Result<()> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "{what} must be a positive number"
        )))
    }
}
pub(super) fn check_rings(rings: &[Vec<[f64; 2]>]) -> io::Result<()> {
    if rings.is_empty() || rings.iter().any(|ring| ring.len() < 3) {
        return Err(bad("A polygon needs rings of at least three points"));
    }
    rings
        .iter()
        .try_for_each(|ring| check_points(ring, "A polygon"))
}
impl Stroke {
    pub fn validate(&self) -> io::Result<()> {
        if self.points.is_empty() {
            return Err(bad("A brush stroke needs at least one point"));
        }
        check_points(&self.points, "A brush stroke")?;
        check_size(self.radius, "The brush radius")?;
        if !(self.strength.is_finite() && (0.0..=1.0).contains(&self.strength)) {
            return Err(bad("The brush strength must be between 0 and 1"));
        }
        if !self.target.is_finite() || !self.step_height.is_finite() {
            return Err(bad("The brush heights must be finite numbers"));
        }
        Ok(())
    }
}
impl HeightLine {
    pub fn validate(&self) -> io::Result<()> {
        if self.points.is_empty() || self.points.len() != self.heights.len() {
            return Err(bad("A height line needs one height for each point"));
        }
        check_points(&self.points, "A height line")?;
        check_size(self.half_width, "The line half-width")?;
        if self.heights.iter().any(|h| !h.is_finite()) {
            return Err(bad("A height line has a non-finite height"));
        }
        Ok(())
    }
}
impl HeightArea {
    pub fn validate(&self) -> io::Result<()> {
        check_rings(&self.rings)?;
        if !self.height.is_finite() || !self.feather.is_finite() || self.feather < 0.0 {
            return Err(bad(
                "A height area needs a finite height and a feather of 0 or more",
            ));
        }
        Ok(())
    }
}
impl HeightPeak {
    pub fn validate(&self) -> io::Result<()> {
        check_points(&[self.at], "A peak")?;
        check_size(self.radius, "The peak radius")?;
        if !self.height.is_finite() {
            return Err(bad("The peak height must be a finite number"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_union_and_intersection_ignore_empty_parts() {
        let a = Rect {
            col0: 2,
            row0: 2,
            col1: 5,
            row1: 6,
        };
        let b = Rect {
            col0: 4,
            row0: 1,
            col1: 9,
            row1: 3,
        };
        assert_eq!(
            a.union(b),
            Rect {
                col0: 2,
                row0: 1,
                col1: 9,
                row1: 6
            }
        );
        assert_eq!(
            a.intersect(b),
            Rect {
                col0: 4,
                row0: 2,
                col1: 5,
                row1: 3
            }
        );
        assert_eq!(Rect::default().union(a), a);
        assert!(a
            .intersect(Rect {
                col0: 7,
                row0: 7,
                col1: 8,
                row1: 8
            })
            .is_empty());
        assert_eq!(a.grow(10).col0, 0);
    }
    #[test]
    fn bad_input_is_refused_in_plain_words() {
        let mut stroke = Stroke {
            points: vec![[0.0, 0.0]],
            radius: f64::NAN,
            strength: 0.5,
            mode: BrushMode::Raise,
            target: 0.0,
            step_height: 10.0,
        };
        assert!(stroke
            .validate()
            .unwrap_err()
            .to_string()
            .contains("radius"));
        stroke.radius = 3.0;
        stroke.strength = 2.0;
        assert!(stroke.validate().is_err());
        let line = HeightLine {
            points: vec![[0.0, 0.0]],
            heights: vec![],
            half_width: 1.0,
        };
        assert!(line.validate().is_err());
        let area = HeightArea {
            rings: vec![vec![[0.0, 0.0], [1.0, 1.0]]],
            height: 1.0,
            feather: 0.0,
        };
        assert!(area.validate().is_err());
    }
}
