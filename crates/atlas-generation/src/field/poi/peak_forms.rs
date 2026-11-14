//! Peak form selection and local shape arithmetic from peakForms.ts.
#[derive(Clone, Copy)]
pub enum Form {
    Horn,
    Crag,
    Scarred,
    Dome,
    Shattered,
    Table,
}
impl Form {
    pub const ALL: [Self; 6] = [
        Self::Horn,
        Self::Crag,
        Self::Scarred,
        Self::Dome,
        Self::Shattered,
        Self::Table,
    ];
    pub fn id(self) -> &'static str {
        match self {
            Self::Horn => "horn",
            Self::Crag => "crag",
            Self::Scarred => "scarred",
            Self::Dome => "dome",
            Self::Shattered => "shattered",
            Self::Table => "table",
        }
    }
    pub fn term(self) -> &'static str {
        match self {
            Self::Horn => "Horn",
            Self::Crag => "Crag",
            Self::Scarred => "Scar",
            Self::Dome => "Dome",
            Self::Shattered => "Scree",
            Self::Table => "Table",
        }
    }
}
pub struct Readings {
    pub hardness: f64,
    pub fracture: f64,
    pub ice: f64,
    pub cold: f64,
    pub wet: f64,
    pub steep: f64,
    pub bedded: f64,
}
pub fn choose(r: Readings, roll: f64) -> Form {
    let weights = [
        r.ice * (0.4 + r.hardness),
        r.hardness * (1.0 - r.ice) * (0.3 + r.fracture),
        r.steep * r.cold.max(r.ice) * (0.4 + r.wet),
        r.hardness * (1.0 - r.fracture) * (1.0 - r.steep),
        (1.0 - r.hardness) * (0.3 + r.fracture),
        r.bedded * (1.0 - r.ice) * (1.0 - 0.5 * r.wet),
    ]
    .map(|weight| 0.04 + weight.max(0.0));
    let mut left = roll * weights.iter().sum::<f64>();
    for (form, weight) in Form::ALL.into_iter().zip(weights) {
        left -= weight;
        if left < 0.0 {
            return form;
        }
    }
    Form::Table
}
pub struct Shape {
    pub ground: f64,
    pub debris: f64,
    pub bare: bool,
}
fn hold(ground: f64, debris: f64, bare: bool) -> Shape {
    Shape {
        ground,
        debris,
        bare,
    }
}
fn scarred(reach: f64, facing: f64) -> Shape {
    if facing <= 0.0 || reach < 0.15 {
        hold(0.35 * (1.0 - reach), 0.0, reach < 0.15)
    } else if reach < 0.6 {
        hold(-0.6 * facing, 0.0, true)
    } else {
        hold(0.0, 0.35 * facing, false)
    }
}
pub fn shape(form: Form, reach: f64, bearing: f64, face: f64) -> Shape {
    if reach >= 1.0 {
        return hold(0.0, 0.0, false);
    }
    match form {
        Form::Horn => hold(
            (1.0 - reach).powi(2) * (0.75 + 0.25 * (3.0 * (bearing - face)).cos()),
            0.0,
            reach < 0.6,
        ),
        Form::Crag => {
            if reach < 0.25 {
                hold(1.0, 0.0, true)
            } else if reach < 0.45 {
                hold(1.0 - (reach - 0.25) / 0.2, 0.0, true)
            } else {
                hold(0.0, if reach < 0.8 { 0.12 } else { 0.0 }, false)
            }
        }
        Form::Scarred => scarred(reach, (bearing - face).cos()),
        Form::Dome => hold(0.6 * (1.0 - reach * reach).sqrt(), 0.0, reach < 0.4),
        Form::Shattered => hold(
            -0.3 * (std::f64::consts::PI * reach).sin(),
            if reach > 0.5 {
                0.5 * (1.0 - reach) * 2.0
            } else {
                0.0
            },
            reach < 0.5,
        ),
        Form::Table => {
            if reach < 0.5 {
                hold(0.5 + 0.04 * (1.0 - reach), 0.0, true)
            } else if reach < 0.7 {
                hold(0.5 * (1.0 - (reach - 0.5) / 0.2), 0.0, true)
            } else {
                hold(-0.15 * (1.0 - reach) / 0.3, 0.0, false)
            }
        }
    }
}
