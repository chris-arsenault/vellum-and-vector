import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHistory } from "./useAtlas";
import { undoWorld } from "./atlasState";
import { ErrorMessage } from "./ErrorMessage";
import type { World } from "./types";

export function UndoButton({ world }: { world: World }) {
  const history = useHistory(world.id),
    cache = useQueryClient();
  const undo = useMutation({
    mutationFn: async () => undoWorld(world.id, history.data![0].operationId),
    onSuccess: (result) => {
      cache.setQueryData(["world", world.id], result);
      void cache.invalidateQueries({ queryKey: ["history", world.id] });
    },
  });
  return (
    <>
      <button
        className="quiet"
        disabled={!history.data?.length || undo.isPending}
        onClick={() => undo.mutate()}
        title={history.data?.[0]?.kind}
      >
        Undo
      </button>
      <ErrorMessage error={undo.error} />
    </>
  );
}
