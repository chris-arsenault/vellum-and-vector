namespace Engine.Constants;

public static class EntityStatusCodes
{
    public const int Active = 1;
    public const int Historical = 2;
}

public static class PlaneCodes
{
    public const int None = 0;
    public const int Physical = 1;
    public const int Semantic = 2;
}

public static class PhysicalGeographyCodes
{
    public const int MicrotrianglesPerHex = 24;
    public const int MicrotrianglesPerSector = 4;
    public const int HexSectorCount = 6;

    public const int NoFlowEdge = -1;

    public const int HydrologyWater = 1 << 0;
    public const int HydrologyRiver = 1 << 1;
    public const int HydrologyCoast = 1 << 2;
}

public static class PhysicalLandformCodes
{
    public const int Plain = 1;
    public const int Slope = 2;
    public const int Valley = 3;
    public const int Basin = 4;
    public const int Ridge = 5;
    public const int Peak = 6;
    public const int Pass = 7;
    public const int Seabed = 8;
    public const int UValley = 9;
    public const int Cirque = 10;
    public const int Fjord = 11;
    public const int Moraine = 12;
    public const int OutwashPlain = 13;
    public const int ImpactBasin = 14;
    public const int ImpactRim = 15;
    public const int Gorge = 16;
    public const int Waterfall = 17;

    public const int Min = Plain;
    public const int Max = Waterfall;
}

/// <summary>
/// Directional crossing classes for a physical hex's crossing word: six hex
/// directions × 2 bits, in the HexCoord edge-mask direction order. The word
/// is immutable runtime geography; Open edges carry no bits, so a zero word
/// means an unremarkable hex.
/// </summary>
public static class PhysicalCrossingCodes
{
    public const int Open = 0;
    public const int River = 1;
    public const int Ridge = 2;
    public const int Cliff = 3;

    public const int BitsPerDirection = 2;
    public const int DirectionCount = 6;
    public const int ClassMask = 0b11;
    public const int WordMask = (1 << (BitsPerDirection * DirectionCount)) - 1;

    public static int ClassAt(int crossingWord, int direction) =>
        (crossingWord >> (direction * BitsPerDirection)) & ClassMask;

    public static int WithClass(int crossingWord, int direction, int crossingClass) =>
        (crossingWord & ~(ClassMask << (direction * BitsPerDirection))) |
        ((crossingClass & ClassMask) << (direction * BitsPerDirection));
}

/// <summary>
/// Packed per-hex geography field word: the discrete site flags. Gradient
/// facts live in the quantized fact columns (PhysicalHexFactCodes), never
/// as invented magnitude bands. Immutable runtime geography.
/// </summary>
public static class PhysicalHexFieldCodes
{
    public const int SummitFlag = 1 << 0;
    public const int ThermalFlag = 1 << 1;
    public const int AnomalyFlag = 1 << 2;
    public const int PolynyaFlag = 1 << 3;
    public const int CraterFlag = 1 << 4;

    public const int WordMask = (1 << 5) - 1;
}

/// <summary>
/// Quantized per-hex geography fact columns: the generated world's real
/// quantities carried into the kernel as bytes. Gameplay numbers (capacity,
/// placement scores, thresholds) are derived from these via authored
/// formulas; no consumer authors per-value rules against them.
/// </summary>
public static class PhysicalHexFactCodes
{
    public const int Temperature = 0;
    public const int Moisture = 1;
    public const int Geothermal = 2;
    public const int Elevation = 3;
    public const int Relief = 4;
    public const int Roughness = 5;
    public const int LandFraction = 6;
    public const int RiverCoverage = 7;
    public const int FloodplainCoverage = 8;
    public const int IceThickness = 9;
    public const int FireMean = 10;
    public const int FireMax = 11;
    public const int AuroraMean = 12;
    public const int AuroraMax = 13;
    public const int PressureMean = 14;
    public const int PressureMax = 15;

    public const int Count = 16;

    /// <summary>Quantizes an intensity-scale value (0..1000) to a byte.</summary>
    public static byte FromIntensity(int value) => ClampByte(value * 255 / 1000);

    /// <summary>Quantizes a triangle-count coverage (0..24) to a byte.</summary>
    public static byte FromCoverage(int triangles) =>
        ClampByte(triangles * 255 / PhysicalGeographyCodes.MicrotrianglesPerHex);

    /// <summary>
    /// Quantizes whole-unit elevation to a byte: offset so modest depths
    /// survive, eight units per step. Covers roughly -256..1784 units.
    /// </summary>
    public static byte FromElevation(int units) => ClampByte((units + 256) / 8);

    /// <summary>Quantizes non-negative relief/roughness units, four per step.</summary>
    public static byte FromReliefUnits(int units) => ClampByte(units / 4);

    private static byte ClampByte(int value)
    {
        if (value < 0)
        {
            return 0;
        }

        return value > 255 ? (byte)255 : (byte)value;
    }
}

/// <summary>
/// Placement taste axes: the hex vocabulary a kind's or culture's placement
/// taste may weight. Values are engine-generic; each axis normalizes its
/// underlying fact to 0..1 before the signed weight applies.
/// </summary>
public static class PlacementTasteAxisCodes
{
    public const int Capacity = 0;
    public const int Temperature = 1;
    public const int Moisture = 2;
    public const int Elevation = 3;
    public const int Relief = 4;
    public const int IceThickness = 5;
    public const int RiverCoverage = 6;
    public const int FireMean = 7;
    public const int AuroraMean = 8;
    public const int PressureMean = 9;
    public const int WaterFraction = 10;
    public const int CoastAdjacency = 11;

    public const int Count = 12;
}

public static class PhysicalLandmassClassCodes
{
    public const int None = 0;
    public const int Island = 1;
    public const int Continent = 2;

    public const int Min = None;
    public const int Max = Continent;
}

public static class PhysicalBathymetricZoneCodes
{
    public const int Land = 0;
    public const int ExposedShelf = 1;
    public const int Shelf = 2;
    public const int ShelfBreak = 3;
    public const int DeepOcean = 4;

    public const int Min = Land;
    public const int Max = DeepOcean;
}

public static class PhysicalWaterKindCodes
{
    public const int None = 0;
    public const int Ocean = 1;
    public const int Lake = 2;

    public const int Min = None;
    public const int Max = Lake;
}

public static class PhysicalGeographyFeatureCodes
{
    public const int GeothermalVent = 1 << 0;
    public const int PermanentSeaIce = 1 << 1;
    public const int PermanentIceMargin = 1 << 2;
    public const int FireCore = 1 << 3;
    public const int MagmaChamber = 1 << 4;
    public const int DeadGodLocus = 1 << 5;
    public const int MantlePlume = 1 << 6;
    public const int ImpactCenter = 1 << 7;
    public const int VolcanicCone = 1 << 8;
    public const int VolcanicCaldera = 1 << 9;
    public const int LavaPlain = 1 << 10;

    public const int All = GeothermalVent | PermanentSeaIce | PermanentIceMargin |
        FireCore | MagmaChamber | DeadGodLocus | MantlePlume | ImpactCenter |
        VolcanicCone | VolcanicCaldera | LavaPlain;
}

public static class BehaviorOperationCodes
{
    public const int AddAttribute = 1;
    public const int SetAttribute = 2;
    public const int MovePhysical = 3;
    public const int MoveSemantic = 4;
    public const int SetStatus = 6;
    public const int CreateRelationship = 7;
    public const int SetRelationshipStrength = 8;
    public const int AddTargetAttribute = 9;
    public const int TransferAttribute = 10;
    public const int MoveTowardTargetPhysical = 13;
    public const int WanderPhysical = 14;
    public const int MoveTowardTargetSemantic = 15;
    public const int WanderSemantic = 16;
    public const int CreateEntity = 17;
    public const int SetHistorical = 20;
    public const int AddRelatedEntitiesAttribute = 21;
    public const int CalculateVariable = 22;
    public const int AddAttributeFromVariable = 23;
    public const int AddTargetAttributeFromVariable = 24;
    public const int CreateFixedRelationship = 25;
    public const int CreateEndpointRelationship = 26;
    public const int SetEndpointRelationshipStrength = 27;
    public const int MoveTargetToSelfPhysical = 28;
    public const int SetTargetCoverageTerrain = 29;
    public const int RemoveEndpointRelationship = 30;
    public const int BuildTravelStructureLine = 31;
    public const int SetTargetCultureFromSelf = 32;
    public const int IncreaseWorkTier = 33;
    public const int ForgeCellVertical = 34;
    public const int CullEndpointIncomingRelationships = 35;
    public const int ErodeTargetCulture = 36;
    public const int InstallDistrict = 37;
    public const int ReawakenDistrict = 38;
    public const int DemoteStage = 39;
}

/// <summary>
/// Bonus kinds an installed artifact district can carry
/// (docs/design/artifact-districts.md).
/// </summary>
public static class DistrictBonusKindCodes
{
    public const int Healing = 1;
    public const int Culture = 2;
    public const int Road = 3;
}

public static class BehaviorTargetModeCodes
{
    public const int Self = 1;
    public const int AnyOther = 2;
    public const int KindOther = 3;
}

public static class BehaviorEndpointCodes
{
    public const int Self = 1;
    public const int Target = 2;
}

public static class GambitPreconditionDestinationCodes
{
    public const int Failed = 0;
    public const int Passed = -1;
}

public static class GambitRelationshipTargetDirectionCodes
{
    public const int Outgoing = 1;
    public const int Incoming = 2;
}

public static class BehaviorPreconditionCodes
{
    public const int TargetIsSelf = 1;
    public const int TargetIsNotSelf = 2;
    public const int SelfAttributeRange = 3;
    public const int TargetAttributeRange = 4;
    public const int PlaneDistance = 5;
    public const int Always = 7;
    public const int SelfHasRelationshipToTarget = 8;
    public const int TargetHasRelationshipToSelf = 9;
    public const int RelatedEntityMatchesTarget = 10;
    public const int RelationshipExists = 11;
    public const int EntityCountAtLeast = 12;
    public const int HasColocatedEntity = 13;
    public const int ContestedInfluence = 14;
    public const int SelfHasOutgoingRelationship = 15;
    public const int SharedInfluence = 16;
    public const int EndpointRelationshipCountBelow = 17;
    public const int EndpointCultureIs = 18;
    public const int SelfCultureMass = 19;
    public const int SelfWorkTierBelow = 20;
    public const int SelfHasOutgoingRelationshipToKind = 21;
    public const int EndpointSubtypeIs = 22;
    public const int WithinTravelReach = 23;
    public const int SelfHexFactRange = 24;
    public const int TargetHexFactRange = 25;
    public const int SelfOnTerrainGroup = 26;
    public const int CultureHoldsTech = 27;
}

public static class BehaviorExpressionCodes
{
    public const int Literal = 1;
    public const int SelfAttribute = 2;
    public const int TargetAttribute = 3;
    public const int Add = 6;
    public const int Subtract = 7;
    public const int Multiply = 8;
    public const int Divide = 9;
    public const int Min = 10;
    public const int Max = 11;
    public const int Clamp = 12;
    public const int Abs = 13;
    public const int Variable = 14;
    public const int Distance = 15;
    public const int SameCulture = 16;
}

public static class RelationshipTraversalDirectionCodes
{
    public const int Outgoing = 1;
    public const int Incoming = 2;
}

public static class RelationshipPolarityCodes
{
    public const int Positive = 0;
    public const int Negative = 1;
    public const int Neutral = 2;
}

public static class RelationshipMaintenanceConditionCodes
{
    public const int Always = 1;
    public const int SameCulture = 2;
    public const int DifferentCulture = 3;
    public const int PhysicalDistanceWithin = 4;
    public const int SemanticDistanceWithin = 5;
    public const int PhysicalCoPresence = 6;
    public const int SemanticCoPresence = 7;
    public const int SourceInfluenceAtTarget = 8;
    public const int TargetInfluenceAtSource = 9;
    public const int ContactMemory = 10;
}

public static class BehaviorEffectScopeCodes
{
    public const int SelfAttribute = 1;
    public const int TargetAttribute = 2;
    public const int Structural = 4;
    public const int Relational = 5;
}

public static class BehaviorProviderSelectorCodes
{
    public const int TargetAttribute = 1;
    public const int Structural = 2;
    public const int LocationAttribute = 4;
    public const int OutgoingRelationship = 5;
    public const int IncomingRelationship = 6;
}

public static class AffordanceSourceKindCodes
{
    public const int None = 0;
    public const int Generator = 1;
    public const int Gambit = 2;
}

public static class LowAltitudeAffordanceShapeCodes
{
    public const int PresenceNearEntity = 1;
    public const int RelationshipStrengthChange = 3;
    public const int InfluenceChange = 4;
}

public static class AffordancePolarityCodes
{
    public const int None = 0;
    public const int Strengthen = 1;
    public const int Weaken = 2;
    public const int Increase = 3;
    public const int Reduce = 4;
}

public static class LifecycleAgingModelCodes
{
    public const int Linear = 1;
    public const int LateLife = 2;
}

public static class EffectConditionCodes
{
    public const int RelationshipMapValueAtLocation = 1;
    public const int RelatedEntityDistance = 2;
    public const int LocalPositiveSignal = 3;
    public const int LocalNegativeSignal = 4;
    public const int LocalCrowdingLoadSignal = 5;
    public const int LocalComfortSignal = 6;
    public const int LocalCultureMapValue = 7;
    public const int CultureSlotOccupancy = 8;
    public const int CrowdingBeyondCultureSupport = 9;
    public const int InsideOwnedCoverage = 10;
    public const int BeyondCultureSupport = 11;
    public const int LocalSolitudeSignal = 12;
}

public static class RelationshipMatchDirectionCodes
{
    public const int Outgoing = 1;
    public const int Incoming = 2;
    public const int Either = 3;
}

public static class TraitEffectBearerCodes
{
    public const int Target = 1;
    public const int RelatedEntity = 2;
    public const int Actor = 3;
    public const int GambitTarget = 4;
}

public static class GeneratorStatusCodes
{
    public const int Eligible = 1;
    public const int Fired = 2;
    public const int EligibleNotSelected = 3;
    public const int Blocked = 4;
    public const int FireFailed = 5;
    public const int MissingDefinition = 6;
    public const int ZeroWeight = 8;
    public const int NotEvaluated = 9;
}

public static class GeneratorTargetRejectionReasonCodes
{
    public const int None = 0;
    public const int InactiveOrKind = 1;
    public const int Subtype = 2;
    public const int RequiredRelationship = 3;
    public const int RelationshipAbsence = 4;
    public const int Terrain = 5;
    public const int Trigger = 6;
    public const int SecondaryBinding = 7;
    public const int Placement = 8;
}

public static class GeneratorPlacementCodes
{
    public const int Area = 1;
    public const int Locality = 2;
    public const int Frontier = 3;
    public const int FeatureAnchor = 4;
}

/// <summary>
/// Discrete geological feature kinds, mirroring worldgen's identification
/// enum ordinals as carried through the blueprint.
/// </summary>
public static class PhysicalGeologicalFeatureKindCodes
{
    public const int RiverSystem = 0;
    public const int Lake = 1;
    public const int Range = 2;
    public const int Peak = 3;
    public const int Waterfall = 4;
    public const int Crater = 5;
    public const int Plain = 6;

    public const int Any = -1;
}

public static class GeneratorCultureMatchCodes
{
    public const int Any = 1;
    public const int SameAsTarget = 2;
    public const int DifferentFromTarget = 3;
}

/// <summary>How a produced entity's culture is decided at fire time.
/// Default resolves the authored fixed culture or the culture ref;
/// AnyParticipant draws deterministically among the distinct cultures of
/// the entities bound in the firing.</summary>
public static class GeneratorProducedCultureModeCodes
{
    public const int Default = 0;
    public const int AnyParticipant = 1;
}

public static class GeneratorCulturePlacementCodes
{
    public const int Ignore = 1;
    public const int PreferInheritedCulture = 2;
    public const int HostileIntrusion = 3;
    public const int CultureInterior = 4;
    public const int CultureFrontier = 5;
    public const int CultureRoute = 6;
    public const int Wilderness = 7;
}

public static class GeneratorCoverageModeCodes
{
    public const int None = 0;
    public const int CreateNew = 1;
    public const int SplitFromExisting = 2;
}

public static class KernelProgramCodes
{
    public const int Relationships = 3;
    public const int Generators = 5;
    public const int Gambits = 7;
    public const int Movement = 9;
    public const int LowAltitudeVerbs = 11;
    public const int Effects = 12;
    public const int CultureSlots = 14;
    public const int MinorActors = 15;
    public const int CultureFieldDecay = 17;
    public const int ChronicleDirector = 18;
    public const int WorldBeats = 19;
    public const int MapFrontier = 20;
    public const int Knowledge = 21;
}

public static class KnowledgeGrantDomainCodes
{
    public const int CultureProduction = 1;
    public const int CulturePersistence = 2;
    public const int VerbWeight = 3;
    public const int GeneratorFireWeight = 4;
    public const int GambitScore = 5;
    public const int GambitSuccess = 6;
    public const int MinorActorWork = 7;
    public const int MovementStepRate = 8;
    public const int RoadWork = 9;
    public const int RelationshipMaintenance = 10;
    public const int CarryingCapacity = 11;
    public const int Attraction = 12;
    public const int FrontierThawThreshold = 13;
    public const int FrontierReclaimThreshold = 14;
    public const int DecayTideResistance = 15;
}

/// <summary>The two regime tracks of the world's macro-chronicle.</summary>
public static class WorldBeatTrackCodes
{
    public const int World = 0;
    public const int Peoples = 1;
    public const int Count = 2;
}

public static class WorldBeatFactCodes
{
    public const int TicksSinceStart = 1;
    public const int ActiveEntitiesOfKind = 2;
    public const int LivingRelationshipsOfKind = 3;
    public const int CulledRelationshipsOfKind = 4;
    public const int TotalCultureRawMass = 5;
    public const int CultureMassGrowthPermille = 6;
    public const int LegendaryResolutions = 7;
}

public static class WorldBeatComparatorCodes
{
    public const int AtLeast = 1;
    public const int Below = 2;
}

public static class WorldBeatChargeDomainCodes
{
    public const int GeneratorFireWeight = 1;
    public const int VerbWeight = 2;
    public const int GambitScore = 3;
    public const int ContestDecayTide = 4;
    public const int GlobalDecayTide = 5;
    public const int GambitSuccess = 6;
    public const int MovementStepRate = 7;
}

public static class WorldBeatPhaseCodes
{
    public const int Opened = 1;
    public const int Closed = 2;
}

public static class ChronicleEventTypeCodes
{
    public const int Cast = 1;
    public const int Resolved = 3;
    public const int BeatStruck = 4;
}

public static class ChronicleConditionCodes
{
    public const int None = 0;
    public const int RolePairRelationship = 1;
    public const int RoleHistorical = 2;
    public const int Always = 3;
    public const int RolePairRelationshipAbsent = 4;
    public const int RoleAttributeBelow = 5;
    public const int HeatAtLeast = 6;
    public const int RolePairWithinDistance = 7;
    public const int RolePairBeyondDistance = 8;
    public const int RoleAttributeAtLeast = 9;
    public const int HeatBelow = 10;
}

public static class ChronicleStrikeCodes
{
    public const int None = 0;
    public const int RolePairGambit = 1;
    public const int OutsiderGambitOnRole = 2;
    public const int StateFact = 3;
    public const int RoleGambit = 4;
    public const int GeneratorOnRole = 5;
}

public static class ChroniclePendingKindCodes
{
    public const int GambitExecution = 0;
    public const int GeneratorFire = 1;
}

public static class MinorActorActionCodes
{
    public const int BuildCulture = 1;
    public const int RoadMaintenance = 2;
    public const int ContestCulture = 3;
}

public static class MinorActorRoleCodes
{
    public const int CulturalFront = 1;
    public const int RoadCrew = 2;
    public const int CampaignColumn = 3;
}

public static class MinorActorTargetingCodes
{
    public const int ExtendBorder = 1;
    public const int BridgeGap = 2;
    public const int ContestCulture = 3;
    public const int MaintainRoad = 4;
    public const int AdvanceCampaign = 5;
}

public static class MinorActorPostureCodes
{
    public const int Unassigned = 0;
    public const int Traveling = 1;
    public const int Working = 2;
    public const int Disrupted = 3;
}

public static class MinorActorEncounterCodes
{
    public const int None = 0;
    public const int FriendlySupport = 1;
    public const int HostileClash = 2;
    public const int CampaignDisruption = 3;
}

public static class MinorActorRetirementReasonCodes
{
    public const int SourceInvalid = 1;
    public const int BindingInvalid = 2;
    public const int NoAssignment = 3;
    public const int SourceRetired = 4;
}

public static class CultureSlotScoreSignalCodes
{
    public const int ActiveEntity = 1;
    public const int PhysicalInfluence = 2;
    public const int SemanticInfluence = 3;
    public const int PhysicalCoverage = 4;
    public const int SemanticCoverage = 5;
    public const int OutgoingRelationshipStrength = 6;
    public const int IncomingRelationshipStrength = 7;
    public const int PhysicalCultureSupport = 8;
    public const int SemanticCultureSupport = 9;
    public const int PhysicalInfluenceProduction = 10;
    public const int SemanticInfluenceProduction = 11;
}

public static class CultureFieldCellKindCodes
{
    public const int None = 0;
    public const int Interior = 1;
    public const int Border = 2;
    public const int Isolated = 3;
    public const int Contested = 4;
}

public static class CultureFieldStrengthBandCodes
{
    public const int None = 0;
    public const int Trace = 1;
    public const int Claimed = 2;
    public const int Controlled = 3;
    public const int Entrenched = 4;
    public const int Nexus = 5;
    public const int Strong = Controlled;
}

public static class MovementCauseCodes
{
    public const int Travel = 1;
    public const int Placement = 2;
    public const int Forced = 3;
    public const int Relocation = 4;
    public const int Follow = 5;
}

public static class ProgramDependencyLagCodes
{
    public const int SameTick = 1;
    public const int PreviousTick = 2;
}

public static class ProgramDependencyChannelCodes
{
    public const int MovementSurface = 3;
}

public static class TargetSelectorCodes
{
    public const int Explore = 1;
    public const int EntityKind = 2;
    public const int RelationshipTarget = 3;
    public const int Terrain = 4;
    public const int SelfMapValue = 5;
    public const int OtherMapValue = 6;
    public const int ChroniclePursuit = 7;
    public const int AttractorTrek = 8;
}

public static class ProgramOpcodeCodes
{
    public const int MoveActor = 1;
    public const int AddOwnedCellScalar = 2;
    public const int SubtractOtherCellScalar = 3;
    public const int TryClaimCell = 4;
    public const int TryRelocateEntity = 5;
    public const int AdjustRelationshipStrength = 6;
}

public static class LowAltitudeInfluenceTargetingCodes
{
    public const int None = 0;
    public const int Spread = 1;
    public const int Reinforce = 2;
    public const int Contest = 3;
}

public static class LowAltitudeVerbRelationshipDirectionCodes
{
    public const int Outgoing = 1;
    public const int Incoming = 2;
    public const int Either = 3;
}

public static class ProgramEnabledOverrideCodes
{
    public const int Unspecified = -1;
    public const int Disabled = 0;
    public const int Enabled = 1;
}

public static class ActionFamilyCodes
{
    public const int Gambit = 1;
    public const int LowAltitudeVerb = 2;
    public const int MinorActorWork = 3;
}

public static class TraceSubjectCodes
{
    public const int Goal = 1;
    public const int ActionSummary = 2;
    public const int TargetDetail = 3;
    public const int Support = 4;
    public const int Locality = 5;
    public const int MovementIntent = 6;
    public const int InfluenceIntent = 7;
    public const int RelationshipIntent = 8;
}

public static class TraceStatusCodes
{
    public const int None = 0;
    public const int Offered = 1;
    public const int BelowUrgency = 2;
    public const int OnCooldown = 3;
    public const int Disabled = 4;
    public const int NoTarget = 5;
    public const int NoReward = 6;
    public const int PreconditionFailed = 7;
    public const int Actionable = 8;
    public const int SupportSelected = 9;
    public const int Selected = 10;
    public const int CommittedByHysteresis = 11;
    public const int CapacityReached = 12;
}

public static class LowAltitudeVerbSelectionBucketCodes
{
    public const int None = 0;
    public const int Routine = 1;
    public const int Opportunity = 2;
}

public static class KernelCommandTypeCodes
{
    public const int None = 0;
    public const int NoOp = 1;
    public const int SetGeneratorEnabled = 2;
    public const int SetGambitEnabled = 3;
    public const int BlessCellCulture = 4;
    public const int FavorEntity = 5;
}

public static class KernelCommandRejectReasonCodes
{
    public const int None = 0;
    public const int StaleVersion = 1;
    public const int UnsupportedCommand = 2;
    public const int InvalidCommand = 3;
}

public static class GeneratorProgramConstants
{
    public const int TargetReferenceCode = 1;
    // Per-province fire-window width. The old single global scheduler ran saturated at
    // width 25; with every settled superregion running its own clock, the
    // per-province tempo is halved so world throughput lands near twice the
    // old rate at bootstrap settledness and grows with settled provinces.
    public const int DefaultFireWindowTicks = 50;
    public const int DefaultFiresPerWindow = 1;
    public const int DefaultPlacementMinRadius = 0;
    public const int DefaultPlacementMaxRadius = 5;
    public const int FarPlacementMinRadius = 20;
    public const int UnboundedPlacementMaxRadius = int.MaxValue;

    /// <summary>Sentinel for binding culture filters that resolve to the
    /// current leading culture (by active entity count) at query time.</summary>
    public const int LeaderCultureFilter = -1;
}

public static class GeneratorEffectTypeCodes
{
    public const int SetBindingHistorical = 1;
    public const int RemoveTargetRelationships = 2;
    public const int AdjustTargetRelationshipStrength = 3;
    public const int SetBindingTag = 5;
    public const int ClaimSemanticJurisdiction = 6;
    public const int ErodeCultureAtTarget = 7;
    public const int DemoteBindingStage = 8;
}

public static class GeneratorRelationshipInstanceSelectionCodes
{
    public const int AllTargetRelationships = 1;
    public const int TriggerRelationship = 2;
}

public static class TerrainKindProfileFieldCodes
{
    public const int InfluenceMultiplier = 1 << 0;
    public const int ClaimCostMultiplier = 1 << 1;
    public const int ClaimChanceMultiplier = 1 << 2;
}

public static class ProvenanceProducerKindCodes
{
    public const int Generator = 1;
    public const int Gambit = 2;
    public const int Action = 3;
    public const int System = 4;
}

public static class ProvenanceTriggerKindCodes
{
    public const int None = 0;
    public const int Entity = 1;
    public const int Relationship = 2;
    public const int Invocation = 3;
    public const int Attribute = 4;
}

public static class ProvenanceOutputKindCodes
{
    public const int EntityCreated = 1;
    public const int RelationshipChanged = 7;
}

public static class KernelCapacityCodes
{
    public const int GeneratorTargetTerrainRequirement = 3;
}
