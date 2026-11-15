import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MapRef } from "@atlas/map";
import { FinishedMapEditor } from "../src/FinishedMapEditor";
import { openFinishedAtlas } from "../src/finishedAtlasContext";
import "../src/styles.css";

/** Exercise server-mode view autosave with the supplied catalog and the real library contract. */
export async function openServerSaveFixture(reference: MapRef) {
  const context = await openFinishedAtlas("browser");
  const map = await context.maps.open(reference);
  const saved = await context.library.open(reference.mapId);
  const cache = new QueryClient();
  cache.setQueryData(["map-navigation", reference], saved.navigation);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const unexpected = () => {
    throw new Error("This supplied-map scenario observes view autosave only.");
  };
  root.render(
    <QueryClientProvider client={cache}>
      <FinishedMapEditor
        context={{ ...context, mode: "backend" }}
        map={map}
        saved={saved}
        open={unexpected}
        create={unexpected}
        lore={unexpected}
        library={unexpected}
        refine={unexpected}
        regenerate={unexpected}
      />
    </QueryClientProvider>
  );
  window.addEventListener(
    "pagehide",
    () => {
      root.unmount();
      cache.clear();
      void context.dispose();
    },
    { once: true }
  );
  window.savedFixtureView = () => context.library.open(reference.mapId);
}
