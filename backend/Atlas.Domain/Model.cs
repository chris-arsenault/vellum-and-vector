using System.Text.Json.Nodes;

namespace Atlas.Domain;

public enum Profile { World, Region, Local, Site, Interior }
public enum Materialization { Unmaterialized, Generated, Authored, Protected, IntentionallyEmpty, Stale }
public enum TraitKind { Hard, Tendency, Derived, Exception }

public sealed record Position(double X, double Y, double Z = 0);
public sealed record LocalFrame(Position Origin, double Rotation = 0, double MetresPerUnit = 1, string? Floor = null)
{
    public Position ToWorld(Position local)
    {
        Validate();
        var angle = Rotation * Math.PI / 180;
        return new(Origin.X + MetresPerUnit * (local.X * Math.Cos(angle) - local.Y * Math.Sin(angle)),
            Origin.Y + MetresPerUnit * (local.X * Math.Sin(angle) + local.Y * Math.Cos(angle)),
            Origin.Z + local.Z * MetresPerUnit);
    }

    public Position FromWorld(Position world)
    {
        Validate();
        var angle = Rotation * Math.PI / 180;
        var x = (world.X - Origin.X) / MetresPerUnit;
        var y = (world.Y - Origin.Y) / MetresPerUnit;
        return new(x * Math.Cos(angle) + y * Math.Sin(angle),
            -x * Math.Sin(angle) + y * Math.Cos(angle), (world.Z - Origin.Z) / MetresPerUnit);
    }

    public void Validate() => Guard.Require(double.IsFinite(MetresPerUnit) && MetresPerUnit > 0 &&
        double.IsFinite(Rotation) && double.IsFinite(Origin.X) && double.IsFinite(Origin.Y) &&
        double.IsFinite(Origin.Z), "invalid_frame", "A frame needs finite coordinates and positive unit scale.");
}

public sealed record SpatialReference(string Id, JsonObject Domain, string Topology = "planar",
    string Units = "metre", string Axes = "east,north,up", string VerticalDatum = "world-sea-level", int Version = 1, double Precision = 0.000001);
public sealed record Trait(string Field, TraitKind Kind, double Minimum, double Maximum,
    string? Cause = null, JsonObject? Scope = null);
public sealed record Epoch(string Id, int Tectonics = 700, int Hydrology = 800, int Ice = 300,
    int Coasts = 700, int Temperature = 0, int SeaLevel = 0);
public sealed record HumanEra(string Id, int Years = 200, string? PhysicalEpoch = null, double Mobility = 1, double PoliticalCapacity = 1);
public sealed record HumanEvent(string Kind, Guid Actor, Position Position, double Amount, List<Guid> Causes);
public sealed record HumanSnapshot(HumanEra Era, SampledPatch Surface, List<HumanEvent> Events);
public sealed record Crossing(Guid FeatureId, Position Point, string Kind, double Flow = 0, double Elevation = 0,
    string Direction = "undirected", Guid? NodeId = null, Guid? ReceivingFeatureId = null, double FlowUncertainty = 0,
    double? FlowMinimum = null, double? FlowMaximum = null);
public sealed record FieldSample(Position Point, Dictionary<string, double> Values);
public sealed record WaterFlux(Guid Id, Position Point, Position Direction, double Rate, string Crossing);
public sealed record BoundaryContract(int Version, Guid ParentId, long ParentVersion,
    List<Crossing> Crossings, List<FieldSample> Samples, List<Epoch> Epochs, List<List<FieldSample>>? Rings = null, List<WaterFlux>? WaterFluxes = null);
public sealed record Representation(JsonObject Geometry, Materialization State, string Actor, Guid? GenerationId = null,
    JsonObject? Attributes = null, bool Protected = false, bool NeedsReconciliation = false);
public sealed record Relation(Guid TargetId, string Kind);
public sealed record ConnectionEnd(Guid AreaId, Position Position, Guid? FeatureId = null);
public sealed record Connection(Guid Id, string Kind, ConnectionEnd A, ConnectionEnd B, double Flow = 0);
public sealed record NetworkNode(Guid Id, string Kind, Position Position, Guid? SpaceId, double? WaterLevel = null);
public sealed record NetworkReach(Guid Id, Guid FeatureId, Guid Start, Guid End, JsonObject Geometry, double Flow = 0, double? EndFlow = null);
public sealed record WaterTransfer(Guid FeatureId, Position Position, double Rate, Guid StorageId, Guid FieldId);

public sealed class Area
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ParentId { get; set; }
    public required string Name { get; set; }
    public Profile Profile { get; set; }
    public required JsonObject Footprint { get; set; }
    public required LocalFrame Frame { get; set; }
    public BoundaryContract? Boundary { get; set; }
    public List<Trait> Traits { get; set; } = [];
    public List<Trait>? LocalTraits { get; set; }
    public Dictionary<string, Materialization> Layers { get; set; } = [];
    public long Version { get; set; } = 1;
    public Guid? TemplateId { get; set; }
    public string Context { get; set; } = "landscape";
    public Guid? ContextFeatureId { get; set; }
    public Guid? TemplateInstanceId { get; set; }
    public TemplateRecipe? Recipe { get; set; }
    public Guid? RecipeJobId { get; set; }
}

public sealed class Feature
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public required string Kind { get; set; }
    public required string LayerId { get; set; }
    public required Guid AreaId { get; set; }
    public required JsonObject Geometry { get; set; }
    public Dictionary<Guid, Representation> Detail { get; set; } = [];
    public JsonObject Attributes { get; set; } = [];
    public List<Relation> Relations { get; set; } = [];
    public Materialization State { get; set; } = Materialization.Authored;
    public bool Protected { get; set; } = true;
    public string Actor { get; set; } = "user";
    public Guid? GenerationId { get; set; }
    public string? GenerationDomain { get; set; }
    public List<string> Causes { get; set; } = [];
}

public sealed record Layer(string Id, string Name, string Family, string Representation,
    string Color, List<Profile> Profiles, JsonObject Schema, string? Generator = null);
public sealed record Entity(Guid Id, string Name, string Kind, JsonObject Attributes, List<Relation> Relations, Materialization State = Materialization.Authored);
public sealed record FieldReference(Guid Id, Guid AreaId, string LayerId, string Algorithm, Guid JobId, int Samples, List<string>? Channels = null);
public sealed record GenerationRecord(Guid Id, Guid AreaId, int Seed, string Algorithm,
    string Quality, List<string> Domains, int BoundaryVersion, List<Epoch> Epochs,
    DateTimeOffset CompletedAt, List<string> Warnings);
public sealed record MagicRule(Guid Id, string Name, Position Source, double Radius, double Strength,
    string Propagation, string Effect, double Decay = 0.2, double Storage = 0,
    List<Guid>? DependsOn = null, JsonObject? Scope = null, int StartsAtEpoch = 0);
public sealed record Template(Guid Id, string Name, Profile Profile, List<Profile> ParentProfiles,
    JsonObject Footprint, List<Feature> Features, List<Trait> Traits, LocalFrame Frame,
    string Units = "metre", List<Entity>? Entities = null, List<Layer>? Layers = null,
    List<TemplateSocket>? Sockets = null, TemplateRequirements? Requirements = null,
    TemplateRecipe? Recipe = null, List<TemplateSpace>? Spaces = null, long Version = 1, string Context = "structure");
public sealed record TemplateSocket(string Id, Guid FeatureId, Position Position, string Kind = "entrance", bool Required = false,
    List<string>? TargetKinds = null, Guid? SpaceId = null, string? ConnectsTo = null);
public sealed record TemplateRequirements(List<string>? ContextKinds = null, List<Trait>? Fields = null, double? MaximumSlope = null, bool StreetAccess = false);
public sealed record TemplateRecipe(List<string> Domains, int Seed = 1, string Quality = "standard");
public sealed record TemplateSpace(Guid Id, string Name, JsonObject Footprint, LocalFrame Frame);
public sealed record MapLayerStyle(string LayerId, bool Visible, double Opacity, string Color, double MinScale = 0,
    bool Labels = false, string? Filter = null);
public sealed record MapView(Guid Id, string Name, Guid AreaId, List<MapLayerStyle> Layers);

public sealed class World
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public string Owner { get; set; } = "local";
    public int Seed { get; set; }
    public long Version { get; set; } = 1;
    public required SpatialReference Reference { get; set; }
    public Dictionary<Guid, Area> Areas { get; set; } = [];
    public Dictionary<Guid, Feature> Features { get; set; } = [];
    public Dictionary<string, Layer> Layers { get; set; } = BuiltinLayers.Create();
    public Dictionary<Guid, Entity> Entities { get; set; } = [];
    public Dictionary<Guid, Template> Templates { get; set; } = [];
    public List<FieldReference> Fields { get; set; } = [];
    public List<GenerationRecord> Generations { get; set; } = [];
    public List<MagicRule> Magic { get; set; } = [];
    public List<HumanEra> HumanEras { get; set; } = [new("settlement", 200, PoliticalCapacity: .65), new("expansion", 400, PoliticalCapacity: 1.2), new("present", 150, PoliticalCapacity: .8)];
    public List<MapView> Views { get; set; } = [];
    public Dictionary<Guid, Connection> Connections { get; set; } = [];
    public Dictionary<Guid, NetworkNode> NetworkNodes { get; set; } = [];
    public Dictionary<Guid, NetworkReach> NetworkReaches { get; set; } = [];
    public Dictionary<Guid, List<WaterTransfer>> WaterTransfers { get; set; } = [];
    public List<Epoch> Epochs { get; set; } = [new("assembly"), new("wet-erosion", 600, 1000, 100),
        new("glacial-maximum", 250, 700, 900, Temperature: -120), new("present", 100, 800, 250)];
}

public sealed class DomainException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public static class Guard
{
    public static void Require(bool condition, string code, string message)
    {
        if (!condition) throw new DomainException(code, message);
    }
}
