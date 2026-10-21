import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { createWorld, session } from "./atlasState";

it("colonises islands that emerge after the first epoch", async () => {
  const world = createWorld({ name: "Islands", seed: 104729, width: 4_000_000, height: 3_000_000 });
  for (const epoch of world.epochs) epoch.duration = 5000;
  const domain = session(world.id).snapshot;
  let first: Uint8Array | null = null,
    count = 0;
  const lines: string[] = [];
  let covered = 0,
    cells = 0;
  await generateAtlas(
    domain,
    {
      areaId: domain.scope.areaId,
      quality: "draft",
      seed: world.seed,
      domains: ["physical"],
      parameters: { landFraction: 0.3, continents: 10 },
    },
    {
      async saveBoundary(boundary) {
        if (boundary.kind !== "epoch") return;
        const map = boundary.state.physical!.map;
        count++;
        if (!first) {
          first = Uint8Array.from(map.WaterKindCodes, (kind) => Number(kind === 0));
          return;
        }
        if (map.mesh.count !== first.length) return;
        // Landmasses with no cell that was land at the first epoch boundary.
        const old = new Set<number>();
        for (let i = 0; i < map.mesh.contentCount; i++)
          if (map.WaterKindCodes[i] === 0 && first[i]) old.add(map.LandmassIds[i]);
        covered = cells = 0;
        for (let i = 0; i < map.mesh.contentCount; i++) {
          if (map.WaterKindCodes[i] !== 0 || old.has(map.LandmassIds[i])) continue;
          cells++;
          covered += Number(map.TreeCover[i] + map.GrassCover[i] + map.WetlandCover[i] > 0.12);
        }
        lines.push(`epoch ${count}: new-island cells ${cells}, covered ${covered}`);
      },
    }
  );
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/islands.txt", `${lines.join("\n")}\n`);
  expect(count).toBeGreaterThan(1);
  // Before water crossings, land emerging after initialisation stayed bare.
  expect(cells).toBeGreaterThan(0);
  expect(covered / cells).toBeGreaterThan(0.5);
}, 300_000);
