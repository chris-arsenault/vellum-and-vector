use crate::scale::{LengthUnit, MapScale};
pub fn round(value: f64) -> String {
    if !value.is_finite() {
        return value.to_string();
    }
    if value == 0.0 {
        return "0".into();
    }
    let decimals = 2 - value.abs().log10().floor() as i32;
    let factor = 10.0f64.powi(decimals);
    let rounded = (value * factor).round() / factor;
    let text = format!("{:.*}", decimals.max(0) as usize, rounded);
    let (integer, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let mut grouped = String::new();
    for (index, character) in integer.chars().enumerate() {
        if index > 0
            && character.is_ascii_digit()
            && (integer.len() - index).is_multiple_of(3)
            && integer.as_bytes()[index - 1].is_ascii_digit()
        {
            grouped.push(',');
        }
        grouped.push(character);
    }
    let fraction = fraction.trim_end_matches('0');
    if !fraction.is_empty() {
        grouped.push('.');
        grouped.push_str(fraction);
    }
    grouped
}
pub fn percent(value: f64) -> String {
    format!("{}%", round(value * 100.0))
}
pub fn metres(value: f64) -> String {
    let metres = MapScale::metres(value, LengthUnit::Native);
    if metres >= 1000.0 {
        format!("{} km", round(metres / 1000.0))
    } else {
        format!("{} m", round(metres))
    }
}
