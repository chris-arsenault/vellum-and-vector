import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { subscribe } from "./workspaceEvents";
import { workspaceQueryAffected } from "./workspaceInvalidation";
import "ol/ol.css";
import "./styles.css";
import "./cartography.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 500 } } });
const unsubscribe = subscribe((change) => {
  void client.invalidateQueries(
    typeof change === "object"
      ? { predicate: (query) => workspaceQueryAffected(query.queryKey, change) }
      : change === "world"
        ? {}
        : { queryKey: [change] }
  );
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>
);
