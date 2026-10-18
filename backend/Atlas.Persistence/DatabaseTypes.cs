using Atlas.Domain;
using NetTopologySuite.Geometries;
using Npgsql;
using Position = Atlas.Domain.Position;

namespace Atlas.Persistence;

// PostgreSQL composites represent small typed value objects. Persistent entities,
// representations, relationships and grid channels live in separate tables.
internal sealed record DbTrait(string Field, int Kind, double Minimum, double Maximum, string? Cause, Geometry? Scope)
{
    public static DbTrait From(Trait v) => new(v.Field, (int)v.Kind, v.Minimum, v.Maximum, v.Cause, v.Scope is null ? null : Spatial.Read(v.Scope));
    public Trait Value() => new(Field, (TraitKind)Kind, Minimum, Maximum, Cause, Scope is null ? null : Spatial.Write(Scope));
}
internal sealed record DbSample(Position Point, string[] Channels, double[] Values)
{
    public static DbSample From(FieldSample v) => new(v.Point, v.Values.Keys.ToArray(), v.Values.Values.ToArray());
    public FieldSample Value() => new(Point, Channels.Zip(Values).ToDictionary(v => v.First, v => v.Second));
}
internal sealed record DbRing(DbSample[] Samples)
{
    public static DbRing[]? From(List<List<FieldSample>>? rings) => rings?.Select(r => new DbRing(r.Select(DbSample.From).ToArray())).ToArray();
    public static List<List<FieldSample>>? Values(DbRing[]? rings) => rings?.Select(r => r.Samples.Select(s => s.Value()).ToList()).ToList();
}
internal sealed record DbBoundary(int Version, Guid ParentId, long ParentVersion, Crossing[] Crossings,
    DbSample[] Samples, Epoch[] Epochs, DbRing[]? Rings, WaterFlux[]? WaterFluxes)
{
    public static DbBoundary? From(BoundaryContract? v) => v is null ? null : new(v.Version, v.ParentId, v.ParentVersion,
        v.Crossings.ToArray(), v.Samples.Select(DbSample.From).ToArray(), v.Epochs.ToArray(), DbRing.From(v.Rings), v.WaterFluxes?.ToArray());
    public BoundaryContract Value() => new(Version, ParentId, ParentVersion, Crossings.ToList(), Samples.Select(s => s.Value()).ToList(), Epochs.ToList(), DbRing.Values(Rings), WaterFluxes?.ToList());
}
internal sealed record DbRecipe(string[] Domains, int Seed, string Quality)
{
    public static DbRecipe? From(TemplateRecipe? v) => v is null ? null : new(v.Domains.ToArray(), v.Seed, v.Quality);
    public TemplateRecipe Value() => new(Domains.ToList(), Seed, Quality);
}
internal sealed record DbImpact(Guid[] Features, Guid[] Areas, string[] Layers, string[] Invalidations, bool HighImpact)
{
    public static DbImpact From(Impact v) => new(v.Features.ToArray(), v.Areas.ToArray(), v.Layers.ToArray(), v.Invalidations.ToArray(), v.HighImpact);
    public Impact Value() => new(Features.ToList(), Areas.ToList(), Layers.ToList(), Invalidations.ToList(), HighImpact);
}
internal sealed record DbRequirements(string[]? ContextKinds, DbTrait[]? Fields, double? MaximumSlope, bool StreetAccess)
{
    public static DbRequirements? From(TemplateRequirements? v) => v is null ? null : new(v.ContextKinds?.ToArray(), v.Fields?.Select(DbTrait.From).ToArray(), v.MaximumSlope, v.StreetAccess);
    public TemplateRequirements Value() => new(ContextKinds?.ToList(), Fields?.Select(f => f.Value()).ToList(), MaximumSlope, StreetAccess);
}
internal sealed record DbFieldBoundary(Geometry Footprint, DbSample[] Samples, DbRing[]? Rings)
{
    public static DbFieldBoundary? From(FieldBoundary? v) => v is null ? null : new(Spatial.Read(v.Footprint), v.Samples.Select(DbSample.From).ToArray(), DbRing.From(v.Rings));
    public FieldBoundary Value() => new(Spatial.Write(Footprint), Samples.Select(s => s.Value()).ToList(), DbRing.Values(Rings));
}
internal sealed record DbHumanEvent(string Kind, Guid Actor, Position Position, double Amount, Guid[] Causes)
{
    public static DbHumanEvent From(HumanEvent v) => new(v.Kind, v.Actor, v.Position, v.Amount, v.Causes.ToArray());
    public HumanEvent Value() => new(Kind, Actor, Position, Amount, Causes.ToList());
}

public static class AtlasDatabase
{
    public static NpgsqlDataSource Create(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.UseNetTopologySuite(handleOrdinates: Ordinates.XYZ);
        builder.MapComposite<Position>("atlas_position");
        builder.MapComposite<LocalFrame>("atlas_frame");
        builder.MapComposite<Epoch>("atlas_epoch");
        builder.MapComposite<HumanEra>("atlas_human_era");
        builder.MapComposite<DbTrait>("atlas_trait");
        builder.MapComposite<Crossing>("atlas_crossing");
        builder.MapComposite<DbSample>("atlas_sample");
        builder.MapComposite<DbRing>("atlas_ring");
        builder.MapComposite<WaterFlux>("atlas_water_flux");
        builder.MapComposite<DbBoundary>("atlas_boundary");
        builder.MapComposite<DbRecipe>("atlas_recipe");
        builder.MapComposite<DbImpact>("atlas_impact");
        builder.MapComposite<DbRequirements>("atlas_template_requirements");
        builder.MapComposite<DbFieldBoundary>("atlas_field_boundary");
        builder.MapComposite<PhysicalBudget>("atlas_budget");
        builder.MapComposite<DbHumanEvent>("atlas_human_event");
        return builder.Build();
    }
}
