//! Pictures in planar metres: a fixed frame drawn north up at a chosen width in pixels.
use atlas_map::{Geometry, Position};
use std::{io, path::Path};
use tiny_skia::{
    Color, FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke,
    StrokeDash, Transform,
};

pub type Point = [f64; 2];

/// The part of the plane a picture shows, in metres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub west: f64,
    pub south: f64,
    pub width: f64,
    pub height: f64,
}
impl Frame {
    /// The smallest frame of `aspect` (width over height) holding `[west, south, east, north]`,
    /// widened by `margin` (a share of its width) and never narrower than `least` metres.
    pub fn around(bounds: [f64; 4], aspect: f64, margin: f64, least: f64) -> Self {
        let [west, south, east, north] = bounds;
        let width = (east - west).max((north - south) * aspect).max(least) * (1. + margin);
        Self::centred([(west + east) / 2., (south + north) / 2.], width, aspect)
    }
    pub fn centred([x, y]: Point, width: f64, aspect: f64) -> Self {
        let height = width / aspect;
        Self {
            west: x - width / 2.,
            south: y - height / 2.,
            width,
            height,
        }
    }
}

/// `[west, south, east, north]` that grows to hold each point it is given.
#[derive(Clone, Copy)]
pub struct Extent(pub [f64; 4]);
impl Default for Extent {
    fn default() -> Self {
        Self([f64::INFINITY, f64::INFINITY, -f64::INFINITY, -f64::INFINITY])
    }
}
impl Extent {
    pub fn include(&mut self, [x, y]: Point) {
        let [w, s, e, n] = &mut self.0;
        *w = w.min(x);
        *s = s.min(y);
        *e = e.max(x);
        *n = n.max(y);
    }
    pub fn include_geometry(&mut self, geometry: &Geometry) {
        for ring in parts(geometry) {
            ring.into_iter().for_each(|p| self.include(p));
        }
    }
}

/// Each ring or line of a geometry as planar points; points stand alone.
pub fn parts(geometry: &Geometry) -> Vec<Vec<Point>> {
    let line = |positions: &[Position]| {
        positions
            .iter()
            .map(|p| {
                let [x, y, _] = p.coordinates();
                [x, y]
            })
            .collect::<Vec<_>>()
    };
    match geometry {
        Geometry::Point { coordinates } => vec![line(std::slice::from_ref(coordinates))],
        Geometry::MultiPoint { coordinates } | Geometry::LineString { coordinates } => {
            vec![line(coordinates)]
        }
        Geometry::MultiLineString { coordinates } | Geometry::Polygon { coordinates } => {
            coordinates.iter().map(|ring| line(ring)).collect()
        }
        Geometry::MultiPolygon { coordinates } => coordinates
            .iter()
            .flatten()
            .map(|ring| line(ring))
            .collect(),
        Geometry::GeometryCollection { geometries } => geometries.iter().flat_map(parts).collect(),
    }
}
fn is_area(geometry: &Geometry) -> bool {
    match geometry {
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => true,
        Geometry::GeometryCollection { geometries } => geometries.iter().any(is_area),
        _ => false,
    }
}

pub fn colour(hex: &str) -> Color {
    let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).unwrap_or(0);
    Color::from_rgba8(channel(1), channel(3), channel(5), 255)
}

pub struct Canvas {
    pixmap: Pixmap,
    frame: Frame,
    /// Pixels per metre.
    scale: f64,
}
impl Canvas {
    pub fn new(pixels_across: u32, frame: Frame, background: &str) -> io::Result<Self> {
        let scale = f64::from(pixels_across) / frame.width;
        let down = (frame.height * scale).round().max(1.) as u32;
        let mut pixmap = Pixmap::new(pixels_across, down)
            .ok_or_else(|| io::Error::other("A picture needs a size"))?;
        pixmap.fill(colour(background));
        Ok(Self {
            pixmap,
            frame,
            scale,
        })
    }
    pub fn height(&self) -> u32 {
        self.pixmap.height()
    }
    pub fn pixels(&self, metres: f64) -> f64 {
        metres * self.scale
    }
    /// Paint a published categorical raster in its world coordinates, inside the map edge.
    pub fn surface(&mut self, image: &Pixmap, bounds: atlas_map::Bounds, footprint: &Geometry) {
        let Some(path) = self.path(&parts(footprint), true) else {
            return;
        };
        let atlas_map::Bounds(w, s, e, n) = bounds;
        let (x, y) = self.pixel([w, n]);
        let transform = Transform::from_row(
            ((e - w) * self.scale / f64::from(image.width())) as f32,
            0.,
            0.,
            ((n - s) * self.scale / f64::from(image.height())) as f32,
            x,
            y,
        );
        let paint = Paint {
            shader: tiny_skia::Pattern::new(
                image.as_ref(),
                tiny_skia::SpreadMode::Pad,
                tiny_skia::FilterQuality::Nearest,
                1.,
                transform,
            ),
            ..Paint::default()
        };
        self.pixmap.fill_path(
            &path,
            &paint,
            FillRule::EvenOdd,
            Transform::identity(),
            None,
        );
    }
    fn pixel(&self, [x, y]: Point) -> (f32, f32) {
        (
            ((x - self.frame.west) * self.scale) as f32,
            ((self.frame.south + self.frame.height - y) * self.scale) as f32,
        )
    }
    fn path(&self, lines: &[Vec<Point>], closed: bool) -> Option<tiny_skia::Path> {
        let mut path = PathBuilder::new();
        for line in lines
            .iter()
            .filter(|l| l.len() >= if closed { 3 } else { 2 })
        {
            let (x, y) = self.pixel(line[0]);
            path.move_to(x, y);
            for &point in &line[1..] {
                let (x, y) = self.pixel(point);
                path.line_to(x, y);
            }
            if closed {
                path.close();
            }
        }
        path.finish()
    }
    /// A stroke `width` metres wide, but never thinner than `least` pixels.
    fn stroke(&self, width: f64, least: f64) -> Stroke {
        Stroke {
            width: (width * self.scale).max(least) as f32,
            line_cap: LineCap::Round,
            line_join: LineJoin::Round,
            ..Stroke::default()
        }
    }
    fn paint(hex: &str) -> Paint<'static> {
        let mut paint = Paint::default();
        paint.set_color(colour(hex));
        paint.anti_alias = true;
        paint
    }
    /// Fills an area; an `outline` is `(colour, metres)`. Lines and points are ignored.
    pub fn fill(&mut self, geometry: &Geometry, fill: &str, outline: Option<(&str, f64)>) {
        if !is_area(geometry) {
            return;
        }
        let Some(path) = self.path(&parts(geometry), true) else {
            return;
        };
        self.pixmap.fill_path(
            &path,
            &Self::paint(fill),
            FillRule::EvenOdd,
            Transform::identity(),
            None,
        );
        if let Some((hex, width)) = outline {
            let stroke = self.stroke(width, 0.);
            self.pixmap.stroke_path(
                &path,
                &Self::paint(hex),
                &stroke,
                Transform::identity(),
                None,
            );
        }
    }
    /// Draws a line `width` metres wide, at least `least` pixels.
    pub fn line(&mut self, points: &[Point], width: f64, least: f64, hex: &str) {
        self.lines(&[points.to_vec()], width, least, &Self::paint(hex), false);
    }
    /// Draws every line and ring of a geometry.
    pub fn outline(&mut self, geometry: &Geometry, width: f64, least: f64, hex: &str) {
        self.lines(
            &parts(geometry),
            width,
            least,
            &Self::paint(hex),
            is_area(geometry),
        );
    }
    /// A beaten tread keeps its measured width, even below one pixel.
    pub fn footpath(&mut self, lines: &[Vec<Point>], width: f64, wear: Option<f64>) {
        let wear = wear.unwrap_or(4.).max(0.);
        let pigment = 0.12 + 0.72 * wear / (wear + 4.);
        let opacity = (pigment / (width / 0.7).min(1.)).min(0.84);
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(
            115,
            92,
            63,
            (255. * opacity).round() as u8,
        ));
        self.lines(lines, width, 0., &paint, false);
    }
    pub fn dashed(&mut self, points: &[Point], width: f64, hex: &str) {
        let Some(path) = self.path(&[points.to_vec()], false) else {
            return;
        };
        let mut stroke = self.stroke(width, 1.);
        stroke.dash = StrokeDash::new(vec![3. * stroke.width, 2. * stroke.width], 0.);
        self.pixmap.stroke_path(
            &path,
            &Self::paint(hex),
            &stroke,
            Transform::identity(),
            None,
        );
    }
    fn lines(&mut self, lines: &[Vec<Point>], width: f64, least: f64, paint: &Paint, closed: bool) {
        let Some(path) = self.path(lines, closed) else {
            return;
        };
        let stroke = self.stroke(width, least);
        self.pixmap
            .stroke_path(&path, paint, &stroke, Transform::identity(), None);
    }
    /// Marks each point of a geometry with a ringed dot `pixels` across, whatever the scale.
    pub fn mark(&mut self, geometry: &Geometry, pixels: f64, hex: &str) {
        for point in parts(geometry).into_iter().flatten() {
            let (x, y) = self.pixel(point);
            let Some(dot) = PathBuilder::from_circle(x, y, (pixels / 2.) as f32) else {
                continue;
            };
            self.pixmap.fill_path(
                &dot,
                &Self::paint(hex),
                FillRule::Winding,
                Transform::identity(),
                None,
            );
            let stroke = Stroke {
                width: 1.,
                ..Stroke::default()
            };
            self.pixmap.stroke_path(
                &dot,
                &Self::paint("#ffffff"),
                &stroke,
                Transform::identity(),
                None,
            );
        }
    }
    /// Places another picture with its top left corner at `(x, y)` pixels.
    pub fn place(&mut self, other: &Canvas, x: i32, y: i32) {
        self.pixmap.draw_pixmap(
            x,
            y,
            other.pixmap.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            None,
        );
    }
    /// A canvas of exactly this many pixels, for laying pictures side by side.
    pub fn sheet(width: u32, height: u32, background: &str) -> io::Result<Self> {
        Self::new(
            width,
            Frame {
                west: 0.,
                south: 0.,
                width: f64::from(width),
                height: f64::from(height),
            },
            background,
        )
    }
    pub fn save(&self, path: &Path) -> io::Result<()> {
        self.pixmap.save_png(path).map_err(io::Error::other)
    }
    /// Sets one pixel, counting rows from the top.
    pub fn set(&mut self, x: u32, y: u32, [r, g, b]: [u8; 3]) {
        let width = self.pixmap.width();
        let pixel = &mut self.pixmap.pixels_mut()[(y * width + x) as usize];
        *pixel = tiny_skia::PremultipliedColorU8::from_rgba(r, g, b, 255).unwrap_or(*pixel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_frame_holds_its_bounds_at_the_requested_shape() {
        let frame = Frame::around([0., 0., 100., 10.], 4. / 3., 0., 0.);
        assert_eq!((frame.width, frame.height), (100., 75.));
        assert_eq!((frame.west, frame.south), (0., -32.5));
        let tall = Frame::around([0., 0., 10., 300.], 4. / 3., 0.1, 0.);
        assert!((tall.height - 330.).abs() < 1e-9);
        assert_eq!(Frame::around([5., 5., 5., 5.], 1., 0., 40.).width, 40.);
    }
    #[test]
    fn a_square_fills_the_pixels_it_covers_and_north_is_up() {
        let frame = Frame {
            west: 0.,
            south: 0.,
            width: 10.,
            height: 10.,
        };
        let mut canvas = Canvas::new(10, frame, "#ffffff").unwrap();
        let square = |s: f64, n: f64| Geometry::Polygon {
            coordinates: vec![[[0., s], [5., s], [5., n], [0., n], [0., s]]
                .into_iter()
                .map(|[x, y]| Position::xy(x, y))
                .collect()],
        };
        canvas.fill(&square(5., 10.), "#000000", None);
        let at = |x: u32, y: u32| canvas.pixmap.pixel(x, y).unwrap().red();
        // The northern half of the plane is the top of the picture.
        assert_eq!(at(2, 2), 0);
        assert_eq!(at(2, 7), 255);
        assert_eq!(at(7, 2), 255);
    }
}
