import { z } from "zod";
declare const condition: z.ZodObject<
  {
    field: z.ZodString;
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
    values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    salt: z.ZodOptional<z.ZodNumber>;
    index: z.ZodOptional<z.ZodNumber>;
  },
  z.core.$strip
>;
export declare const magicFeatureSchema: z.ZodObject<
  {
    cartography: z.ZodOptional<
      z.ZodEnum<{
        area: "area";
        site: "site";
        course: "course";
      }>
    >;
    id: z.ZodString;
    name: z.ZodString;
    priority: z.ZodDefault<z.ZodNumber>;
    seeds: z.ZodArray<
      z.ZodArray<
        z.ZodObject<
          {
            field: z.ZodString;
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
            values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            salt: z.ZodOptional<z.ZodNumber>;
            index: z.ZodOptional<z.ZodNumber>;
          },
          z.core.$strip
        >
      >
    >;
    retains: z.ZodOptional<
      z.ZodArray<
        z.ZodArray<
          z.ZodObject<
            {
              field: z.ZodString;
              min: z.ZodOptional<z.ZodNumber>;
              max: z.ZodOptional<z.ZodNumber>;
              values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
              salt: z.ZodOptional<z.ZodNumber>;
              index: z.ZodOptional<z.ZodNumber>;
            },
            z.core.$strip
          >
        >
      >
    >;
    coverage: z.ZodOptional<
      z.ZodObject<
        {
          field: z.ZodString;
          floor: z.ZodNumber;
          full: z.ZodNumber;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const magicSources: readonly [
  "geothermal",
  "cold",
  "deep-ocean",
  "placed",
  "verdant",
  "aquifer",
  "impact",
  "forge",
  "death",
  "dead-lake",
  "tenure",
  "kept-line",
  "strain",
  "pairing",
];
export declare const magicPropagations: readonly [
  "fracture",
  "cold-drainage",
  "ocean-rays",
  "radial",
  "roots",
  "local",
  "brine",
  "ward",
];
/**
 * How an origin's stock is renewed: fed while its conduit is open and sealed after a budget,
 * accumulating across epochs, continuous from a standing source, a finite stock that only
 * runs down, kept by maintenance, or emergent from other systems' fields.
 */
export declare const magicRenewals: readonly [
  "conduit-fed",
  "accumulating",
  "continuous",
  "finite",
  "kept",
  "emergent",
];
/** The world's own transports a stock can ride between evaluations. */
export declare const magicCarriers: readonly [
  "crust",
  "ice",
  "river",
  "groundwater",
  "wind",
  "current",
  "animal",
  "people",
  "door",
];
export type MagicSource = (typeof magicSources)[number];
export type MagicPropagation = (typeof magicPropagations)[number];
export type MagicRenewal = (typeof magicRenewals)[number];
export type MagicCarrier = (typeof magicCarriers)[number];
/** An amount of the system held in one reservoir per cell and moved by the named carriers. */
export declare const magicStockSchema: z.ZodObject<
  {
    id: z.ZodString;
    reservoir: z.ZodString;
    carriers: z.ZodDefault<
      z.ZodArray<
        z.ZodEnum<{
          ice: "ice";
          river: "river";
          crust: "crust";
          groundwater: "groundwater";
          wind: "wind";
          current: "current";
          animal: "animal";
          people: "people";
          door: "door";
        }>
      >
    >;
  },
  z.core.$strip
>;
/**
 * One way a system is created and spreads. A system holds one effect set and one rule set;
 * its origins differ in where they are located, how they propagate and how they renew.
 */
export declare const magicOriginSchema: z.ZodObject<
  {
    id: z.ZodString;
    source: z.ZodEnum<{
      placed: "placed";
      geothermal: "geothermal";
      cold: "cold";
      "deep-ocean": "deep-ocean";
      verdant: "verdant";
      aquifer: "aquifer";
      impact: "impact";
      forge: "forge";
      death: "death";
      "dead-lake": "dead-lake";
      tenure: "tenure";
      "kept-line": "kept-line";
      strain: "strain";
      pairing: "pairing";
    }>;
    propagation: z.ZodEnum<{
      local: "local";
      fracture: "fracture";
      "cold-drainage": "cold-drainage";
      "ocean-rays": "ocean-rays";
      radial: "radial";
      roots: "roots";
      brine: "brine";
      ward: "ward";
    }>;
    renewal: z.ZodDefault<
      z.ZodEnum<{
        "conduit-fed": "conduit-fed";
        accumulating: "accumulating";
        continuous: "continuous";
        finite: "finite";
        kept: "kept";
        emergent: "emergent";
      }>
    >;
    parameters: z.ZodDefault<
      z.ZodObject<
        {
          sourceThreshold: z.ZodOptional<z.ZodNumber>;
          sourceSpacing: z.ZodOptional<z.ZodNumber>;
          baseCost: z.ZodOptional<z.ZodNumber>;
          conductanceDivisor: z.ZodOptional<z.ZodNumber>;
          baseInput: z.ZodOptional<z.ZodNumber>;
          logScale: z.ZodOptional<z.ZodNumber>;
          iceRetention: z.ZodOptional<z.ZodNumber>;
          coldRetentionDistance: z.ZodOptional<z.ZodNumber>;
          accumulationArea: z.ZodOptional<z.ZodNumber>;
          featureNoiseScale: z.ZodOptional<z.ZodNumber>;
          rayCount: z.ZodOptional<z.ZodNumber>;
          rayDistance: z.ZodOptional<z.ZodNumber>;
          coastalRayDistance: z.ZodOptional<z.ZodNumber>;
          wakeDistance: z.ZodOptional<z.ZodNumber>;
          beamWidth: z.ZodOptional<z.ZodNumber>;
          coastalSources: z.ZodOptional<z.ZodNumber>;
          coastalSourceDistance: z.ZodOptional<z.ZodNumber>;
          wakeSources: z.ZodOptional<z.ZodNumber>;
          coastalThreshold: z.ZodOptional<z.ZodNumber>;
          waveAmplification: z.ZodOptional<z.ZodNumber>;
          currentAmplification: z.ZodOptional<z.ZodNumber>;
          rayDecay: z.ZodOptional<z.ZodNumber>;
          rayIntensity: z.ZodOptional<z.ZodNumber>;
          wakeStrength: z.ZodOptional<z.ZodNumber>;
          conduitBudget: z.ZodOptional<z.ZodNumber>;
          fallenDensity: z.ZodOptional<z.ZodNumber>;
          fallenRelease: z.ZodOptional<z.ZodNumber>;
          strainCracking: z.ZodOptional<z.ZodNumber>;
          iceCracking: z.ZodOptional<z.ZodNumber>;
          iceCrackDepth: z.ZodOptional<z.ZodNumber>;
          frostCracking: z.ZodOptional<z.ZodNumber>;
          impactShock: z.ZodOptional<z.ZodNumber>;
          impactHeatShare: z.ZodOptional<z.ZodNumber>;
          placerMobility: z.ZodOptional<z.ZodNumber>;
          buryDepth: z.ZodOptional<z.ZodNumber>;
          reopenStrain: z.ZodOptional<z.ZodNumber>;
          reopenShare: z.ZodOptional<z.ZodNumber>;
          exhumedRelease: z.ZodOptional<z.ZodNumber>;
          fanBarrenEpochs: z.ZodOptional<z.ZodNumber>;
          fanBarrenDepth: z.ZodOptional<z.ZodNumber>;
          relictStrength: z.ZodOptional<z.ZodNumber>;
          iceCarry: z.ZodOptional<z.ZodNumber>;
          meltwaterLoss: z.ZodOptional<z.ZodNumber>;
          iceChargeSaturation: z.ZodOptional<z.ZodNumber>;
          thawSubsidence: z.ZodOptional<z.ZodNumber>;
          shelfSaturation: z.ZodOptional<z.ZodNumber>;
          stormFrontGradient: z.ZodOptional<z.ZodNumber>;
          standAge: z.ZodOptional<z.ZodNumber>;
          standCover: z.ZodOptional<z.ZodNumber>;
          peatDepth: z.ZodOptional<z.ZodNumber>;
          rootCost: z.ZodOptional<z.ZodNumber>;
          rootFloor: z.ZodOptional<z.ZodNumber>;
          springFlow: z.ZodOptional<z.ZodNumber>;
          springChargeSaturation: z.ZodOptional<z.ZodNumber>;
          springRock: z.ZodOptional<z.ZodNumber>;
          overdrawShare: z.ZodOptional<z.ZodNumber>;
          sinkDepth: z.ZodOptional<z.ZodNumber>;
          animalCarry: z.ZodOptional<z.ZodNumber>;
          strataShare: z.ZodOptional<z.ZodNumber>;
          organicChargeAffinity: z.ZodOptional<z.ZodNumber>;
          groveSap: z.ZodOptional<z.ZodNumber>;
          sapLoss: z.ZodOptional<z.ZodNumber>;
          forgeStrength: z.ZodOptional<z.ZodNumber>;
          forgeCooling: z.ZodOptional<z.ZodNumber>;
          saltPerDeath: z.ZodOptional<z.ZodNumber>;
          saltPerLakeMetre: z.ZodOptional<z.ZodNumber>;
          saltFull: z.ZodOptional<z.ZodNumber>;
          saltMaterialDensity: z.ZodOptional<z.ZodNumber>;
          brineFlush: z.ZodOptional<z.ZodNumber>;
          seepShare: z.ZodOptional<z.ZodNumber>;
          crustShare: z.ZodOptional<z.ZodNumber>;
          dissolveShare: z.ZodOptional<z.ZodNumber>;
          dustShare: z.ZodOptional<z.ZodNumber>;
          dustSettle: z.ZodOptional<z.ZodNumber>;
          glassBed: z.ZodOptional<z.ZodNumber>;
          glassResistance: z.ZodOptional<z.ZodNumber>;
          desiccation: z.ZodOptional<z.ZodNumber>;
          domeStrain: z.ZodOptional<z.ZodNumber>;
          domeRise: z.ZodOptional<z.ZodNumber>;
          domeSeep: z.ZodOptional<z.ZodNumber>;
          saltBurn: z.ZodOptional<z.ZodNumber>;
          tenureFull: z.ZodOptional<z.ZodNumber>;
          pilgrimageBonus: z.ZodOptional<z.ZodNumber>;
          lineFull: z.ZodOptional<z.ZodNumber>;
          roadFull: z.ZodOptional<z.ZodNumber>;
          wardReach: z.ZodOptional<z.ZodNumber>;
          auroraReinforce: z.ZodOptional<z.ZodNumber>;
          wardSpill: z.ZodOptional<z.ZodNumber>;
          tearFloor: z.ZodOptional<z.ZodNumber>;
          tearFull: z.ZodOptional<z.ZodNumber>;
          wildShift: z.ZodOptional<z.ZodNumber>;
          doorStrain: z.ZodOptional<z.ZodNumber>;
          doorDistance: z.ZodOptional<z.ZodNumber>;
          doorMatch: z.ZodOptional<z.ZodNumber>;
          wildRelief: z.ZodOptional<z.ZodNumber>;
          wildShuffle: z.ZodOptional<z.ZodNumber>;
          doorChill: z.ZodOptional<z.ZodNumber>;
          doorPool: z.ZodOptional<z.ZodNumber>;
          doorTravel: z.ZodOptional<z.ZodNumber>;
          knitVerdure: z.ZodOptional<z.ZodNumber>;
          holdSalting: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    stocks: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            reservoir: z.ZodString;
            carriers: z.ZodDefault<
              z.ZodArray<
                z.ZodEnum<{
                  ice: "ice";
                  river: "river";
                  crust: "crust";
                  groundwater: "groundwater";
                  wind: "wind";
                  current: "current";
                  animal: "animal";
                  people: "people";
                  door: "door";
                }>
              >
            >;
          },
          z.core.$strip
        >
      >
    >;
  },
  z.core.$strip
>;
export type MagicOrigin = z.infer<typeof magicOriginSchema>;
export type MagicStock = z.infer<typeof magicStockSchema>;
export declare const magicSystemSchema: z.ZodObject<
  {
    lengthUnits: z.ZodDefault<z.ZodLiteral<"relative">>;
    id: z.ZodString;
    name: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
    origins: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          source: z.ZodEnum<{
            placed: "placed";
            geothermal: "geothermal";
            cold: "cold";
            "deep-ocean": "deep-ocean";
            verdant: "verdant";
            aquifer: "aquifer";
            impact: "impact";
            forge: "forge";
            death: "death";
            "dead-lake": "dead-lake";
            tenure: "tenure";
            "kept-line": "kept-line";
            strain: "strain";
            pairing: "pairing";
          }>;
          propagation: z.ZodEnum<{
            local: "local";
            fracture: "fracture";
            "cold-drainage": "cold-drainage";
            "ocean-rays": "ocean-rays";
            radial: "radial";
            roots: "roots";
            brine: "brine";
            ward: "ward";
          }>;
          renewal: z.ZodDefault<
            z.ZodEnum<{
              "conduit-fed": "conduit-fed";
              accumulating: "accumulating";
              continuous: "continuous";
              finite: "finite";
              kept: "kept";
              emergent: "emergent";
            }>
          >;
          parameters: z.ZodDefault<
            z.ZodObject<
              {
                sourceThreshold: z.ZodOptional<z.ZodNumber>;
                sourceSpacing: z.ZodOptional<z.ZodNumber>;
                baseCost: z.ZodOptional<z.ZodNumber>;
                conductanceDivisor: z.ZodOptional<z.ZodNumber>;
                baseInput: z.ZodOptional<z.ZodNumber>;
                logScale: z.ZodOptional<z.ZodNumber>;
                iceRetention: z.ZodOptional<z.ZodNumber>;
                coldRetentionDistance: z.ZodOptional<z.ZodNumber>;
                accumulationArea: z.ZodOptional<z.ZodNumber>;
                featureNoiseScale: z.ZodOptional<z.ZodNumber>;
                rayCount: z.ZodOptional<z.ZodNumber>;
                rayDistance: z.ZodOptional<z.ZodNumber>;
                coastalRayDistance: z.ZodOptional<z.ZodNumber>;
                wakeDistance: z.ZodOptional<z.ZodNumber>;
                beamWidth: z.ZodOptional<z.ZodNumber>;
                coastalSources: z.ZodOptional<z.ZodNumber>;
                coastalSourceDistance: z.ZodOptional<z.ZodNumber>;
                wakeSources: z.ZodOptional<z.ZodNumber>;
                coastalThreshold: z.ZodOptional<z.ZodNumber>;
                waveAmplification: z.ZodOptional<z.ZodNumber>;
                currentAmplification: z.ZodOptional<z.ZodNumber>;
                rayDecay: z.ZodOptional<z.ZodNumber>;
                rayIntensity: z.ZodOptional<z.ZodNumber>;
                wakeStrength: z.ZodOptional<z.ZodNumber>;
                conduitBudget: z.ZodOptional<z.ZodNumber>;
                fallenDensity: z.ZodOptional<z.ZodNumber>;
                fallenRelease: z.ZodOptional<z.ZodNumber>;
                strainCracking: z.ZodOptional<z.ZodNumber>;
                iceCracking: z.ZodOptional<z.ZodNumber>;
                iceCrackDepth: z.ZodOptional<z.ZodNumber>;
                frostCracking: z.ZodOptional<z.ZodNumber>;
                impactShock: z.ZodOptional<z.ZodNumber>;
                impactHeatShare: z.ZodOptional<z.ZodNumber>;
                placerMobility: z.ZodOptional<z.ZodNumber>;
                buryDepth: z.ZodOptional<z.ZodNumber>;
                reopenStrain: z.ZodOptional<z.ZodNumber>;
                reopenShare: z.ZodOptional<z.ZodNumber>;
                exhumedRelease: z.ZodOptional<z.ZodNumber>;
                fanBarrenEpochs: z.ZodOptional<z.ZodNumber>;
                fanBarrenDepth: z.ZodOptional<z.ZodNumber>;
                relictStrength: z.ZodOptional<z.ZodNumber>;
                iceCarry: z.ZodOptional<z.ZodNumber>;
                meltwaterLoss: z.ZodOptional<z.ZodNumber>;
                iceChargeSaturation: z.ZodOptional<z.ZodNumber>;
                thawSubsidence: z.ZodOptional<z.ZodNumber>;
                shelfSaturation: z.ZodOptional<z.ZodNumber>;
                stormFrontGradient: z.ZodOptional<z.ZodNumber>;
                standAge: z.ZodOptional<z.ZodNumber>;
                standCover: z.ZodOptional<z.ZodNumber>;
                peatDepth: z.ZodOptional<z.ZodNumber>;
                rootCost: z.ZodOptional<z.ZodNumber>;
                rootFloor: z.ZodOptional<z.ZodNumber>;
                springFlow: z.ZodOptional<z.ZodNumber>;
                springChargeSaturation: z.ZodOptional<z.ZodNumber>;
                springRock: z.ZodOptional<z.ZodNumber>;
                overdrawShare: z.ZodOptional<z.ZodNumber>;
                sinkDepth: z.ZodOptional<z.ZodNumber>;
                animalCarry: z.ZodOptional<z.ZodNumber>;
                strataShare: z.ZodOptional<z.ZodNumber>;
                organicChargeAffinity: z.ZodOptional<z.ZodNumber>;
                groveSap: z.ZodOptional<z.ZodNumber>;
                sapLoss: z.ZodOptional<z.ZodNumber>;
                forgeStrength: z.ZodOptional<z.ZodNumber>;
                forgeCooling: z.ZodOptional<z.ZodNumber>;
                saltPerDeath: z.ZodOptional<z.ZodNumber>;
                saltPerLakeMetre: z.ZodOptional<z.ZodNumber>;
                saltFull: z.ZodOptional<z.ZodNumber>;
                saltMaterialDensity: z.ZodOptional<z.ZodNumber>;
                brineFlush: z.ZodOptional<z.ZodNumber>;
                seepShare: z.ZodOptional<z.ZodNumber>;
                crustShare: z.ZodOptional<z.ZodNumber>;
                dissolveShare: z.ZodOptional<z.ZodNumber>;
                dustShare: z.ZodOptional<z.ZodNumber>;
                dustSettle: z.ZodOptional<z.ZodNumber>;
                glassBed: z.ZodOptional<z.ZodNumber>;
                glassResistance: z.ZodOptional<z.ZodNumber>;
                desiccation: z.ZodOptional<z.ZodNumber>;
                domeStrain: z.ZodOptional<z.ZodNumber>;
                domeRise: z.ZodOptional<z.ZodNumber>;
                domeSeep: z.ZodOptional<z.ZodNumber>;
                saltBurn: z.ZodOptional<z.ZodNumber>;
                tenureFull: z.ZodOptional<z.ZodNumber>;
                pilgrimageBonus: z.ZodOptional<z.ZodNumber>;
                lineFull: z.ZodOptional<z.ZodNumber>;
                roadFull: z.ZodOptional<z.ZodNumber>;
                wardReach: z.ZodOptional<z.ZodNumber>;
                auroraReinforce: z.ZodOptional<z.ZodNumber>;
                wardSpill: z.ZodOptional<z.ZodNumber>;
                tearFloor: z.ZodOptional<z.ZodNumber>;
                tearFull: z.ZodOptional<z.ZodNumber>;
                wildShift: z.ZodOptional<z.ZodNumber>;
                doorStrain: z.ZodOptional<z.ZodNumber>;
                doorDistance: z.ZodOptional<z.ZodNumber>;
                doorMatch: z.ZodOptional<z.ZodNumber>;
                wildRelief: z.ZodOptional<z.ZodNumber>;
                wildShuffle: z.ZodOptional<z.ZodNumber>;
                doorChill: z.ZodOptional<z.ZodNumber>;
                doorPool: z.ZodOptional<z.ZodNumber>;
                doorTravel: z.ZodOptional<z.ZodNumber>;
                knitVerdure: z.ZodOptional<z.ZodNumber>;
                holdSalting: z.ZodOptional<z.ZodNumber>;
              },
              z.core.$strip
            >
          >;
          stocks: z.ZodDefault<
            z.ZodArray<
              z.ZodObject<
                {
                  id: z.ZodString;
                  reservoir: z.ZodString;
                  carriers: z.ZodDefault<
                    z.ZodArray<
                      z.ZodEnum<{
                        ice: "ice";
                        river: "river";
                        crust: "crust";
                        groundwater: "groundwater";
                        wind: "wind";
                        current: "current";
                        animal: "animal";
                        people: "people";
                        door: "door";
                      }>
                    >
                  >;
                },
                z.core.$strip
              >
            >
          >;
        },
        z.core.$strip
      >
    >;
    phase: z.ZodEnum<{
      climate: "climate";
      "post-glacial": "post-glacial";
      society: "society";
    }>;
    strength: z.ZodDefault<z.ZodNumber>;
    parameters: z.ZodPrefault<
      z.ZodObject<
        {
          sourceThreshold: z.ZodDefault<z.ZodNumber>;
          sourceSpacing: z.ZodDefault<z.ZodNumber>;
          baseCost: z.ZodDefault<z.ZodNumber>;
          conductanceDivisor: z.ZodDefault<z.ZodNumber>;
          baseInput: z.ZodDefault<z.ZodNumber>;
          logScale: z.ZodDefault<z.ZodNumber>;
          iceRetention: z.ZodDefault<z.ZodNumber>;
          coldRetentionDistance: z.ZodDefault<z.ZodNumber>;
          accumulationArea: z.ZodDefault<z.ZodNumber>;
          featureNoiseScale: z.ZodDefault<z.ZodNumber>;
          rayCount: z.ZodDefault<z.ZodNumber>;
          rayDistance: z.ZodDefault<z.ZodNumber>;
          coastalRayDistance: z.ZodDefault<z.ZodNumber>;
          wakeDistance: z.ZodDefault<z.ZodNumber>;
          beamWidth: z.ZodDefault<z.ZodNumber>;
          coastalSources: z.ZodDefault<z.ZodNumber>;
          coastalSourceDistance: z.ZodDefault<z.ZodNumber>;
          wakeSources: z.ZodDefault<z.ZodNumber>;
          coastalThreshold: z.ZodDefault<z.ZodNumber>;
          waveAmplification: z.ZodDefault<z.ZodNumber>;
          currentAmplification: z.ZodDefault<z.ZodNumber>;
          rayDecay: z.ZodDefault<z.ZodNumber>;
          rayIntensity: z.ZodDefault<z.ZodNumber>;
          wakeStrength: z.ZodDefault<z.ZodNumber>;
          conduitBudget: z.ZodDefault<z.ZodNumber>;
          fallenDensity: z.ZodDefault<z.ZodNumber>;
          fallenRelease: z.ZodDefault<z.ZodNumber>;
          strainCracking: z.ZodDefault<z.ZodNumber>;
          iceCracking: z.ZodDefault<z.ZodNumber>;
          iceCrackDepth: z.ZodDefault<z.ZodNumber>;
          frostCracking: z.ZodDefault<z.ZodNumber>;
          impactShock: z.ZodDefault<z.ZodNumber>;
          impactHeatShare: z.ZodDefault<z.ZodNumber>;
          placerMobility: z.ZodDefault<z.ZodNumber>;
          buryDepth: z.ZodDefault<z.ZodNumber>;
          reopenStrain: z.ZodDefault<z.ZodNumber>;
          reopenShare: z.ZodDefault<z.ZodNumber>;
          exhumedRelease: z.ZodDefault<z.ZodNumber>;
          fanBarrenEpochs: z.ZodDefault<z.ZodNumber>;
          fanBarrenDepth: z.ZodDefault<z.ZodNumber>;
          relictStrength: z.ZodDefault<z.ZodNumber>;
          iceCarry: z.ZodDefault<z.ZodNumber>;
          meltwaterLoss: z.ZodDefault<z.ZodNumber>;
          iceChargeSaturation: z.ZodDefault<z.ZodNumber>;
          thawSubsidence: z.ZodDefault<z.ZodNumber>;
          shelfSaturation: z.ZodDefault<z.ZodNumber>;
          stormFrontGradient: z.ZodDefault<z.ZodNumber>;
          standAge: z.ZodDefault<z.ZodNumber>;
          standCover: z.ZodDefault<z.ZodNumber>;
          peatDepth: z.ZodDefault<z.ZodNumber>;
          rootCost: z.ZodDefault<z.ZodNumber>;
          rootFloor: z.ZodDefault<z.ZodNumber>;
          springFlow: z.ZodDefault<z.ZodNumber>;
          springChargeSaturation: z.ZodDefault<z.ZodNumber>;
          springRock: z.ZodDefault<z.ZodNumber>;
          overdrawShare: z.ZodDefault<z.ZodNumber>;
          sinkDepth: z.ZodDefault<z.ZodNumber>;
          animalCarry: z.ZodDefault<z.ZodNumber>;
          strataShare: z.ZodDefault<z.ZodNumber>;
          organicChargeAffinity: z.ZodDefault<z.ZodNumber>;
          groveSap: z.ZodDefault<z.ZodNumber>;
          sapLoss: z.ZodDefault<z.ZodNumber>;
          forgeStrength: z.ZodDefault<z.ZodNumber>;
          forgeCooling: z.ZodDefault<z.ZodNumber>;
          saltPerDeath: z.ZodDefault<z.ZodNumber>;
          saltPerLakeMetre: z.ZodDefault<z.ZodNumber>;
          saltFull: z.ZodDefault<z.ZodNumber>;
          saltMaterialDensity: z.ZodDefault<z.ZodNumber>;
          brineFlush: z.ZodDefault<z.ZodNumber>;
          seepShare: z.ZodDefault<z.ZodNumber>;
          crustShare: z.ZodDefault<z.ZodNumber>;
          dissolveShare: z.ZodDefault<z.ZodNumber>;
          dustShare: z.ZodDefault<z.ZodNumber>;
          dustSettle: z.ZodDefault<z.ZodNumber>;
          glassBed: z.ZodDefault<z.ZodNumber>;
          glassResistance: z.ZodDefault<z.ZodNumber>;
          desiccation: z.ZodDefault<z.ZodNumber>;
          domeStrain: z.ZodDefault<z.ZodNumber>;
          domeRise: z.ZodDefault<z.ZodNumber>;
          domeSeep: z.ZodDefault<z.ZodNumber>;
          saltBurn: z.ZodDefault<z.ZodNumber>;
          tenureFull: z.ZodDefault<z.ZodNumber>;
          pilgrimageBonus: z.ZodDefault<z.ZodNumber>;
          lineFull: z.ZodDefault<z.ZodNumber>;
          roadFull: z.ZodDefault<z.ZodNumber>;
          wardReach: z.ZodDefault<z.ZodNumber>;
          auroraReinforce: z.ZodDefault<z.ZodNumber>;
          wardSpill: z.ZodDefault<z.ZodNumber>;
          tearFloor: z.ZodDefault<z.ZodNumber>;
          tearFull: z.ZodDefault<z.ZodNumber>;
          wildShift: z.ZodDefault<z.ZodNumber>;
          doorStrain: z.ZodDefault<z.ZodNumber>;
          doorDistance: z.ZodDefault<z.ZodNumber>;
          doorMatch: z.ZodDefault<z.ZodNumber>;
          wildRelief: z.ZodDefault<z.ZodNumber>;
          wildShuffle: z.ZodDefault<z.ZodNumber>;
          doorChill: z.ZodDefault<z.ZodNumber>;
          doorPool: z.ZodDefault<z.ZodNumber>;
          doorTravel: z.ZodDefault<z.ZodNumber>;
          knitVerdure: z.ZodDefault<z.ZodNumber>;
          holdSalting: z.ZodDefault<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    effects: z.ZodPrefault<
      z.ZodObject<
        {
          heat: z.ZodDefault<z.ZodNumber>;
          iceMelt: z.ZodDefault<z.ZodNumber>;
          rockResistance: z.ZodDefault<z.ZodNumber>;
          coastalForcing: z.ZodDefault<z.ZodNumber>;
          quickening: z.ZodDefault<z.ZodNumber>;
          conduitOpening: z.ZodDefault<z.ZodNumber>;
          stillness: z.ZodDefault<z.ZodNumber>;
          icePersistence: z.ZodDefault<z.ZodNumber>;
          upwelling: z.ZodDefault<z.ZodNumber>;
          seaSurface: z.ZodDefault<z.ZodNumber>;
          wakeWarming: z.ZodDefault<z.ZodNumber>;
          fog: z.ZodDefault<z.ZodNumber>;
          storm: z.ZodDefault<z.ZodNumber>;
          verdure: z.ZodDefault<z.ZodNumber>;
          salting: z.ZodDefault<z.ZodNumber>;
          warding: z.ZodDefault<z.ZodNumber>;
          tearing: z.ZodDefault<z.ZodNumber>;
          vegetationGrowth: z.ZodDefault<z.ZodNumber>;
          fire: z.ZodDefault<z.ZodNumber>;
          organicPreservation: z.ZodDefault<z.ZodNumber>;
          animalToxicity: z.ZodDefault<z.ZodNumber>;
          seedDispersal: z.ZodDefault<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    history: z.ZodPrefault<
      z.ZodObject<
        {
          retention: z.ZodDefault<z.ZodNumber>;
          storage: z.ZodDefault<z.ZodNumber>;
          advect: z.ZodDefault<z.ZodBoolean>;
        },
        z.core.$strip
      >
    >;
    features: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            cartography: z.ZodOptional<
              z.ZodEnum<{
                area: "area";
                site: "site";
                course: "course";
              }>
            >;
            id: z.ZodString;
            name: z.ZodString;
            priority: z.ZodDefault<z.ZodNumber>;
            seeds: z.ZodArray<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    min: z.ZodOptional<z.ZodNumber>;
                    max: z.ZodOptional<z.ZodNumber>;
                    values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
                    salt: z.ZodOptional<z.ZodNumber>;
                    index: z.ZodOptional<z.ZodNumber>;
                  },
                  z.core.$strip
                >
              >
            >;
            retains: z.ZodOptional<
              z.ZodArray<
                z.ZodArray<
                  z.ZodObject<
                    {
                      field: z.ZodString;
                      min: z.ZodOptional<z.ZodNumber>;
                      max: z.ZodOptional<z.ZodNumber>;
                      values: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
                      salt: z.ZodOptional<z.ZodNumber>;
                      index: z.ZodOptional<z.ZodNumber>;
                    },
                    z.core.$strip
                  >
                >
              >
            >;
            coverage: z.ZodOptional<
              z.ZodObject<
                {
                  field: z.ZodString;
                  floor: z.ZodNumber;
                  full: z.ZodNumber;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >
      >
    >;
  },
  z.core.$strip
>;
export type MagicSystem = z.infer<typeof magicSystemSchema>;
export type MagicSystemInput = z.input<typeof magicSystemSchema>;
export type MagicFeatureRule = z.infer<typeof magicFeatureSchema>;
export type MagicCondition = z.infer<typeof condition>;
/** The system's parameters with this origin's overrides applied. */
export declare function originParameters(
  system: Pick<MagicSystem, "parameters">,
  origin: MagicOrigin
): {
  sourceThreshold: number;
  sourceSpacing: number;
  baseCost: number;
  conductanceDivisor: number;
  baseInput: number;
  logScale: number;
  iceRetention: number;
  coldRetentionDistance: number;
  accumulationArea: number;
  featureNoiseScale: number;
  rayCount: number;
  rayDistance: number;
  coastalRayDistance: number;
  wakeDistance: number;
  beamWidth: number;
  coastalSources: number;
  coastalSourceDistance: number;
  wakeSources: number;
  coastalThreshold: number;
  waveAmplification: number;
  currentAmplification: number;
  rayDecay: number;
  rayIntensity: number;
  wakeStrength: number;
  conduitBudget: number;
  fallenDensity: number;
  fallenRelease: number;
  strainCracking: number;
  iceCracking: number;
  iceCrackDepth: number;
  frostCracking: number;
  impactShock: number;
  impactHeatShare: number;
  placerMobility: number;
  buryDepth: number;
  reopenStrain: number;
  reopenShare: number;
  exhumedRelease: number;
  fanBarrenEpochs: number;
  fanBarrenDepth: number;
  relictStrength: number;
  iceCarry: number;
  meltwaterLoss: number;
  iceChargeSaturation: number;
  thawSubsidence: number;
  shelfSaturation: number;
  stormFrontGradient: number;
  standAge: number;
  standCover: number;
  peatDepth: number;
  rootCost: number;
  rootFloor: number;
  springFlow: number;
  springChargeSaturation: number;
  springRock: number;
  overdrawShare: number;
  sinkDepth: number;
  animalCarry: number;
  strataShare: number;
  organicChargeAffinity: number;
  groveSap: number;
  sapLoss: number;
  forgeStrength: number;
  forgeCooling: number;
  saltPerDeath: number;
  saltPerLakeMetre: number;
  saltFull: number;
  saltMaterialDensity: number;
  brineFlush: number;
  seepShare: number;
  crustShare: number;
  dissolveShare: number;
  dustShare: number;
  dustSettle: number;
  glassBed: number;
  glassResistance: number;
  desiccation: number;
  domeStrain: number;
  domeRise: number;
  domeSeep: number;
  saltBurn: number;
  tenureFull: number;
  pilgrimageBonus: number;
  lineFull: number;
  roadFull: number;
  wardReach: number;
  auroraReinforce: number;
  wardSpill: number;
  tearFloor: number;
  tearFull: number;
  wildShift: number;
  doorStrain: number;
  doorDistance: number;
  doorMatch: number;
  wildRelief: number;
  wildShuffle: number;
  doorChill: number;
  doorPool: number;
  doorTravel: number;
  knitVerdure: number;
  holdSalting: number;
};
/** Magic rule terms resolve to ecological owners independently of presentation labels. */
export declare const magicEcologyFields: {
  readonly biome: "BiomeCodes";
  readonly treeCover: "TreeCover";
  readonly wetlandCover: "WetlandCover";
  readonly peatCarbon: "PeatCarbon";
  readonly oilCarbon: "OilCarbon";
  readonly ecologicalToxicity: "EcologicalToxicity";
  readonly soilWater: "SoilWater";
  readonly soilDepth: "SoilDepth";
  readonly grazers: "Grazers";
  readonly browsers: "Browsers";
};
export declare const magicPhysicalFields: readonly [
  "temperature",
  "ice",
  "elevation",
  "slope",
  "water",
  "moisture",
  "geothermal",
  "fracture",
  "landform",
  "river",
  "biome",
  "treeCover",
  "wetlandCover",
  "peatCarbon",
  "oilCarbon",
  "ecologicalToxicity",
  "soilWater",
  "soilDepth",
  "grazers",
  "browsers",
  "upwelling",
  "quickening",
  "stillness",
  "fog",
  "verdure",
  "noise",
  "intensity",
  "history",
  "source",
  "wake",
  "rogue",
  "coastalHistory",
  "firstEpoch",
  "coastalFirstEpoch",
  "stored",
  "sealed",
  "wild",
  "scatter",
];
/** The stock keys a system's rules may read: `<origin>/<stock>`, with `held` implied. */
export declare function systemStockKeys(system: Pick<MagicSystem, "origins">): Set<string>;
export declare function validateMagicSystems(systems: MagicSystem[]): void;
export {};
