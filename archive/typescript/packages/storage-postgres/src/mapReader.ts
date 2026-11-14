import { ProductMapReader, type MapAssetReader } from "@atlas/map";
import type { SqlReader } from "./database";
import { PostgresMapCatalog } from "./mapCatalog";
import { PostgresMapInteractions } from "./mapInteractions";
import { PostgresMapRegistry } from "./mapRegistry";
import { PostgresMapSettlements } from "./mapSettlements";

export class PostgresMapReader extends ProductMapReader {
  constructor(database: SqlReader, assets: MapAssetReader) {
    const catalog = new PostgresMapCatalog(database);
    super({
      catalog,
      assets,
      interactions: new PostgresMapInteractions(catalog, database),
      registry: new PostgresMapRegistry(database, catalog),
      settlements: new PostgresMapSettlements(database, catalog),
    });
  }
}
