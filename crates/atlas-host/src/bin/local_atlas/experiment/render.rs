use super::{
    measure::{Grid, Metric},
    Results,
};
use std::{fmt::Write as _, fs, io, path::Path};
use tiny_skia::{Color, Pixmap, PixmapPaint, Transform};

pub(super) fn write(
    results: &Results,
    directory: &Path,
    metric: Option<Metric>,
    logarithmic: bool,
) -> io::Result<()> {
    let metric = metric.unwrap_or(results.metric);
    table(results, &directory.join("measurements.csv"))?;
    fs::write(
        directory.join("series.svg"),
        chart(results, metric, logarithmic),
    )?;
    maps(results, &directory.join("maps.png"), logarithmic)
}

fn csv(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn table(results: &Results, path: &Path) -> io::Result<()> {
    let mut out = String::from(
        "trial,label,value,seconds,stage,unit,mean,maximum,areaIntegral,coveredKm2,sampledKm2,parameters,error\n",
    );
    for (index, trial) in results.trials.iter().enumerate() {
        let prefix = format!(
            "{},{},{},{:.3}",
            index + 1,
            csv(&trial.label),
            number(trial.value),
            trial.seconds,
        );
        for observation in &trial.observations {
            let metrics = &observation.metrics;
            let _ = writeln!(
                out,
                "{prefix},{},{},{},{},{},{},{},{},",
                csv(&observation.label),
                csv(&observation.unit),
                number(metrics.mean),
                number(metrics.maximum),
                number(metrics.area_integral),
                metrics.covered_km2,
                metrics.sampled_km2,
                csv(&serde_json::to_string(&observation.parameters)?),
            );
        }
        if let Some(error) = &trial.error {
            let _ = writeln!(out, "{prefix},,,,,,,,,{}", csv(error));
        }
    }
    fs::write(path, out)
}

fn number(value: Option<f64>) -> String {
    value.map(|value| value.to_string()).unwrap_or_default()
}

fn xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn range(values: impl Iterator<Item = f64>) -> (f64, f64) {
    let (low, high) = values.fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), value| {
        (low.min(value), high.max(value))
    });
    if low > high {
        return (0., 1.);
    }
    (low, high)
}

fn scaled(value: f64, (low, high): (f64, f64)) -> f64 {
    if low == high {
        0.5
    } else {
        (value - low) / (high - low)
    }
}

fn chart(results: &Results, metric: Metric, logarithmic: bool) -> String {
    let mut points: Vec<_> = results
        .trials
        .iter()
        .enumerate()
        .filter_map(|(index, trial)| {
            let final_state = trial.observations.last()?;
            trial.error.is_none().then(|| {
                (
                    trial.value.unwrap_or(index as f64 + 1.),
                    final_state.metrics.get(metric),
                    index + 1,
                )
            })
        })
        .filter_map(|(x, y, trial)| y.map(|y| (x, y, trial)))
        .collect();
    points.sort_by(|left, right| left.0.total_cmp(&right.0));
    let xbounds = range(points.iter().map(|(x, _, _)| *x));
    let ybounds = range(points.iter().map(|(_, y, _)| *y));
    let x = |value| 104. + 750. * scaled(value, xbounds);
    let y = |value| 321. - 233. * scaled(value, ybounds);
    let height = 443 + results.trials.len() * 20;
    let mut out = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="940" height="{height}" viewBox="0 0 940 {height}">
<rect width="100%" height="100%" fill="#f9fafb"/>
<g font-family="sans-serif" fill="#172234">
<text x="25" y="34" font-size="24">{}</text>
<text x="25" y="60" font-size="15">{} · {}</text>
<path d="M104,88 V321 H854" fill="none" stroke="#8590a0"/>
"##,
        xml(&results.name),
        xml(&results.channel),
        metric.name(),
    );
    for step in 0..=4 {
        let t = f64::from(step) / 4.;
        let at = 321. - t * 233.;
        let value = ybounds.0 * (1. - t) + ybounds.1 * t;
        let _ = writeln!(
            out,
            r##"<path d="M104,{at} H854" stroke="#dfe5eb"/><text x="94" y="{}" text-anchor="end" font-size="12">{value:.5}</text>"##,
            at + 4.
        );
    }
    if !points.is_empty() {
        let line: Vec<_> = points
            .iter()
            .map(|(a, b, _)| format!("{:.2},{:.2}", x(*a), y(*b)))
            .collect();
        let _ = writeln!(
            out,
            r##"<polyline points="{}" fill="none" stroke="#276c91" stroke-width="2"/>"##,
            line.join(" ")
        );
    }
    for (a, b, index) in points {
        let _ = writeln!(
            out,
            r##"<circle cx="{:.2}" cy="{:.2}" r="5" fill="#276c91"><title>Trial {index}: {a} → {b}</title></circle><text x="{:.2}" y="{:.2}" font-size="12">{index}</text>"##,
            x(a),
            y(b),
            x(a) + 7.,
            y(b) - 8.,
        );
    }
    let label = results.parameter.as_deref().unwrap_or("Trial order");
    let _ = writeln!(
        out,
        r#"<text x="479" y="355" text-anchor="middle" font-size="15">{} ({:.5} to {:.5})</text>"#,
        xml(label),
        xbounds.0,
        xbounds.1
    );
    let colors = if logarithmic { "logarithmic" } else { "linear" };
    let _ = writeln!(
        out,
        r#"<text x="25" y="375" font-size="13">Map colours use a shared {colors} scale.</text>"#
    );
    let message = results.error.as_deref().map_or_else(
        || {
            results.bracket.map_or_else(String::new, |[low, high]| {
                format!("Threshold bracket [{low}, {high}]")
            })
        },
        |error| error.chars().take(110).collect(),
    );
    let _ = writeln!(
        out,
        r#"<text x="25" y="395" font-size="14">{}</text>"#,
        xml(&message)
    );
    for (index, trial) in results.trials.iter().enumerate() {
        let status = if trial.error.is_some() {
            " · failed"
        } else {
            ""
        };
        let _ = writeln!(
            out,
            r#"<text x="25" y="{}" font-size="13">{}. {}{status}</text>"#,
            426 + index * 20,
            index + 1,
            xml(&trial.label)
        );
    }
    out.push_str("</g></svg>\n");
    out
}

fn maps(results: &Results, output: &Path, logarithmic: bool) -> io::Result<()> {
    let grids: Vec<_> = results
        .trials
        .iter()
        .map(|trial| {
            trial
                .observations
                .last()
                .filter(|_| trial.error.is_none())
                .map(|o| &o.grid)
        })
        .collect();
    let Some(first) = grids.iter().flatten().next() else {
        return Ok(());
    };
    let scale = |value: f64| {
        if logarithmic {
            value.signum() * value.abs().ln_1p()
        } else {
            value
        }
    };
    let extent = range(
        grids
            .iter()
            .flatten()
            .flat_map(|grid| grid.values.iter().flatten().copied())
            .map(scale),
    );
    let width = u32::try_from(first.width).map_err(io::Error::other)?;
    let height = u32::try_from(first.height).map_err(io::Error::other)?;
    let columns = grids.len().min(4) as u32;
    let rows = u32::try_from(grids.len().div_ceil(columns as usize)).map_err(io::Error::other)?;
    let sheet_width = columns
        .checked_mul(width)
        .ok_or_else(|| io::Error::other("Maps sheet is too wide"))?;
    let sheet_height = rows
        .checked_mul(height)
        .ok_or_else(|| io::Error::other("Maps sheet is too tall"))?;
    let mut sheet = Pixmap::new(sheet_width, sheet_height)
        .ok_or_else(|| io::Error::other("Invalid maps sheet dimensions"))?;
    sheet.fill(super::super::picture::colour("#eaedf2"));
    for (index, grid) in grids.iter().enumerate() {
        let Some(grid) = grid else { continue };
        if grid.bounds != first.bounds || grid.width != first.width || grid.height != first.height {
            return Err(io::Error::other(
                "Comparison maps require a common sampling frame",
            ));
        }
        let image = image(grid, width, height, |value| scaled(scale(value), extent))?;
        sheet.draw_pixmap(
            (index as u32 % columns * width) as i32,
            (index as u32 / columns * height) as i32,
            image.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            None,
        );
    }
    sheet.save_png(output).map_err(io::Error::other)
}

fn image(grid: &Grid, width: u32, height: u32, color: impl Fn(f64) -> f64) -> io::Result<Pixmap> {
    let mut image =
        Pixmap::new(width, height).ok_or_else(|| io::Error::other("Invalid map dimensions"))?;
    if image.pixels().len() != grid.values.len() {
        return Err(io::Error::other(
            "Map samples do not match the sampling frame",
        ));
    }
    for (pixel, value) in image.pixels_mut().iter_mut().zip(&grid.values) {
        if let Some(value) = value {
            let t = color(*value);
            let channel = |low, high| (low + t * (high - low)) as u8;
            *pixel = Color::from_rgba8(
                channel(243., 31.),
                channel(244., 63.),
                channel(229., 113.),
                255,
            )
            .to_color_u8()
            .premultiply();
        }
    }
    Ok(image)
}
