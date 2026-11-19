use super::State;
use crate::{
    features::{detail::Scope, publication::Named, Feature, FeatureWorkspace},
    field::{
        poi::{
            self,
            kinds::AreaKind,
            values::{HostLink, Moment},
        },
        refinement::causes::{self, Schedule},
    },
};
use std::{io, rc::Rc};

pub(super) fn catalogue(
    settlement: Schedule<State>,
) -> io::Result<poi::catalogue::Catalogue<State, Schedule<State>>> {
    poi::registered::catalogue(
        poi::community_records::CommunityPublication(Rc::new(|state: &mut State, place| {
            poi::community_records::community_record(
                state.regional.is_some(),
                place,
                state.records.features.as_mut(),
                &Scope {
                    world: state.scope.world,
                    owns_map_geography: state.scope.owns_map_geography,
                    is_descendant: &|child, ancestor| state.scope.is_descendant(child, ancestor),
                },
            )
        })),
        settlement,
        causes::lake,
        causes::dam,
    )
}
impl poi::publication::PublicationState<Schedule<Self>> for State {
    fn features_mut(&mut self) -> &mut dyn FeatureWorkspace {
        self.records.features.as_mut()
    }
    fn link_on(&self, kind: AreaKind, cell: usize) -> io::Result<Option<HostLink>> {
        poi::area_hosting::link_on(self, kind, cell)
    }
    fn retained_name(&self, feature: atlas_map::Id) -> bool {
        self.records.retained_names.contains_key(&feature)
    }
    fn name_feature(&self, feature: &Feature) -> io::Result<Option<Named>> {
        self.naming.feature(&self.scope, feature)
    }
    fn contracted(&self, feature: atlas_map::Id) -> bool {
        self.scope.contracted.contains(&feature)
    }
}
impl poi::wild_history::WildHistory for State {
    fn latest_wild_observation(&self) -> &[poi::wild_history::Observation] {
        poi::wild_history::latest(&self.history, &self.causes)
    }
}
impl State {
    pub fn write_network(&mut self, feature: Feature) -> io::Result<()> {
        use crate::features::{chart::Chart, generated::Publisher};
        let contracted = self.scope.contracted.contains(&feature.id);
        Publisher {
            world: self.scope.world,
            area: self.scope.area,
            space: Some(self.scope.space),
            owns_map_geography: self.scope.owns_map_geography,
            chart: Chart {
                domain: &self.scope.domain,
                bounds: self.scope.domain_bounds,
                cylindrical: self.scope.cylindrical,
            },
            precision: self.scope.precision,
        }
        .network(
            self.records.features.as_mut(),
            self.records.networks.as_mut(),
            feature,
            contracted,
        )
    }
    pub fn publish_ways(
        &mut self,
        highways: usize,
        progress: impl FnMut(f64, &str),
    ) -> io::Result<()> {
        use crate::{
            features::{chart::Chart, generated::Publisher},
            field::people::ways,
        };
        let drawn = ways::records(
            self,
            &ways::Options {
                highways,
                space: Some(self.scope.space),
                owns_map_geography: self.scope.owns_map_geography,
            },
            progress,
        )?;
        let publisher = Publisher {
            world: self.scope.world,
            area: self.scope.area,
            space: Some(self.scope.space),
            owns_map_geography: self.scope.owns_map_geography,
            chart: Chart {
                domain: &self.scope.domain,
                bounds: self.scope.domain_bounds,
                cylindrical: self.scope.cylindrical,
            },
            precision: self.scope.precision,
        };
        let writer = ways::Writer {
            publisher,
            spatial: self.spatial.as_ref(),
            regional: self.regional.is_some(),
        };
        for way in drawn {
            let contracted = self.scope.contracted.contains(&way.feature.id);
            writer.write(
                self.records.features.as_mut(),
                self.records.networks.as_mut(),
                way,
                contracted,
            )?;
        }
        Ok(())
    }
    // Arconis: docs/architecture/subsystems.arconis#item=pp_publish — publishes places and their ways: roads, tracks, lanes.
    pub fn publish_places(
        &mut self,
        publication: &mut poi::publication::Publication,
        moment: Moment,
    ) -> io::Result<()> {
        let catalogue = self.catalogue.clone();
        publication.kinds(self, &catalogue, moment, |_| true)
    }
    pub fn carry_places(
        &mut self,
        publication: &mut poi::publication::Publication,
        outcomes: &mut poi::carry::Outcomes,
    ) -> io::Result<()> {
        let catalogue = self.catalogue.clone();
        poi::carry::carry_places(self, &catalogue, publication, outcomes)
    }
}
