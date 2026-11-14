//! Detached contact slabs and mixing; canonical cells remain in owned typed bands.
use super::cargo::{blend, CargoMixture, MaterialCargo};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MaterialLayer {
    pub kind: usize,
    pub depth: f64,
    pub secondary_kind: usize,
    pub secondary_share: f64,
    pub strength: f64,
    pub damage: f64,
    pub grain_x: f64,
    pub grain_y: f64,
    /// Signed dz/dx and dz/dy, distinct from axial fabric.
    pub bed_slope_x: f64,
    pub bed_slope_y: f64,
    pub deposited: f64,
    pub consolidation: f64,
    pub formed_min: f64,
    pub formed_max: f64,
    pub altered: f64,
    pub mixed: f64,
    pub cargo: Option<MaterialCargo>,
}
impl MaterialLayer {
    pub fn interaction(&self) -> super::MaterialResponse {
        super::MaterialResponse {
            kind: self.kind,
            secondary_kind: self.secondary_kind,
            secondary_share: self.secondary_share,
            strength: self.strength,
            consolidation: self.consolidation,
            damage: self.damage,
            grain: [self.grain_x, self.grain_y],
            bed_slope: [self.bed_slope_x, self.bed_slope_y],
        }
    }
    /// Defaults come from the catalogue owner; no second catalogue is embedded in layers.
    pub fn new(kind: usize, depth: f64, resistance: f64, loose: bool, epoch: f64) -> Self {
        Self {
            kind,
            depth,
            secondary_kind: kind,
            secondary_share: 0.0,
            strength: resistance,
            damage: 0.0,
            grain_x: 0.0,
            grain_y: 0.0,
            bed_slope_x: 0.0,
            bed_slope_y: 0.0,
            deposited: epoch,
            consolidation: if loose { 0.0 } else { 1.0 },
            formed_min: epoch,
            formed_max: epoch,
            altered: epoch,
            mixed: 0.0,
            cargo: None,
        }
    }
    pub fn material_strength(&self, loose: bool, loose_strength: f64) -> f64 {
        let aggregate = self.strength.min(loose_strength);
        if loose {
            aggregate
        } else {
            aggregate + (self.strength - aggregate) * self.consolidation
        }
    }
    pub fn finite_slice(&self, depth: f64, basement: bool, offset: f64) -> Self {
        let mut result = self.clone();
        result.depth = depth;
        result.cargo = self
            .cargo
            .as_ref()
            .and_then(|cargo| cargo.finite_slice(self.depth, depth, basement, offset));
        result
    }
}

fn cargo_hosts(
    cargo: Option<MaterialCargo>,
    kind: usize,
    secondary: usize,
) -> Option<MaterialCargo> {
    let kind =
        i32::try_from(kind).expect("Catalogue material codes fit the cargo host representation");
    let secondary = i32::try_from(secondary)
        .expect("Catalogue material codes fit the cargo host representation");
    cargo.and_then(|cargo| cargo.aggregate_hosts(kind, secondary))
}

/// Explicit contribution depths avoid copying a material merely to change its mixing weight.
pub fn blend_layers(
    a: &MaterialLayer,
    b: &MaterialLayer,
    a_depth: f64,
    b_depth: f64,
) -> MaterialLayer {
    let (kind, secondary_kind, secondary_share) = components(a, b, a_depth, b_depth);
    let depth = a_depth + b_depth;
    let share = if depth > 0.0 { b_depth / depth } else { 0.0 };
    let interpolate = |a: f64, b: f64| a + (b - a) * share;
    MaterialLayer {
        kind,
        secondary_kind,
        secondary_share,
        depth,
        strength: interpolate(a.strength, b.strength),
        damage: interpolate(a.damage, b.damage),
        grain_x: interpolate(a.grain_x, b.grain_x),
        grain_y: interpolate(a.grain_y, b.grain_y),
        bed_slope_x: interpolate(a.bed_slope_x, b.bed_slope_x),
        bed_slope_y: interpolate(a.bed_slope_y, b.bed_slope_y),
        consolidation: interpolate(a.consolidation, b.consolidation),
        deposited: a.deposited.max(b.deposited),
        formed_min: a.formed_min.min(b.formed_min),
        formed_max: a.formed_max.max(b.formed_max),
        altered: a.altered.max(b.altered),
        mixed: 1.0,
        cargo: cargo_hosts(
            blend(a.cargo.as_ref(), b.cargo.as_ref(), a_depth, b_depth),
            kind,
            secondary_kind,
        ),
    }
}

fn components(
    a: &MaterialLayer,
    b: &MaterialLayer,
    a_depth: f64,
    b_depth: f64,
) -> (usize, usize, f64) {
    let codes = [a.kind, a.secondary_kind, b.kind, b.secondary_kind];
    let mut weights = [
        a_depth * (1.0 - a.secondary_share),
        a_depth * a.secondary_share,
        b_depth * (1.0 - b.secondary_share),
        b_depth * b.secondary_share,
    ];
    for i in 0..4 {
        for j in i + 1..4 {
            if codes[i] == codes[j] {
                weights[i] += weights[j];
                weights[j] = 0.0;
            }
        }
    }
    let first = (1..4).fold(0, |first, i| {
        if weights[i] > weights[first] {
            i
        } else {
            first
        }
    });
    let second = (0..4)
        .filter(|i| *i != first)
        .reduce(|second, i| {
            if weights[i] > weights[second] {
                i
            } else {
                second
            }
        })
        .expect("Four constituent candidates");
    let kept = weights[first] + weights[second];
    (
        codes[first],
        codes[second],
        if kept > 0.0 {
            weights[second] / kept
        } else {
            0.0
        },
    )
}

/// One transient contact slab retains all constituent weights until its two-kind projection.
pub struct MaterialMixture {
    cargo: CargoMixture,
    weights: Vec<f64>,
    kinds: Vec<usize>,
    count: usize,
    weight: f64,
    sums: [f64; 7],
    deposited: f64,
    formed_min: f64,
    formed_max: f64,
    altered: f64,
    mixed: f64,
}
impl MaterialMixture {
    pub fn new(kind_count: usize) -> Self {
        Self {
            cargo: CargoMixture::default(),
            weights: vec![0.0; kind_count],
            kinds: Vec::new(),
            count: 0,
            weight: 0.0,
            sums: [0.0; 7],
            deposited: f64::NEG_INFINITY,
            formed_min: f64::INFINITY,
            formed_max: f64::NEG_INFINITY,
            altered: f64::NEG_INFINITY,
            mixed: 0.0,
        }
    }
    pub fn reset(&mut self) {
        self.cargo.clear();
        for kind in self.kinds.drain(..) {
            self.weights[kind] = 0.0;
        }
        self.count = 0;
        self.weight = 0.0;
        self.sums.fill(0.0);
        self.deposited = f64::NEG_INFINITY;
        self.formed_min = f64::INFINITY;
        self.formed_max = f64::NEG_INFINITY;
        self.altered = f64::NEG_INFINITY;
        self.mixed = 0.0;
    }
    fn constituent(&mut self, kind: usize, weight: f64) {
        if weight <= 0.0 {
            return;
        }
        if self.weights[kind] == 0.0 {
            self.kinds.push(kind);
        }
        self.weights[kind] += weight;
    }
    pub fn add(&mut self, layer: &MaterialLayer, weight: f64) -> Result<(), &'static str> {
        if weight <= 0.0 {
            return Ok(());
        }
        if layer.kind >= self.weights.len() || layer.secondary_kind >= self.weights.len() {
            return Err("Material constituents must resolve in the owning catalogue");
        }
        self.constituent(layer.kind, weight * (1.0 - layer.secondary_share));
        self.constituent(layer.secondary_kind, weight * layer.secondary_share);
        self.count += 1;
        self.weight += weight;
        self.cargo.add(layer.cargo.as_ref(), weight);
        let values = [
            layer.strength,
            layer.damage,
            layer.grain_x,
            layer.grain_y,
            layer.bed_slope_x,
            layer.bed_slope_y,
            layer.consolidation,
        ];
        for (sum, value) in self.sums.iter_mut().zip(values) {
            *sum += value * weight;
        }
        self.deposited = self.deposited.max(layer.deposited);
        self.formed_min = self.formed_min.min(layer.formed_min);
        self.formed_max = self.formed_max.max(layer.formed_max);
        self.altered = self.altered.max(layer.altered);
        self.mixed = self.mixed.max(layer.mixed);
        Ok(())
    }
    fn constituents(&self) -> (usize, usize, f64) {
        let mut first = self.kinds[0];
        let mut second = first;
        for &kind in &self.kinds[1..] {
            if self.weights[kind] > self.weights[first] {
                second = first;
                first = kind;
            } else if second == first || self.weights[kind] > self.weights[second] {
                second = kind;
            }
        }
        let secondary = if second == first {
            0.0
        } else {
            self.weights[second]
        };
        (first, second, secondary / (self.weights[first] + secondary))
    }
    pub fn material(&self, depth: f64) -> Option<MaterialLayer> {
        if self.weight <= 0.0 {
            return None;
        }
        let (kind, secondary_kind, secondary_share) = self.constituents();
        let [strength, damage, grain_x, grain_y, bed_slope_x, bed_slope_y, consolidation] =
            self.sums.map(|value| value / self.weight);
        Some(MaterialLayer {
            kind,
            secondary_kind,
            secondary_share,
            depth,
            strength,
            damage,
            grain_x,
            grain_y,
            bed_slope_x,
            bed_slope_y,
            consolidation,
            deposited: self.deposited,
            formed_min: self.formed_min,
            formed_max: self.formed_max,
            altered: self.altered,
            mixed: if self.count > 1 { 1.0 } else { self.mixed },
            cargo: cargo_hosts(self.cargo.finish(self.weight), kind, secondary_kind),
        })
    }
}
