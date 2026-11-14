import type { AtlasFeature, World } from "@atlas/domain";
import { useQuery } from "@tanstack/react-query";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";
import type { EditorState } from "./useEditor";
import { SettlementDetails, type FeatureSelector } from "./SettlementDetails";
export type { FeatureSelector } from "./SettlementDetails";

export function SettlementSurface({
  world,
  feature,
  areaId,
  editor,
}: {
  world: World;
  feature: AtlasFeature;
  areaId: string;
  editor: EditorState;
}) {
  const inspection = useQuery({
    queryKey: ["settlement", world.id, world.version, areaId, feature.id],
    queryFn: async () =>
      (await atlasWorkspace()).readSettlement(workspaceScope(world, areaId), feature.id),
  });
  if (inspection.isPending) return <p role="status">Reading settlement…</p>;
  if (inspection.error) return <p role="alert">{inspection.error.message}</p>;
  const related = inspection.data?.related ?? [];
  const select: FeatureSelector = (match) => {
    const found = editor.scene.data?.find(match) ?? related.find(match);
    return found
      ? () => {
          if (found.areaId !== editor.area.id) editor.enter(found.areaId);
          editor.setSelected(found);
        }
      : undefined;
  };
  const polityId = String(feature.attributes.polityId ?? "");
  const character = world.entities[polityId]?.attributes.character as
    { people?: number; places?: number } | undefined;
  return (
    <SettlementDetails
      names={world.entities}
      feature={feature}
      related={related}
      select={select}
      protected={feature.protected}
      realm={
        character
          ? { people: Number(character.people ?? 0), places: Number(character.places ?? 0) }
          : undefined
      }
    />
  );
}
