use super::boundary::{BoundarySupport, Crossing, Ghost, GhostChannel};
use atlas_map::Bounds;

pub const ROOT_THREE: f64 = 1.7320508075688772;
pub const TRIANGLE_AREA: f64 = 3.0 * ROOT_THREE / 4.0;
const NONE: u32 = u32::MAX;
const GHOST: u32 = 1 << 31;

#[derive(Clone, Copy, Debug)]
pub struct PeriodicFrame {
    pub width: f64,
    pub columns: usize,
    pub closed_poles: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct TriangularFrame {
    pub width: f64,
    pub height: f64,
    pub spacing: f64,
    pub spacing_y: f64,
    pub offset: [f64; 2],
}
#[derive(Clone, Copy)]
pub struct LatticeInput {
    pub bounds: Bounds,
    pub frame: TriangularFrame,
    pub area: f64,
    pub padding: f64,
    pub periodic: Option<PeriodicFrame>,
    pub coordinate_width: Option<f64>,
    pub open_boundary: bool,
}
enum Slot {
    Cell(usize),
    Ghost(usize),
    None,
}

/// Map cells only, numbered in frame-site order. Site arithmetic stays private: a site
/// that is not a map cell is either a ghost of the boundary support or nothing.
// owner-direction(2026-11-16): a map has no outside; cells beyond the bounds are not normally addressable and exist only as boundary support for numerical calculation
pub struct TriangularLattice {
    origin: [f64; 2],
    bounds: Bounds,
    frame: TriangularFrame,
    periodic: Option<PeriodicFrame>,
    chart_width: Option<f64>,
    open_boundary: bool,
    d_min: i32,
    rows: usize,
    columns: usize,
    a_start: [i32; 4],
    /// Map cell to frame site.
    sites: Vec<u32>,
    /// Frame site to map cell, `GHOST | slot`, or `NONE`.
    slots: Vec<u32>,
    cell_area: f64,
    content_radius: f64,
    work_radius: f64,
    support: BoundarySupport,
}

impl TriangularLattice {
    pub fn new(
        input: LatticeInput,
        covers: impl Fn(f64, f64) -> bool,
    ) -> Result<Self, &'static str> {
        Self::classified(input, |points| {
            Ok(points.iter().map(|&[x, y]| covers(x, y)).collect())
        })
    }
    /// Frame sites inside the bounds go to `covers` as one batch of world positions;
    /// covered sites become the map's cells.
    pub fn classified<E: From<&'static str>>(
        input: LatticeInput,
        covers: impl FnOnce(&[[f64; 2]]) -> Result<Vec<bool>, E>,
    ) -> Result<Self, E> {
        input
            .bounds
            .validate()
            .map_err(|_| "Invalid lattice bounds")?;
        Self::validate_frame(&input)?;
        let frame = input.frame;
        let width = input.bounds.2 - input.bounds.0;
        let height = input.bounds.3 - input.bounds.1;
        let closed = input.periodic.is_some_and(|p| p.closed_poles);
        // Sites reach past the frame wherever the map can have an edge, so every missing
        // neighbour of an edge cell is a ghost of the boundary support.
        let reach = TriangularFrame {
            width: frame.width
                + if input.periodic.is_some() {
                    0.0
                } else {
                    6.0 * frame.spacing
                },
            height: frame.height + if closed { 0.0 } else { 4.0 * frame.spacing_y },
            ..frame
        };
        let row = ROOT_THREE * frame.spacing_y / 2.0;
        let d_min = ((-reach.height / 2.0 - frame.offset[1]) / row).ceil() as i32;
        let d_max = ((reach.height / 2.0 - frame.offset[1]) / row).floor() as i32;
        let rows = (i64::from(d_max) - i64::from(d_min) + 1).max(0) as usize;
        let (a_start, columns) = Self::windows(reach, input.periodic);
        let count = rows
            .checked_mul(columns)
            .and_then(|v| v.checked_mul(2))
            .ok_or("Lattice address overflow")?;
        if count >= GHOST as usize {
            return Err("Lattice cell IDs exceed their representation".into());
        }
        let mut lattice = Self {
            origin: [
                (input.bounds.0 + input.bounds.2) / 2.0,
                (input.bounds.1 + input.bounds.3) / 2.0,
            ],
            bounds: Bounds(-width / 2.0, -height / 2.0, width / 2.0, height / 2.0),
            frame,
            periodic: input.periodic,
            chart_width: input.coordinate_width,
            open_boundary: input.open_boundary,
            d_min,
            rows,
            columns,
            a_start,
            sites: Vec::new(),
            slots: vec![NONE; count],
            cell_area: 0.0,
            content_radius: (input.area / std::f64::consts::PI).sqrt(),
            work_radius: (width / 2.0 + input.padding).hypot(height / 2.0 + input.padding),
            support: BoundarySupport::default(),
        };
        lattice.classify(input.area, covers)?;
        Ok(lattice)
    }
    fn validate_frame(input: &LatticeInput) -> Result<(), &'static str> {
        let f = input.frame;
        if ![f.width, f.height, f.spacing, f.spacing_y, input.area]
            .iter()
            .all(|v| v.is_finite() && *v > 0.0)
            || !f.offset.iter().all(|v| v.is_finite())
            || !input.padding.is_finite()
            || input.padding < 0.0
        {
            return Err("Lattice dimensions, area and spacing must be finite and positive");
        }
        if input
            .periodic
            .is_some_and(|p| !p.width.is_finite() || p.width <= 0.0 || p.columns == 0)
            || input
                .coordinate_width
                .is_some_and(|w| !w.is_finite() || w <= 0.0)
        {
            return Err("Periodic coordinates need a positive width and columns");
        }
        Ok(())
    }
    fn windows(frame: TriangularFrame, periodic: Option<PeriodicFrame>) -> ([i32; 4], usize) {
        let mut starts = [0; 4];
        let mut columns = 0;
        for inverted in 0..2 {
            let shift = (1 + inverted) as f64 * frame.spacing + frame.offset[0];
            let low = ((-frame.width / 2.0 - shift) / (1.5 * frame.spacing)).ceil() as i32;
            let high = periodic.map_or_else(
                || ((frame.width / 2.0 - shift) / (1.5 * frame.spacing)).floor() as i64,
                |p| i64::from(low) + 2 * p.columns as i64 - 1,
            );
            for parity in 0..2 {
                let first = low + ((low & 1) ^ parity as i32);
                starts[inverted * 2 + parity] = first;
                columns =
                    columns.max(((high - i64::from(first)).div_euclid(2) + 1).max(0) as usize);
            }
        }
        (starts, columns)
    }
    fn classify<E: From<&'static str>>(
        &mut self,
        area: f64,
        covers: impl FnOnce(&[[f64; 2]]) -> Result<Vec<bool>, E>,
    ) -> Result<(), E> {
        let mut candidates = Vec::new();
        let mut points = Vec::new();
        for site in 0..self.slots.len() {
            let (a, d, i) = self.site_coords(site);
            let [x, y] = self.site_position(a, d, i);
            if x.abs() <= self.bounds.2 && y.abs() <= self.bounds.3 {
                candidates.push(site as u32);
                points.push([x + self.origin[0], y + self.origin[1]]);
            }
        }
        let included = covers(&points)?;
        if included.len() != points.len() {
            return Err("Lattice point coverage returned an incomplete batch".into());
        }
        for (site, inside) in candidates.into_iter().zip(included) {
            if inside {
                self.slots[site as usize] = self.sites.len() as u32;
                self.sites.push(site);
            }
        }
        if !self.sites.is_empty() {
            self.cell_area = area / self.sites.len() as f64;
        }
        self.support = self.boundary_support();
        Ok(())
    }
    /// Every frame site beyond the map becomes a ghost owned by the nearest edge cell in
    /// steps; a closed-pole world has no edge and no ghosts.
    fn boundary_support(&mut self) -> BoundarySupport {
        if self.closed_poles() || self.sites.is_empty() {
            return BoundarySupport::default();
        }
        let mut order = self.ghost_owners();
        order.sort_unstable();
        let mut ghosts = Vec::with_capacity(order.len());
        for (slot, &(owner, site)) in order.iter().enumerate() {
            self.slots[site as usize] = GHOST | slot as u32;
            let (a, d, i) = self.site_coords(site as usize);
            ghosts.push(Ghost {
                position: self.site_position(a, d, i),
                inverted: i == 1,
                owner: owner as usize,
            });
        }
        BoundarySupport::new(self.crossings(), ghosts)
    }
    /// (owner, site) for every frame site beyond the map, spreading outward from the map.
    fn ghost_owners(&self) -> Vec<(u32, u32)> {
        let mut owner = vec![NONE; self.slots.len()];
        for (cell, &site) in self.sites.iter().enumerate() {
            owner[site as usize] = cell as u32;
        }
        let mut queue = self.sites.clone();
        let mut head = 0;
        while head < queue.len() {
            let site = queue[head] as usize;
            head += 1;
            for edge in 0..3 {
                let (a, d, i) = self.site_step(site, edge);
                let Some(next) = self.site_index(a, d, i) else {
                    continue;
                };
                if owner[next] == NONE {
                    owner[next] = owner[site];
                    queue.push(next as u32);
                }
            }
        }
        queue[self.sites.len()..]
            .iter()
            .map(|&site| (owner[site as usize], site))
            .collect()
    }
    fn crossings(&self) -> Vec<Crossing> {
        let mut crossings = Vec::new();
        for cell in 0..self.sites.len() {
            for edge in 0..3 {
                let (a, d, i) = self.step(cell, edge);
                let Some(site) = self.site_index(a, d, i) else {
                    continue;
                };
                if let Slot::Ghost(slot) = self.slot(site) {
                    let [dx, dy] = self.edge_delta(cell, edge);
                    crossings.push(Crossing {
                        cell,
                        edge,
                        slot,
                        position: self.site_position(a, d, i),
                        length: dx.hypot(dy),
                        face: self.face(edge),
                    });
                }
            }
        }
        crossings
    }
    pub fn len(&self) -> usize {
        self.sites.len()
    }
    pub fn is_empty(&self) -> bool {
        self.sites.is_empty()
    }
    pub fn origin(&self) -> [f64; 2] {
        self.origin
    }
    pub fn offset(&self) -> [f64; 2] {
        self.frame.offset
    }
    pub fn bounds(&self) -> Bounds {
        self.bounds
    }
    /// Boundary support: ghosts beyond the map edge, for numerical edge conditions only.
    pub fn support(&self) -> &BoundarySupport {
        &self.support
    }
    /// Ghost values sampled from a parent map; every other channel clamps to the edge.
    pub fn capture_ghosts(
        &mut self,
        channel: GhostChannel,
        values: Vec<f64>,
    ) -> Result<(), &'static str> {
        self.support.capture(channel, values)
    }
    pub fn spacing(&self) -> f64 {
        self.frame.spacing
    }
    pub fn spacing_y(&self) -> f64 {
        self.frame.spacing_y
    }
    pub fn cell_width(&self) -> f64 {
        self.cell_span()
    }
    pub fn cell_height(&self) -> f64 {
        self.cell_span()
    }
    pub fn content_radius(&self) -> f64 {
        self.content_radius
    }
    pub fn work_radius(&self) -> f64 {
        self.work_radius
    }
    pub fn open_boundary(&self) -> bool {
        self.open_boundary
    }
    pub fn inverted(&self, cell: usize) -> bool {
        self.sites[cell] & 1 != 0
    }
    fn slot(&self, site: usize) -> Slot {
        match self.slots[site] {
            NONE => Slot::None,
            slot if slot & GHOST != 0 => Slot::Ghost((slot & !GHOST) as usize),
            cell => Slot::Cell(cell as usize),
        }
    }
    fn site_coords(&self, site: usize) -> (i32, i32, usize) {
        let inverted = site & 1;
        let row = (site / 2) / self.columns;
        let k = (site / 2) % self.columns;
        let d = row as i32 + self.d_min;
        (
            self.a_start[inverted * 2 + (d & 1) as usize] + 2 * k as i32,
            d,
            inverted,
        )
    }
    fn site(&self, cell: usize) -> (i32, i32, usize) {
        self.site_coords(self.sites[cell] as usize)
    }
    fn site_position(&self, a: i32, d: i32, inverted: usize) -> [f64; 2] {
        [
            (1.5 * a as f64 + 1.0 + inverted as f64) * self.frame.spacing + self.frame.offset[0],
            ROOT_THREE * d as f64 * self.frame.spacing_y / 2.0 + self.frame.offset[1],
        ]
    }
    pub fn position(&self, cell: usize) -> [f64; 2] {
        let (a, d, i) = self.site(cell);
        self.site_position(a, d, i)
    }
    pub(crate) fn barycentric(&self, cell: usize, [x, y]: [f64; 2]) -> [f64; 3] {
        let sign = if self.inverted(cell) { -1.0 } else { 1.0 };
        let point = self.position(cell);
        let dx = self.delta_x(x - point[0]) / self.frame.spacing * sign;
        let dy = (y - point[1]) / self.frame.spacing_y;
        [
            (1.0 - 2.0 * dx) / 3.0,
            (1.0 + dx) / 3.0 - dy / ROOT_THREE,
            (1.0 + dx) / 3.0 + dy / ROOT_THREE,
        ]
    }
    pub fn address(&self, cell: usize) -> (i32, i32, bool) {
        let (a, d, i) = self.site(cell);
        ((a - d) / 2, (a + d) / 2, i != 0)
    }
    pub fn address_cell(&self, u: i32, v: i32, inverted: bool) -> Option<usize> {
        let site = self.site_index(u.checked_add(v)?, v.checked_sub(u)?, usize::from(inverted))?;
        match self.slot(site) {
            Slot::Cell(cell) => Some(cell),
            _ => None,
        }
    }
    fn site_index(&self, a: i32, d: i32, inverted: usize) -> Option<usize> {
        let row = i64::from(d) - i64::from(self.d_min);
        if row < 0 || row >= self.rows as i64 || self.columns == 0 {
            return None;
        }
        let window = inverted * 2 + (d & 1) as usize;
        let mut k = (i64::from(a) - i64::from(self.a_start[window])).div_euclid(2);
        if self.periodic.is_some() {
            k = k.rem_euclid(self.columns as i64);
        } else if k < 0 || k >= self.columns as i64 {
            return None;
        }
        Some((row as usize * self.columns + k as usize) * 2 + inverted)
    }
    pub fn area(&self, _cell: usize) -> f64 {
        self.cell_area
    }
    pub fn cell_span(&self) -> f64 {
        TRIANGLE_AREA.sqrt() * self.frame.spacing
    }
    fn site_step(&self, site: usize, edge: usize) -> (i32, i32, usize) {
        assert!(edge < 3);
        let (a, d, i) = self.site_coords(site);
        let direction = if i == 1 { 1 } else { -1 };
        match edge {
            1 => (a + direction, d - direction, i ^ 1),
            2 => (a + direction, d + direction, i ^ 1),
            _ => (a, d, i ^ 1),
        }
    }
    fn step(&self, cell: usize, edge: usize) -> (i32, i32, usize) {
        self.site_step(self.sites[cell] as usize, edge)
    }
    pub fn neighbor(&self, cell: usize, edge: usize) -> Option<usize> {
        let (a, d, i) = self.step(cell, edge);
        match self.slot(self.site_index(a, d, i)?) {
            Slot::Cell(next) => Some(next),
            _ => None,
        }
    }
    pub fn edge_delta(&self, cell: usize, edge: usize) -> [f64; 2] {
        let (a, d, i) = self.step(cell, edge);
        let to = self.site_position(a, d, i);
        let from = self.position(cell);
        [to[0] - from[0], to[1] - from[1]]
    }
    pub fn edge_length(&self, cell: usize, edge: usize) -> f64 {
        if self.neighbor(cell, edge).is_none() {
            return self.frame.spacing;
        }
        let [x, y] = self.edge_delta(cell, edge);
        x.hypot(y)
    }
    /// Pole-crossing neighbors use their physical edge, not distance across the planar chart.
    pub fn physical_distance(&self, cell: usize, next: usize) -> f64 {
        if self.periodic.is_some_and(|frame| frame.closed_poles) {
            if let Some(edge) = (0..3).find(|&edge| self.neighbor(cell, edge) == Some(next)) {
                return self.edge_length(cell, edge);
            }
        }
        let [x, y] = self.position(cell);
        let [nx, ny] = self.position(next);
        self.delta_x(nx - x).hypot(ny - y)
    }
    /// Least-squares physical gradient, weighted by the actual support of each triangular face.
    pub fn gradient(
        &self,
        cell: usize,
        values: &impl Fn(usize) -> std::io::Result<f64>,
    ) -> std::io::Result<[f64; 2]> {
        let (mut xx, mut xy, mut yy, mut vx, mut vy) = (0.0, 0.0, 0.0, 0.0, 0.0);
        let value = values(cell)?;
        let [x, y] = self.position(cell);
        for edge in 0..3 {
            let Some(next) = self.neighbor(cell, edge) else {
                continue;
            };
            let length = self.edge_length(cell, edge);
            let [dx, dy] = if self.closed_poles() {
                self.edge_delta(cell, edge)
            } else {
                let [nx, ny] = self.position(next);
                [self.delta_x(nx - x), ny - y]
            };
            let weight = self.face_length(cell, edge) / length.powi(2);
            let delta = values(next)? - value;
            xx += weight * dx * dx;
            xy += weight * dx * dy;
            yy += weight * dy * dy;
            vx += weight * dx * delta;
            vy += weight * dy * delta;
        }
        let determinant = xx * yy - xy * xy;
        Ok(if determinant <= 0.0 {
            [0.0; 2]
        } else {
            [
                (vx * yy - vy * xy) / determinant,
                (vy * xx - vx * xy) / determinant,
            ]
        })
    }
    pub fn edge_direction(&self, cell: usize, edge: usize) -> [f64; 2] {
        if self.neighbor(cell, edge).is_none() {
            return [0.0, 0.0];
        }
        let [x, y] = self.edge_delta(cell, edge);
        let length = x.hypot(y);
        [x / length, y / length]
    }
    fn face(&self, edge: usize) -> f64 {
        if edge == 0 {
            ROOT_THREE * self.frame.spacing_y
        } else {
            (1.5 * self.frame.spacing).hypot(ROOT_THREE * self.frame.spacing_y / 2.0)
        }
    }
    pub fn face_length(&self, cell: usize, edge: usize) -> f64 {
        if self.neighbor(cell, edge).is_none() {
            return if self.closed_poles() {
                0.0
            } else {
                ROOT_THREE * self.frame.spacing
            };
        }
        self.face(edge)
    }
    pub fn physical_face(&self, cell: usize, edge: usize) -> Option<([f64; 2], [f64; 2], f64)> {
        let next = self.neighbor(cell, edge)?;
        let at = self.position(cell);
        let beside = self.position(next);
        let normal = self.edge_direction(cell, edge);
        let center = if self.closed_poles() {
            let distance = self.edge_length(cell, edge) / 2.0;
            [at[0] + normal[0] * distance, at[1] + normal[1] * distance]
        } else {
            [
                at[0] + self.delta_x(beside[0] - at[0]) / 2.0,
                (at[1] + beside[1]) / 2.0,
            ]
        };
        Some((center, normal, self.face_length(cell, edge)))
    }
    pub fn cell_travel(&self, cell: usize, [dx, dy]: [f64; 2]) -> f64 {
        let length = dx.hypot(dy);
        if length == 0.0 {
            return self.area(cell).sqrt();
        }
        let x = if dx == 0.0 {
            f64::INFINITY
        } else {
            self.cell_width() * length / dx.abs()
        };
        let y = if dy == 0.0 {
            f64::INFINITY
        } else {
            self.cell_height() * length / dy.abs()
        };
        x.min(y)
    }
    /// A map cell on the map edge: at least one of its faces has no map cell beyond it.
    pub fn boundary(&self, cell: usize) -> bool {
        !self.closed_poles() && (0..3).any(|edge| self.neighbor(cell, edge).is_none())
    }
    pub fn closed_poles(&self) -> bool {
        self.periodic.is_some_and(|p| p.closed_poles)
    }
    pub fn coordinate_width(&self) -> Option<f64> {
        self.chart_width.or(self.periodic.map(|p| p.width))
    }
    pub fn periodic_width(&self) -> Option<f64> {
        self.periodic.map(|frame| frame.width)
    }
    pub fn delta_x(&self, dx: f64) -> f64 {
        self.coordinate_width()
            .map_or(dx, |w| dx - (dx / w + 0.5).floor() * w)
    }
    pub fn point(&self, x: f64, mut y: f64) -> [f64; 2] {
        if self.closed_poles() {
            let height = self.bounds.3 - self.bounds.1;
            let band = ((y + height / 2.0) / height).floor();
            let phase = (y + height / 2.0) / height - band;
            y = if band.rem_euclid(2.0) != 0.0 {
                height / 2.0 - phase * height
            } else {
                -height / 2.0 + phase * height
            };
        }
        [
            self.coordinate_width()
                .map_or(x, |w| (x + w / 2.0).rem_euclid(w) - w / 2.0),
            y,
        ]
    }
    pub fn identity(&self, cell: usize) -> i32 {
        let (u, v, i) = self.address(cell);
        u.wrapping_mul(73856093) ^ v.wrapping_mul(19349663) ^ if i { 83492791 } else { 0 }
    }
    fn candidate(&self, x: f64, y: f64, inverted: usize) -> Option<usize> {
        let sum = (x - (1 + inverted) as f64) / 1.5;
        let difference = 2.0 * y / ROOT_THREE;
        let u = (sum - difference) / 2.0;
        let v = (sum + difference) / 2.0;
        let w = -u - v;
        let (mut a, mut b, c) = (u.round(), v.round(), w.round());
        let (du, dv, dw) = ((a - u).abs(), (b - v).abs(), (c - w).abs());
        if du > dv && du > dw {
            a = -b - c;
        } else if dv > dw {
            b = -a - c;
        }
        let (u, v) = (a as i32, b as i32);
        self.site_index(u.checked_add(v)?, v.checked_sub(u)?, inverted)
    }
    /// The frame site whose triangle holds a lattice-local point, when both parities exist.
    fn nearest_site(&self, x: f64, y: f64) -> Option<usize> {
        let lx = (x - self.frame.offset[0]) / self.frame.spacing;
        let ly = (y - self.frame.offset[1]) / self.frame.spacing_y;
        let (a, b) = (self.candidate(lx, ly, 0)?, self.candidate(lx, ly, 1)?);
        Some(
            if self.site_distance(a, x, y) <= self.site_distance(b, x, y) {
                a
            } else {
                b
            },
        )
    }
    fn site_distance(&self, site: usize, x: f64, y: f64) -> f64 {
        let (a, d, i) = self.site_coords(site);
        let p = self.site_position(a, d, i);
        self.delta_x(p[0] - x).powi(2) + (p[1] - y).powi(2)
    }
    fn within_bounds(&self, x: f64, y: f64) -> bool {
        x.abs() <= self.bounds.2 && y.abs() <= self.bounds.3
    }
    /// The map cell holding a lattice-local point; `None` beyond the map. A point inside the
    /// bounds but past the outermost centroids belongs to the nearest map cell within two
    /// spacings, the discretization of the map's edge.
    pub fn cell_at(&self, x: f64, y: f64) -> Option<usize> {
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        let [x, y] = self.point(x, y);
        if let Some(Slot::Cell(cell)) = self.nearest_site(x, y).map(|site| self.slot(site)) {
            return Some(cell);
        }
        if !self.within_bounds(x, y) {
            return None;
        }
        let reach = 2.0 * self.frame.spacing.max(self.frame.spacing_y);
        self.boundary_cell(x, y)
            .filter(|&cell| self.distance(cell, x, y) <= reach * reach)
    }
    /// The map cells whose centres lie within `radius` of a lattice-local point. Frame sites
    /// are read row by row across the point's bounding box, so the cost follows the box,
    /// not the map. The point itself may lie off the map.
    pub fn cells_within(&self, [x, y]: [f64; 2], radius: f64) -> Vec<usize> {
        let mut found = Vec::new();
        if radius.is_nan() || radius <= 0.0 || self.columns == 0 {
            return found;
        }
        match self.coordinate_width().filter(|_| self.periodic.is_none()) {
            // A frame in a cylindrical chart that does not wrap itself can still reach
            // across the chart seam, where distances wrap.
            Some(width) => {
                for image in [x - width, x, x + width] {
                    self.scan([image, y], [x, y], radius, &mut found);
                }
                found.sort_unstable();
                found.dedup();
            }
            None => self.scan([x, y], [x, y], radius, &mut found),
        }
        found
    }
    /// Sites in the box around `image`, kept when within `radius` of `centre`.
    fn scan(&self, [x, y]: [f64; 2], centre: [f64; 2], radius: f64, found: &mut Vec<usize>) {
        let row = ROOT_THREE * self.frame.spacing_y / 2.0;
        let row_of = |v: f64| (v - self.frame.offset[1]) / row;
        let first = (row_of(y - radius).ceil() as i64).max(i64::from(self.d_min));
        let last =
            (row_of(y + radius).floor() as i64).min(i64::from(self.d_min) + self.rows as i64 - 1);
        for d in first..=last {
            let d = d as i32;
            for inverted in 0..2 {
                for k in self.columns_within(d, inverted, x, radius) {
                    let a = self.a_start[inverted * 2 + (d & 1) as usize] + 2 * k as i32;
                    let Some(Slot::Cell(cell)) =
                        self.site_index(a, d, inverted).map(|site| self.slot(site))
                    else {
                        continue;
                    };
                    let [px, py] = self.position(cell);
                    if self.delta_x(px - centre[0]).hypot(py - centre[1]) < radius {
                        found.push(cell);
                    }
                }
            }
        }
    }
    /// Column indices of one row and parity whose site x lies within `x ± radius`.
    fn columns_within(
        &self,
        d: i32,
        inverted: usize,
        x: f64,
        radius: f64,
    ) -> std::ops::RangeInclusive<i64> {
        let start = f64::from(self.a_start[inverted * 2 + (d & 1) as usize]);
        let shift = (1 + inverted) as f64 * self.frame.spacing + self.frame.offset[0];
        let column = |v: f64| ((v - shift) / (1.5 * self.frame.spacing) - start) / 2.0;
        let low = column(x - radius).ceil() as i64;
        let high = column(x + radius).floor() as i64;
        if self.periodic.is_some() {
            // Columns wrap; start within one turn and never visit a column twice.
            let first = low.rem_euclid(self.columns as i64);
            first..=first + high.saturating_sub(low).min(self.columns as i64 - 1)
        } else {
            low.max(0)..=high.min(self.columns as i64 - 1)
        }
    }
    /// Boundary support: the map cell a point's value clamps to. A point on the map gives its
    /// own cell; a point beyond it gives the edge cell owning the nearest frame position.
    pub fn edge_cell(&self, x: f64, y: f64) -> Option<usize> {
        if let Some(cell) = self.cell_at(x, y) {
            return Some(cell);
        }
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        let [x, y] = self.point(x, y);
        let x = x.clamp(-self.frame.width / 2.0, self.frame.width / 2.0);
        let y = y.clamp(-self.frame.height / 2.0, self.frame.height / 2.0);
        match self.nearest_site(x, y).map(|site| self.slot(site)) {
            Some(Slot::Cell(cell)) => Some(cell),
            Some(Slot::Ghost(slot)) => Some(self.support.ghosts()[slot].owner),
            _ => self.boundary_cell(x, y),
        }
    }
    fn distance(&self, cell: usize, x: f64, y: f64) -> f64 {
        let p = self.position(cell);
        self.delta_x(p[0] - x).powi(2) + (p[1] - y).powi(2)
    }
    fn boundary_cell(&self, x: f64, y: f64) -> Option<usize> {
        let lattice = [
            (x - self.frame.offset[0]) / self.frame.spacing,
            (y - self.frame.offset[1]) / self.frame.spacing_y,
        ];
        let mut best = f64::INFINITY;
        let mut index = None;
        for inverted in 0..2 {
            let sum = (lattice[0] - (1 + inverted) as f64) / 1.5;
            let diff = 2.0 * lattice[1] / ROOT_THREE;
            let u = ((sum - diff) / 2.0).round() as i32;
            let v = ((sum + diff) / 2.0).round() as i32;
            for du in -2..=2 {
                for dv in -2..=2 {
                    if let Some(cell) =
                        self.address_cell(u.saturating_add(du), v.saturating_add(dv), inverted == 1)
                    {
                        let distance = self.distance(cell, x, y);
                        if distance < best {
                            best = distance;
                            index = Some(cell);
                        }
                    }
                }
            }
        }
        index
    }
}
