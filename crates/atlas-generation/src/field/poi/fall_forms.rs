#[derive(Clone, Copy)]
pub enum Form {
    Plunge,
    Cataract,
    Cascade,
    Ribbon,
    Chute,
}
const FORMS: [Form; 5] = [
    Form::Plunge,
    Form::Cataract,
    Form::Cascade,
    Form::Ribbon,
    Form::Chute,
];
pub struct Readings {
    pub hardness: f64,
    pub fracture: f64,
    pub tall: f64,
    pub broad: f64,
}
pub struct Shape {
    pub banks: &'static [f64],
    pub debris: f64,
    pub scoured: bool,
    pub broad_lip: bool,
}
impl Form {
    pub fn name(self) -> &'static str {
        match self {
            Self::Plunge => "plunge",
            Self::Cataract => "cataract",
            Self::Cascade => "cascade",
            Self::Ribbon => "ribbon",
            Self::Chute => "chute",
        }
    }
    pub fn named(name: &str) -> Option<Self> {
        FORMS.into_iter().find(|form| form.name() == name)
    }
    pub fn shape(self) -> Shape {
        match self {
            Self::Plunge => Shape {
                banks: &[1.0, 0.9, 0.6, 0.3],
                debris: 0.0,
                scoured: true,
                broad_lip: false,
            },
            Self::Cataract => Shape {
                banks: &[0.0, 0.5, 0.25],
                debris: 0.0,
                scoured: true,
                broad_lip: true,
            },
            Self::Cascade => Shape {
                banks: &[0.6, 0.4, 0.2],
                debris: 0.05,
                scoured: false,
                broad_lip: false,
            },
            Self::Ribbon => Shape {
                banks: &[1.0, 1.0],
                debris: 0.0,
                scoured: false,
                broad_lip: false,
            },
            Self::Chute => Shape {
                banks: &[1.0, 0.8, 0.4],
                debris: 0.0,
                scoured: true,
                broad_lip: false,
            },
        }
    }
}
pub fn choose(r: &Readings, roll: f64) -> Form {
    let each = [
        r.hardness * (1.0 - r.fracture) * (0.3 + r.tall),
        r.broad * (0.4 + r.hardness),
        (0.2 + r.fracture) * (1.0 - r.tall) * (1.0 - 0.5 * r.broad),
        r.tall * (1.0 - r.broad),
        r.hardness * (1.0 - r.broad) * (1.0 - r.tall),
    ]
    .map(|weight| 0.04 + weight.max(0.0));
    let mut left = roll * each.iter().sum::<f64>();
    for (form, weight) in FORMS.into_iter().zip(each) {
        left -= weight;
        if left < 0.0 {
            return form;
        }
    }
    Form::Chute
}
