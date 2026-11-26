use super::{habitable, HumanField, LayerId, State, Urban};
use crate::field::shared::Scalar;
use std::io;

#[derive(Default)]
pub(super) struct DistrictGround {
    pub people: f64,
    pub built: f64,
    pub standing: f64,
    pub farm: f64,
    pub ways: f64,
    pub trade: f64,
    pub wet: f64,
    pub trees: f64,
    pub ruins: f64,
}
impl DistrictGround {
    pub fn read(state: &State, urban: &Urban, centre: usize, reach: f64) -> io::Result<Self> {
        let field = state.field();
        let mesh = field.mesh();
        let human = |id| field.people().view(HumanField::Layer(id));
        let (built, standing, farm) = (
            human(LayerId::BuiltUp),
            human(LayerId::Standing),
            human(LayerId::Farmland),
        );
        let ways = field.people().view(HumanField::KeptLine);
        let ruin = field.people().view(HumanField::RuinedBuiltUp);
        let scalar = |id| field.shared().scalar(id);
        let mut g = Self::default();
        let mut area = 0.;
        // Founding centres are separated by at least reach. Their inner neighbourhoods
        // supply neighbourhood averages before the road-based district partition exists.
        for c in mesh.cells_within(mesh.position(centre), 0.5 * reach) {
            if urban.fields.stencil[c] <= 0.5 || !habitable(field, c)? {
                continue;
            }
            let a = mesh.area(c);
            let b = built.get(c)?;
            let wet = (scalar(Scalar::FloodplainIntensity).get(c)? / 1000.)
                .max(scalar(Scalar::WetlandCover).get(c)?);
            let trees = scalar(Scalar::TreeCover).get(c)?;
            let ruins = ruin.get(c)?;
            g.people += a * field.people().people(c)?;
            g.built += a * b;
            g.standing += a * standing.get(c)?;
            g.farm += a * farm.get(c)?;
            g.ways += a * ways.get(c)?.max(0.);
            g.trade += a * field.goods_turnover(c)?.ln_1p();
            g.wet += a * wet;
            g.trees += a * trees;
            g.ruins += a * ruins;
            area += a;
        }
        if area <= 0. {
            return Err(io::Error::other(
                "District founding centre has no habitable ground",
            ));
        }
        for sum in [
            &mut g.people,
            &mut g.built,
            &mut g.standing,
            &mut g.farm,
            &mut g.ways,
            &mut g.trade,
            &mut g.wet,
            &mut g.trees,
            &mut g.ruins,
        ] {
            *sum /= area;
        }
        Ok(g)
    }
}
