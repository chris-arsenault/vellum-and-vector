namespace Engine.Constants;

public static class TickPhaseCodes
{
    public const int Startup = 0;
    public const int CommandAdmission = 1;
    public const int PrepareLocalView = 2;
    public const int EvaluateLocal = 3;
    public const int ResolveLocal = 4;
    public const int Strategic = 5;
    public const int Publish = 6;
}

public static class KernelRandomPurposeCodes
{
    public const int EntityAttributeDefault = 1;
    public const int EntityTraitAssignment = 2;
    public const int ForgeDirection = 3;
    public const int VerbScatterQ = 10;
    public const int VerbScatterR = 11;
    public const int VerbScatterSelection = 12;
    public const int VerbAttractorQ = 13;
    public const int VerbAttractorR = 14;
    public const int VerbCandidateSelection = 15;
    public const int VerbOpportunityBucket = 16;
    public const int VerbDuration = 17;
    public const int VerbRoutineSelection = 18;
    public const int VerbOpportunitySelection = 19;
    public const int VerbCoverageClaim = 20;
    public const int VerbHeadquartersMove = 21;
    public const int MovementDirection = 30;
    public const int MinorActorEncounter = 40;
    public const int LifecycleVariance = 50;
    public const int GambitSelection = 60;
    public const int GambitSuccess = 61;
    public const int GambitCooldown = 62;
    public const int ChronicleCasting = 70;
    public const int GeneratorFireSelection = 80;
    public const int GeneratorTargetSelection = 81;
    public const int GeneratorCreateChance = 82;
    public const int GeneratorSubtype = 83;
    public const int GeneratorPlacementTie = 84;
    public const int GeneratorMapEffect = 85;
    public const int GeneratorCadenceStart = 86;
    public const int GeneratorCadenceJitter = 87;
    public const int GeneratorSharedQuery = 88;
}
