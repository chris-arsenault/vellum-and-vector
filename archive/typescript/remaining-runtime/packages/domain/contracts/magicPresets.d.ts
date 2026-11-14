export declare function canonryMagicPresets(): {
  lengthUnits: "relative";
  id: string;
  name: string;
  enabled: boolean;
  origins: {
    id: string;
    source:
      | "placed"
      | "geothermal"
      | "cold"
      | "deep-ocean"
      | "verdant"
      | "aquifer"
      | "impact"
      | "forge"
      | "death"
      | "dead-lake"
      | "tenure"
      | "kept-line"
      | "strain"
      | "pairing";
    propagation:
      "local" | "fracture" | "cold-drainage" | "ocean-rays" | "radial" | "roots" | "brine" | "ward";
    renewal: "conduit-fed" | "accumulating" | "continuous" | "finite" | "kept" | "emergent";
    parameters: {
      sourceThreshold?: number | undefined;
      sourceSpacing?: number | undefined;
      baseCost?: number | undefined;
      conductanceDivisor?: number | undefined;
      baseInput?: number | undefined;
      logScale?: number | undefined;
      iceRetention?: number | undefined;
      coldRetentionDistance?: number | undefined;
      accumulationArea?: number | undefined;
      featureNoiseScale?: number | undefined;
      rayCount?: number | undefined;
      rayDistance?: number | undefined;
      coastalRayDistance?: number | undefined;
      wakeDistance?: number | undefined;
      beamWidth?: number | undefined;
      coastalSources?: number | undefined;
      coastalSourceDistance?: number | undefined;
      wakeSources?: number | undefined;
      coastalThreshold?: number | undefined;
      waveAmplification?: number | undefined;
      currentAmplification?: number | undefined;
      rayDecay?: number | undefined;
      rayIntensity?: number | undefined;
      wakeStrength?: number | undefined;
      conduitBudget?: number | undefined;
      fallenDensity?: number | undefined;
      fallenRelease?: number | undefined;
      strainCracking?: number | undefined;
      iceCracking?: number | undefined;
      iceCrackDepth?: number | undefined;
      frostCracking?: number | undefined;
      impactShock?: number | undefined;
      impactHeatShare?: number | undefined;
      placerMobility?: number | undefined;
      buryDepth?: number | undefined;
      reopenStrain?: number | undefined;
      reopenShare?: number | undefined;
      exhumedRelease?: number | undefined;
      fanBarrenEpochs?: number | undefined;
      fanBarrenDepth?: number | undefined;
      relictStrength?: number | undefined;
      iceCarry?: number | undefined;
      meltwaterLoss?: number | undefined;
      iceChargeSaturation?: number | undefined;
      thawSubsidence?: number | undefined;
      shelfSaturation?: number | undefined;
      stormFrontGradient?: number | undefined;
      standAge?: number | undefined;
      standCover?: number | undefined;
      peatDepth?: number | undefined;
      rootCost?: number | undefined;
      rootFloor?: number | undefined;
      springFlow?: number | undefined;
      springChargeSaturation?: number | undefined;
      springRock?: number | undefined;
      overdrawShare?: number | undefined;
      sinkDepth?: number | undefined;
      animalCarry?: number | undefined;
      strataShare?: number | undefined;
      organicChargeAffinity?: number | undefined;
      groveSap?: number | undefined;
      sapLoss?: number | undefined;
      forgeStrength?: number | undefined;
      forgeCooling?: number | undefined;
      saltPerDeath?: number | undefined;
      saltPerLakeMetre?: number | undefined;
      saltFull?: number | undefined;
      saltMaterialDensity?: number | undefined;
      brineFlush?: number | undefined;
      seepShare?: number | undefined;
      crustShare?: number | undefined;
      dissolveShare?: number | undefined;
      dustShare?: number | undefined;
      dustSettle?: number | undefined;
      glassBed?: number | undefined;
      glassResistance?: number | undefined;
      desiccation?: number | undefined;
      domeStrain?: number | undefined;
      domeRise?: number | undefined;
      domeSeep?: number | undefined;
      saltBurn?: number | undefined;
      tenureFull?: number | undefined;
      pilgrimageBonus?: number | undefined;
      lineFull?: number | undefined;
      roadFull?: number | undefined;
      wardReach?: number | undefined;
      auroraReinforce?: number | undefined;
      wardSpill?: number | undefined;
      tearFloor?: number | undefined;
      tearFull?: number | undefined;
      wildShift?: number | undefined;
      doorStrain?: number | undefined;
      doorDistance?: number | undefined;
      doorMatch?: number | undefined;
      wildRelief?: number | undefined;
      wildShuffle?: number | undefined;
      doorChill?: number | undefined;
      doorPool?: number | undefined;
      doorTravel?: number | undefined;
      knitVerdure?: number | undefined;
      holdSalting?: number | undefined;
    };
    stocks: {
      id: string;
      reservoir: string;
      carriers: (
        | "ice"
        | "river"
        | "crust"
        | "groundwater"
        | "wind"
        | "current"
        | "animal"
        | "people"
        | "door"
      )[];
    }[];
  }[];
  phase: "climate" | "post-glacial" | "society";
  strength: number;
  parameters: {
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
  effects: {
    heat: number;
    iceMelt: number;
    rockResistance: number;
    coastalForcing: number;
    quickening: number;
    conduitOpening: number;
    stillness: number;
    icePersistence: number;
    upwelling: number;
    seaSurface: number;
    wakeWarming: number;
    fog: number;
    storm: number;
    verdure: number;
    salting: number;
    warding: number;
    tearing: number;
    vegetationGrowth: number;
    fire: number;
    organicPreservation: number;
    animalToxicity: number;
    seedDispersal: number;
  };
  history: {
    retention: number;
    storage: number;
    advect: boolean;
  };
  features: {
    id: string;
    name: string;
    priority: number;
    seeds: {
      field: string;
      min?: number | undefined;
      max?: number | undefined;
      values?: number[] | undefined;
      salt?: number | undefined;
      index?: number | undefined;
    }[][];
    cartography?: "area" | "site" | "course" | undefined;
    retains?:
      | {
          field: string;
          min?: number | undefined;
          max?: number | undefined;
          values?: number[] | undefined;
          salt?: number | undefined;
          index?: number | undefined;
        }[][]
      | undefined;
    coverage?:
      | {
          field: string;
          floor: number;
          full: number;
        }
      | undefined;
  }[];
}[];
