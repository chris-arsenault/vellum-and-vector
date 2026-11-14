//! Bed intake and supply withdrawal, in the units used by water/channelLoss.ts.
pub fn channel_width(flow: f64) -> f64 {
    4.7 * flow.max(0.0).sqrt()
}
pub fn bed_loss(flow: f64, leak: f64, length: f64) -> f64 {
    if flow <= 0.0 || leak <= 0.0 || length <= 0.0 {
        return 0.0;
    }
    flow.min(leak * channel_width(flow) * length)
}
pub fn bed_leak(open_bed: f64, permeability: f64, filled: f64) -> f64 {
    open_bed.max(0.0) * permeability.clamp(0.0, 1.0) * (1.0 - filled.clamp(0.0, 1.0))
}
pub fn passing_water(received: f64, withdrawal: f64, transmission: f64) -> f64 {
    (received - withdrawal.max(0.0)).max(0.0) * transmission.clamp(0.0, 1.0)
}
