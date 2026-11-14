use atlas_map::Category;
// hpc-exempt: GIS legend codes index display styles, not numerical cells.
use std::{collections::BTreeMap, io};

struct Paint {
    rgb: [f32; 3],
    tint: f32,
    natural: bool,
}
// hpc-exempt: named GIS legend entries, not numerical field storage.
pub struct Colors(BTreeMap<i32, Paint>);
impl Colors {
    pub fn new(categories: &[Category]) -> io::Result<Self> {
        // hpc-exempt: GIS legend codes index display styles, not numerical cells.
        let mut colors = BTreeMap::new();
        for category in categories {
            if category.surface.as_ref().is_some_and(|s| s.bathymetric) {
                continue;
            }
            let Some(color) = category.color.as_deref() else {
                continue;
            };
            let hex = color
                .strip_prefix('#')
                .filter(|s| s.len() == 6)
                .ok_or_else(|| io::Error::other("Map surface colors require RGB hex values"))?;
            let value = u32::from_str_radix(hex, 16).map_err(io::Error::other)?;
            colors.insert(
                category.value,
                Paint {
                    rgb: [
                        ((value >> 16) & 255) as f32,
                        ((value >> 8) & 255) as f32,
                        (value & 255) as f32,
                    ],
                    tint: category.surface.as_ref().map_or(1.0, |s| s.tint as f32),
                    natural: category.surface.as_ref().is_none_or(|s| s.system.is_none()),
                },
            );
        }
        Ok(Self(colors))
    }
    /// Premultiplied display colors can be averaged without inventing category identities.
    pub fn pixel(&self, surface: f64, natural: f64) -> [f32; 4] {
        let under = self.0.get(&(natural as i32)).filter(|p| p.natural);
        let mut result = under.map_or([0.0; 4], |p| [p.rgb[0], p.rgb[1], p.rgb[2], 1.0]);
        if let Some(paint) = self.0.get(&(surface as i32)) {
            for (channel, color) in result[..3].iter_mut().zip(paint.rgb) {
                *channel = paint.tint * color + (1.0 - paint.tint) * *channel;
            }
            result[3] = paint.tint + (1.0 - paint.tint) * result[3];
        }
        result
    }
}
