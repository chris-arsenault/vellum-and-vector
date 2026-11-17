import { dispatchMapRead, parseMapCall, dispatchMapNavigation } from "@atlas/transport";
import type { MapReader, MapNavigation } from "@atlas/map";
import { openFinishedAtlas } from "../src/finishedAtlasContext";
import { installFixtureMap } from "./fixturePublication.worker";

let close: (() => Promise<void>) | undefined;
let maps: MapReader | undefined;
let navigation: MapNavigation | undefined;
self.onmessage = async ({ data }) => {
  if (data?.kind === "navigation") return replyNavigation(data);
  if (data?.kind === "read") return replyRead(data);
  if (data === "close") {
    await close?.();
    self.postMessage({ closed: true });
    return;
  }
  try {
    const { reference } = await installFixtureMap();
    // Reopening only map tables and assets proves no generation resource is needed for viewing.
    const workspace = await openFinishedAtlas("browser");
    maps = workspace.maps;
    navigation = workspace.navigation;
    close = () => workspace.dispose();
    const map = await maps.open(reference);
    const sources = await Promise.all(
      map.layers
        .filter((layer) => layer.source.kind === "raster")
        .map((layer) => {
          if (layer.source.kind !== "raster") throw new Error("Expected a supplied raster.");
          return workspace.maps.source(reference, layer.source.data.assetId);
        })
    );
    const inspection = await maps.inspect(reference, {
      spaceId: map.primarySpaceId,
      position: [50, 50],
    });
    const selection = await maps.selectRegion(reference, {
      spaceId: map.primarySpaceId,
      featureIds: ["island"],
    });
    const layer = map.layers.find((layer) => layer.id === "vector:geology")!;
    if (layer.source.kind !== "vector") throw new Error("Expected published geology.");
    const vector = await maps.asset(reference, layer.source.data.assetId);
    const geography = JSON.parse(new TextDecoder().decode(vector.bytes));
    const illustration = await maps.illustration(reference);
    const shapes = illustration.map((asset) => JSON.parse(new TextDecoder().decode(asset.bytes)));
    self.postMessage({ map, sources, inspection, selection, geography, shapes });
  } catch (error) {
    await close?.();
    self.postMessage({ error: String(error) });
  }
};
async function replyNavigation(data: { id: number; call: unknown }) {
  try {
    if (!navigation) throw new Error("Open the published map first.");
    self.postMessage({ id: data.id, value: await dispatchMapNavigation(navigation, data.call) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
}
async function replyRead(data: { id: number; call: unknown }) {
  try {
    if (!maps) throw new Error("Open the published map first.");
    self.postMessage({ id: data.id, value: await dispatchMapRead(maps, parseMapCall(data.call)) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
}
