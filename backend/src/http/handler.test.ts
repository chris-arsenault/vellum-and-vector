import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { rectangle, type SpatialScope, type Area, type World } from "@atlas/domain";
import { Database } from "../dal/database";
import { testDatabase } from "../testDatabase";
import { createHttpHandler } from "./handler";
import type { AlbEvent, AlbResult } from "./types";

let db: Awaited<ReturnType<typeof testDatabase>>, handle: ReturnType<typeof createHttpHandler>;
const origin = "https://vellum-and-vector.ahara.io";
beforeAll(async () => {
  db = await testDatabase();
  handle = createHttpHandler(new Database(db.client), { clientId: "atlas-client", origin });
});
afterAll(async () => {
  await db?.close();
});
function event(
  method: string,
  path: string,
  body?: unknown,
  owner = "alice",
  client = "atlas-client"
): AlbEvent {
  // The event fixture supplies already ALB-validated claims. Signature and
  // issuer validation run at the shared ALB in deployment.
  const payload = Buffer.from(
    JSON.stringify({ sub: owner, client_id: client, token_use: "access" })
  ).toString("base64url");
  return {
    httpMethod: method,
    path,
    headers: {
      authorization: `Bearer e30.${payload}.c2ln`,
      origin,
      "content-type": "application/json",
    },
    requestContext: {
      elb: { targetGroupArn: "arn:aws:elasticloadbalancing:test:targetgroup/atlas" },
    },
    body: body === undefined ? null : JSON.stringify(body),
  };
}
function body<T>(response: AlbResult, status = 200): T {
  expect(response.statusCode, response.body).toBe(status);
  return JSON.parse(response.body) as T;
}
async function createWorld() {
  const id = randomUUID(),
    reference = {
      id: "fictional",
      domain: rectangle([0, 0, 100, 100]),
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "sea",
      version: 1,
      precision: 1e-6,
    };
  const created = body<{ worldId: string; rootAreaId: string }>(
    await handle(
      event("POST", "/api/worlds", {
        operationId: randomUUID(),
        world: { id, name: "Sparse atlas", seed: 42, reference },
      })
    ),
    201
  );
  const scope: SpatialScope = {
    worldId: id,
    areaId: created.rootAreaId,
    spaceId: id,
    footprint: reference.domain,
    crsId: reference.id,
    revision: 1,
    time: "present",
    resolution: null,
  };
  return { id, scope };
}
function intent(scope: SpatialScope, kind: string, data: unknown) {
  return {
    operationId: randomUUID(),
    expectedVersion: scope.revision,
    version: 1,
    scope,
    kind,
    data,
  };
}
async function commit(world: string, input: ReturnType<typeof intent>) {
  return body<{ version: number; actor: string }>(
    await handle(event("POST", `/api/worlds/${world}/intents/commit`, input))
  );
}
it("creates sparse located refinements through HTTP with skipped profiles and canonical access-node connections", async () => {
  const { id, scope } = await createWorld(),
    local = randomUUID(),
    floor = randomUUID();
  await commit(
    id,
    intent(scope, "createArea", {
      id: local,
      parentId: scope.areaId,
      name: "Valley",
      profile: "local",
      footprint: rectangle([20, 20, 80, 80]),
      frame: { origin: { x: 20, y: 20, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
      approach: "manual",
      layers: ["roads", "rivers", "pois"],
    })
  );
  const selected = { ...scope, revision: 2, areaId: local, footprint: rectangle([20, 20, 80, 80]) };
  const request = intent(selected, "createArea", {
    id: floor,
    parentId: local,
    name: "Cellar",
    profile: "interior",
    context: "building",
    footprint: rectangle([25, 25, 35, 35]),
    frame: { origin: { x: 25, y: 25, z: -10 }, rotation: 0, metresPerUnit: 1, floor: "cellar" },
    approach: "manual",
    layers: ["pois", "structures"],
  });
  const preview = body<{ candidate: World }>(
    await handle(event("POST", `/api/worlds/${id}/intents/preview`, request))
  );
  const operation = await commit(id, request);
  expect(operation.version).toBe(3);
  const stored = body<{ area: Area }>(
    await handle(event("GET", `/api/worlds/${id}/areas/${floor}`))
  );
  expect(stored.area).toEqual(preview.candidate.areas[floor]);
  expect(stored.area.spaceId).toBe(floor);
  const connection = Object.values(preview.candidate.connections!)[0];
  expect(connection.a.nodeId).toBeTruthy();
  expect(connection.b.nodeId).toBeTruthy();
  const page = body<{ items: (typeof connection)[] }>(
    await handle(
      event("POST", `/api/worlds/${id}/network/connection/query`, {
        scope: { ...selected, revision: 3 },
        layers: [],
        page: { offset: 0, limit: 10 },
      })
    )
  );
  expect(page.items).toEqual([connection]);
  expect((await commit(id, request)).version).toBe(3);
});
it("enforces owner/client/agent protection boundaries and returns exact conflict and preflight responses", async () => {
  const { id, scope } = await createWorld(),
    feature = randomUUID();
  const request = intent(scope, "putFeature", {
    areaId: scope.areaId,
    feature: {
      id: feature,
      name: "Protected shrine",
      kind: "shrine",
      layerId: "pois",
      geometry: { type: "Point", coordinates: [10, 10] },
      attributes: {},
      relations: [],
      protected: true,
    },
  });
  await commit(id, request);
  const agent = event(
    "POST",
    `/api/worlds/${id}/intents/commit`,
    intent({ ...scope, revision: 2 }, "protectFeature", {
      featureId: feature,
      areaId: scope.areaId,
      protected: false,
    })
  );
  agent.headers!["x-atlas-actor"] = "agent";
  expect(body<{ code: string }>(await handle(agent), 422).code).toBe("protected_feature");
  expect(
    body<{ code: string }>(await handle(event("GET", `/api/worlds/${id}`, undefined, "bob")), 404)
      .code
  ).toBe("not_found");
  expect(
    body<{ code: string }>(
      await handle(event("GET", `/api/worlds/${id}`, undefined, "alice", "another-app")),
      403
    ).code
  ).toBe("forbidden");
  const stale = { ...request, operationId: randomUUID() };
  expect(
    body<{ code: string }>(
      await handle(event("POST", `/api/worlds/${id}/intents/commit`, stale)),
      409
    ).code
  ).toBe("stale_version");
  const preflight = event("OPTIONS", `/api/worlds/${id}`);
  delete preflight.headers!.authorization;
  const response = await handle(preflight);
  expect(response.statusCode).toBe(204);
  expect(response.headers["access-control-allow-origin"]).toBe(origin);
  expect(
    body<{ code: string }>(
      await handle({ ...event("GET", "/api/worlds"), headers: { origin } }),
      401
    ).code
  ).toBe("unauthorized");
});
it("persists views and magical sources independently of numerical payloads and confirms high-impact owner edits", async () => {
  const { id, scope } = await createWorld(),
    magic = randomUUID(),
    view = randomUUID();
  await commit(
    id,
    intent(scope, "putMagicSource", {
      id: magic,
      name: "Fire core",
      source: { x: 50, y: 50, z: -100 },
      radius: 10,
      strength: 2,
      propagation: "fracture",
      effect: "heat",
      decay: 0.1,
      storage: 0.2,
      dependsOn: null,
      startsAtEpoch: 0,
    })
  );
  await commit(
    id,
    intent({ ...scope, revision: 2 }, "putView", {
      id: view,
      name: "Cultural view",
      areaId: scope.areaId,
      layers: [{ layerId: "cultures", visible: true, opacity: 0.7, color: "#88aa99", minScale: 0 }],
    })
  );
  const world = body<{ world: World }>(await handle(event("GET", `/api/worlds/${id}`))).world;
  expect(world.magic[0].id).toBe(magic);
  expect(world.views[0].id).toBe(view);
  expect(world.fields).toEqual([]);
  const change = intent({ ...scope, revision: 3 }, "setWorldSettings", {
    name: "Renamed atlas",
    seed: 99,
  });
  expect(
    body<{ code: string }>(
      await handle(event("POST", `/api/worlds/${id}/intents/commit`, change)),
      422
    ).code
  ).toBe("confirmation_required");
  const accepted = body<{ version: number }>(
    await handle(event("POST", `/api/worlds/${id}/intents/commit`, { ...change, confirmed: true }))
  );
  expect(accepted.version).toBe(4);
});
