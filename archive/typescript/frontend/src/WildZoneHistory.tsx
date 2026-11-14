import { useQuery } from "@tanstack/react-query";
import type { EpochHistory } from "@atlas/domain";
import { atlasWorkspace } from "./atlasWorkspace";
import { ErrorMessage } from "./ErrorMessage";
import type { AtlasFeature, World } from "./types";
import { SurveyHistory } from "./SurveyComparison";

export function WildZoneHistory({ world, feature }: { world: World; feature: AtlasFeature }) {
  return feature.kind === "veil:wild" ? <WildZoneSurveys world={world} feature={feature} /> : null;
}
function WildZoneSurveys({ world, feature }: { world: World; feature: AtlasFeature }) {
  const history = useQuery({
    queryKey: ["field-history", world.id, world.version, feature.areaId],
    queryFn: async () => (await atlasWorkspace()).readCauses(world.id, feature.areaId),
  });
  return (
    <>
      <SurveyHistory feature={feature} observations={surveysOf(history.data ?? [], feature.id)} />
      <ErrorMessage error={history.error} />
    </>
  );
}
function surveysOf(history: EpochHistory[], id: string) {
  return history.flatMap((epoch) =>
    epoch.causes.flatMap((cause) => {
      if (cause.kind !== "geography" || cause.featureKind !== "veil:wild") return [];
      const observation = cause.observations.find((item) => item.id === id);
      return observation
        ? [
            {
              epoch: epoch.ancestry.map((item) => item.id).join(" / "),
              geometry: observation.geometry,
            },
          ]
        : [];
    })
  );
}
