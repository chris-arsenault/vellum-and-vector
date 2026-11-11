import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Who still reads the old society records (docs/SOCIETY-ECONOMY-INTERACTIONS-PLAN.md, M3 and
 * M5). People now live on the land's layers; the catchment record, its per-community ledgers
 * and its list of links are being retired. This list is every source file that still names
 * them. It may only shrink: the check fails when a file starts naming them, and when a file
 * that stopped is still listed, so the list is always the true remaining work. M5 is done
 * when the list is empty and the old types no longer exist.
 *
 * The check reads source text for the old types' names, a state's `society` member, and the
 * community ids that records and ways carried. It is not compiler-resolved: a reference
 * through an alias that names none of these is not seen.
 */
const root = join(__dirname, "../../../..");
const old =
  /\b(SocietyCommunity|SocietyRegion|SocietyConnection|SocietyWork|SocietyPolity|SocietyEvent|SocietySupport|HumanRound|SettlementHierarchy)\b|[.?!]society\b|\bsociety[!?]?\.region\b|communityId|fromCommunity|toCommunity/;
const remaining = [
  "frontend/src/SocietyWorkForm.tsx",
  "packages/domain/src/mapRouteEdits.ts",
  "packages/domain/src/registry.ts",
  "packages/generation/src/poi/settlements/forge.ts",
  "packages/generation/src/poi/settlements/settlementRecords.ts",
  "packages/generation/src/societyRuins.ts",
  "packages/storage-browser/src/recordLinks.ts",
  "packages/storage-browser/src/recordSelection.ts",
  "packages/storage-browser/src/registryCatalog.ts",
  "frontend/src/SettlementPeople.tsx",
  "frontend/src/SettlementSurface.tsx",
  "frontend/src/SettlementTies.tsx",
  "frontend/src/settlementSurfaceData.ts",
  "packages/domain/src/model.ts",
  "packages/domain/src/operations.ts",
  "packages/domain/src/settlementInspection.ts",
  "packages/domain/src/society.ts",
  "packages/domain/src/societyEditing.ts",
  "packages/domain/src/societyPractices.ts",
  "packages/generation/src/atlasWorkflow.ts",
  "packages/generation/src/generationNumericalState.ts",
  "packages/generation/src/mapBuilt.ts",
  "packages/generation/src/mapPeople.ts",
  "packages/generation/src/poi/ground/mine.ts",
  "packages/generation/src/poi/poiContract.ts",
  "packages/generation/src/poi/poiEffects.ts",
  "packages/generation/src/poi/poiOrigins.ts",
  "packages/generation/src/poi/settlements/communityRecords.ts",
  "packages/generation/src/poi/settlements/disasterSite.ts",
  "packages/generation/src/poi/settlements/workRecords.ts",
  "packages/generation/src/process.ts",
  "packages/generation/src/regional/schedule.ts",
  "packages/generation/src/regional/workflow.ts",
  "packages/generation/src/regionalSociety.ts",
  "packages/generation/src/societyCentres.ts",
  "packages/generation/src/societyCharacter.ts",
  "packages/generation/src/societyColdAge.ts",
  "packages/generation/src/societyContact.ts",
  "packages/generation/src/societyCulture.ts",
  "packages/generation/src/societyCulturePublication.ts",
  "packages/generation/src/societyDemand.ts",
  "packages/generation/src/societyEnvironment.ts",
  "packages/generation/src/societyEvolution.ts",
  "packages/generation/src/societyGeography.ts",
  "packages/generation/src/societyHazards.ts",
  "packages/generation/src/societyHierarchy.ts",
  "packages/generation/src/societyHighways.ts",
  "packages/generation/src/societyInheritance.ts",
  "packages/generation/src/societyInventory.ts",
  "packages/generation/src/societyLanguage.ts",
  "packages/generation/src/societyMagic.ts",
  "packages/generation/src/societyMagicAccess.ts",
  "packages/generation/src/societyMapScope.ts",
  "packages/generation/src/societyNaming.ts",
  "packages/generation/src/societyNativeWorks.ts",
  "packages/generation/src/societyPoliticalPublication.ts",
  "packages/generation/src/societyPolitics.ts",
  "packages/generation/src/societyPopulation.ts",
  "packages/generation/src/societyPractices.ts",
  "packages/generation/src/societyProcesses.ts",
  "packages/generation/src/societyProfile.ts",
  "packages/generation/src/societyRecord.ts",
  "packages/generation/src/societyRound.ts",
  "packages/generation/src/societySeeking.ts",
  "packages/generation/src/societySettlements.ts",
  "packages/generation/src/societySiege.ts",
  "packages/generation/src/societySites.ts",
  "packages/generation/src/societySpatial.ts",
  "packages/generation/src/societySupport.ts",
  "packages/generation/src/societyTempo.ts",
  "packages/generation/src/societyTraits.ts",
  "packages/generation/src/societyWaterUse.ts",
  "packages/generation/src/societyWays.ts",
  "packages/generation/src/societyWorkGeometry.ts",
  "packages/generation/src/societyWorkPublication.ts",
  "packages/generation/src/societyWorks.ts",
  "packages/generation/src/world/magicGroundwater.ts",
  "packages/generation/src/world/magicHallowed.ts",
  "packages/generation/src/world/magicProcesses.ts",
  "packages/generation/src/worldPoliticalAuthority.ts",
  "packages/generation/src/worldTerritoryGeography.ts",
  "packages/storage-browser/src/communityIndex.ts",
  "packages/storage-browser/src/settlementCatalog.ts",
];

function* sources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "harness", "testSupport"].includes(entry.name)) yield* sources(path);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|architecture)\.tsx?$|Fixture/.test(entry.name)
    )
      yield path;
  }
}
function naming() {
  const directories = [
    ...["domain", "generation", "application", "storage-browser"].map((name) =>
      join(root, "packages", name, "src")
    ),
    join(root, "frontend/src"),
  ];
  return directories
    .flatMap((directory) => [...sources(directory)])
    .filter((path) => old.test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path))
    .sort();
}

it("names the old society records only in the files still to be carried over", () => {
  expect(naming()).toEqual([...remaining].sort());
});
