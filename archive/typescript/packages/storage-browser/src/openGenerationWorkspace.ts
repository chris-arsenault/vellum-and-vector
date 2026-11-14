import { openCatalogPool } from "./catalogPool";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { SqliteNetworkWorkspace } from "./networkWorkspace";
import { SqliteContourWorkspace } from "./contourWorkspace";
import { openStorageSession } from "./storageSession";

export async function openGenerationWorkspace(name: string) {
  const release = await openStorageSession();
  try {
    return await openWorkingFeatures(name, release);
  } catch (error) {
    await release();
    throw error;
  }
}
async function openWorkingFeatures(name: string, release: () => Promise<void>) {
  const pool = await openCatalogPool(name),
    path = "/features.sqlite3";
  const db = new pool.OpfsSAHPoolDb(path);
  try {
    const features = new SqliteFeatureWorkspace(db);
    const sourceFeatures = new SqliteFeatureWorkspace(db, "source_features");
    const networks = new SqliteNetworkWorkspace(db);
    const sourceNetworks = new SqliteNetworkWorkspace(db, "source_networks");
    const contours = new SqliteContourWorkspace(db);
    return {
      features,
      sourceFeatures,
      networks,
      sourceNetworks,
      contours,
      async close() {
        try {
          db.close();
          pool.unlink(path);
        } finally {
          pool.pauseVfs();
          await release();
        }
      },
    };
  } catch (error) {
    db.close();
    pool.pauseVfs();
    throw error;
  }
}
