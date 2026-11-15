// Arconis: docs/architecture/subsystems.arconis#item=view — frontend/src is the view and UI; it receives only GIS results through the facade.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "ol/ol.css";
import "./styles.css";
import "./cartography.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 500 } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>
);
