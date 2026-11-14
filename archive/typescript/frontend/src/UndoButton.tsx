import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHistory } from "./useAtlas";
import { undoWorkspaceWorld as undoWorld } from "./atlasWorkspace";
import { ErrorMessage } from "./ErrorMessage";
import type { World } from "./types";

export function UndoButton({ world }: { world: World }) {
  const history = useHistory(world),
    cache = useQueryClient();
  const commands = useIsMutating({ mutationKey: ["command", world.id] });
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
        disabled={!history.data?.length || history.isFetching || undo.isPending || commands > 0}
        onClick={() => undo.mutate()}
        title={history.data?.[0]?.kind}
      >
        Undo
      </button>
      <ErrorMessage error={undo.error} />
    </>
  );
}
