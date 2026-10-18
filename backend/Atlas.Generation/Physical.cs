using Atlas.Domain;
using Engine.WorldGen;

namespace Atlas.Generation;

public static class Physical
{
    public static async Task<(FieldData Field, List<Feature> Rivers)> Generate(GenerationInput input, Guid jobId,
        Func<string, double, Task> stage, CancellationToken cancellation)
    {
        var area = input.World.Areas[input.Request.AreaId];
        if (area.ParentId is not null || input.Fields.Any(f => f.AreaId == area.Id && f.History is { Count: > 0 }))
            return await BoundedRefinement.Generate(input, jobId, stage, cancellation);
        var size = Registry.Resolution(input.Request.Quality);
        var count = size * size;
        var bounds = Spatial.Bounds(area.Footprint);
        var width = bounds[2] - bounds[0];
        var height = bounds[3] - bounds[1];
        await stage("Crust assembly and tectonic provinces", 0.02);
        cancellation.ThrowIfCancellationRequested();
        var profile = new PhysicalGeographyGenerationProfile
        {
            BoundaryPaddingSteps = size / 3,
            ExpectNaturalDiversity = !area.Traits.Any(t => t.Kind == TraitKind.Hard)
        };
        var constraints = new RootConstraints(area);
        var session = PhysicalGeographyEvolutionSession.Begin(count, input.Request.Seed, profile, constraints.Apply);
        var scale = Math.Sqrt(width * width + height * height) / (2 * session.Map.Grid.ContentRadius * 0.94);
        Position Locate(int i) => new(bounds[0] + width / 2 + session.Map.Grid.TriangleX(i) * scale,
            bounds[1] + height / 2 + session.Map.Grid.TriangleY(i) * scale);
        var epochs = area.Boundary?.Epochs ?? input.World.Epochs;
        var magicalHistory = new Dictionary<Guid, double[]>();
        var history = new List<FieldEpoch>();
        var initialSurface = Sample(session.Map, input, jobId, size, bounds, scale);
        for (var i = 0; i < epochs.Count; i++)
        {
            var e = epochs[i];
            session.BeginEpoch(new PhysicalGeographyEpochDefinition
            {
                StableName = e.Id,
                TectonicStrength = e.Tectonics,
                HydrologyStrength = e.Hydrology,
                GlaciationStrength = e.Ice,
                CoastalStrength = e.Coasts,
                TemperatureOffset = e.Temperature,
                SeaLevelOffset = e.SeaLevel
            }, epochs.Count);
            await Stage("Tectonics, volcanism and material history", session.ApplyGeology);
            Magic.Force(session.Map, input.World, Locate, i, magicalHistory);
            await Stage("Climate and atmospheric transport", session.ApplyClimate);
            await Stage("Drainage, fluvial erosion and sediment", session.ApplyHydrology);
            await Stage("Glaciation, ice flow and deposition", session.ApplyGlaciation);
            await Stage("Postglacial hydrology", session.ApplyPostGlacialReconciliation);
            session.MarkDomainForcingComplete();
            await Stage("Coastal erosion and history", session.ApplyCoastalEvolution);
            session.CompleteEpoch();
            var snapshot = Sample(session.Map, input, jobId, size, bounds, scale, magicalHistory);
            history.Add(new(e, new(bounds, size, size, snapshot.Values, snapshot.WaterBodies),
                input.World.Magic.Where(rule => rule.StartsAtEpoch <= i).Select(rule => rule.Id).ToList(), snapshot.Links));
            async Task Stage(string label, Action action)
            {
                cancellation.ThrowIfCancellationRequested();
                await stage($"{e.Id}: {label}", 0.1 + 0.65 * i / epochs.Count);
                action();
            }
        }
        await stage("Physical validation and geographic extraction", 0.8);
        cancellation.ThrowIfCancellationRequested();
        var map = session.Complete();
        var historicalIce = map.MaximumIceThickness.ToArray();
        PresentForcing.Apply(map, input.World, profile, Locate, magicalHistory);
        var field = Sample(map, input, jobId, size, bounds, scale, magicalHistory) with
        {
            History = history,
            Initial = new(bounds, size, size, initialSurface.Values, initialSurface.WaterBodies)
        };
        if (input.World.Magic.Any(rule => rule.StartsAtEpoch >= epochs.Count))
        {
            for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var p = field.PositionAt(x, y);
                    map.Grid.TryFindNearestTriangle((p.X - (bounds[0] + bounds[2]) / 2) / scale,
                        (p.Y - (bounds[1] + bounds[3]) / 2) / scale, out var index);
                    field.Values["glacialHistory"][y * size + x] = historicalIce[index] / 3d;
                }
        }
        foreach (var (id, intensity) in magicalHistory)
        {
            var data = new double[size * size];
            for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var p = field.PositionAt(x, y);
                    map.Grid.TryFindNearestTriangle((p.X - (bounds[0] + bounds[2]) / 2) / scale,
                        (p.Y - (bounds[1] + bounds[3]) / 2) / scale, out var index);
                    data[y * size + x] = intensity[index];
                }
            field.Values[$"magic:{id}"] = data;
            field.Values[$"magicApplied:{id}"] = data;
        }
        if (input.World.Magic.Count > 0)
        {
            var naturalWorld = AtlasJson.Clone(input.World);
            naturalWorld.Magic = [];
            var natural = await Generate(input with { World = naturalWorld }, jobId,
                (label, progress) => stage($"Natural reference: {label}", 0.85 + progress * 0.1), cancellation);
            foreach (var key in new[] { "temperature", "rock", "elevation" })
                field.Values[$"natural{char.ToUpperInvariant(key[0])}{key[1..]}"] = natural.Field.Values[key].ToArray();
        }
        var rivers = PhysicalFeatures.FromCanonry(map, input, jobId, Locate, scale);
        // Canonry owns the initial world solve. Regional response is for subsequent
        // edits and refinements; feeding a second drainage solve over its completed
        // world introduces a competing network at the same scale.
        var authored = input.Fields.Where(f => f.AreaId == area.Id).SelectMany(f => f.Authored ?? []).DistinctBy(p => p.Id).ToList();
        return (field with { Authored = authored }, rivers);
    }

    private static FieldData Sample(PhysicalGeographyField map, GenerationInput input, Guid jobId,
        int size, double[] bounds, double scale, Dictionary<Guid, double[]>? magicalHistory = null)
    {
        var keys = new[] { "elevation", "temperature", "moisture", "rainfall", "ice", "rock", "fracture", "erosion", "glacialHistory", "flow", "water",
            "bedrock", "sediment", "deposition", "glacialErosion", "glacialDeposition", "coastalErosion", "geothermal", "geothermalHistory",
            "uplift", "volcanicHistory", "impactExcavation", "impactRim", "ejecta", "province", "crustType", "crustAge", "motionX", "motionY",
            "tectonicStrain", "tectonicHistory", "runoff", "windX", "windY", "landform", "waterDepth", "waterSurface", "surfaceStorage", "snowfall", "oceanCurrentX", "oceanCurrentY", "advectionX", "advectionY", "carbonate" };
        var values = keys.Concat(RegionalMagic.Channels(input.World)).Distinct().ToDictionary(k => k, _ => new double[size * size]);
        var field = new FieldData(Registry.Identity(jobId, "physical-field"), input.Request.AreaId, bounds, size, size, values, "canonry-0f62584", input.Request.Seed);
        for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var p = field.PositionAt(x, y);
                var gx = (p.X - (bounds[0] + bounds[2]) / 2) / scale;
                var gy = (p.Y - (bounds[1] + bounds[3]) / 2) / scale;
                Guard.Require(map.Grid.TryFindNearestTriangle(gx, gy, out var i), "projection_coverage", "The physical lattice must cover the complete world domain.");
                var j = y * size + x;
                values["elevation"][j] = (map.Elevation[i] - map.BaseSeaLevel) / 1024d;
                values["temperature"][j] = map.Temperature[i];
                values["moisture"][j] = map.Moisture[i];
                values["rainfall"][j] = map.Rainfall[i];
                values["ice"][j] = map.IceThickness[i] / 3d;
                values["rock"][j] = map.RockResistance[i];
                values["fracture"][j] = map.FractureConductance[i];
                values["erosion"][j] = map.CumulativeFluvialErosion[i] / 1024d;
                values["glacialHistory"][j] = map.MaximumIceThickness[i] / 3d;
                values["flow"][j] = map.FlowAccumulation[i] * 1.2990381057 * scale * scale * .001 / RegionalGrid.SecondsPerYear;
                values["water"][j] = map.WaterKindCodes[i];
                values["bedrock"][j] = (map.BedrockElevation[i] - map.BaseSeaLevel) / 1024d;
                values["sediment"][j] = map.SedimentThickness[i] / 1024d;
                values["deposition"][j] = map.CumulativeDeposition[i] / 1024d;
                values["glacialErosion"][j] = map.CumulativeGlacialErosion[i] / 1024d;
                values["glacialDeposition"][j] = map.CumulativeGlacialDeposition[i] / 1024d;
                values["coastalErosion"][j] = map.CumulativeCoastalErosion[i] / 1024d;
                values["geothermal"][j] = map.Geothermal[i];
                values["geothermalHistory"][j] = map.GeothermalHistory[i];
                values["uplift"][j] = map.OrogenicConstruction[i] / 1024d;
                values["volcanicHistory"][j] = map.VolcanicConstructionHistory[i] / 1024d;
                values["impactExcavation"][j] = map.ImpactExcavation[i] / 1024d;
                values["impactRim"][j] = map.ImpactRimUplift[i] / 1024d;
                values["ejecta"][j] = map.ImpactEjectaThickness[i] / 1024d;
                values["province"][j] = map.CrustProvinceIds[i];
                values["crustType"][j] = map.CrustTypeCodes[i];
                values["crustAge"][j] = map.CrustAge[i];
                values["motionX"][j] = map.CrustMotionX[i];
                values["motionY"][j] = map.CrustMotionY[i];
                values["tectonicStrain"][j] = map.TectonicStrain[i];
                values["tectonicHistory"][j] = map.TectonicActivityHistory[i];
                values["runoff"][j] = map.Runoff[i];
                values["windX"][j] = map.WindX[i];
                values["windY"][j] = map.WindY[i];
                values["snowfall"][j] = map.Snowfall[i];
                values["landform"][j] = map.LandformCodes[i];
                values["waterDepth"][j] = map.WaterDepths[i] / 1024d;
                values["surfaceStorage"][j] = map.WaterKindCodes[i] == 2 ? values["waterDepth"][j] : 0;
                values["waterSurface"][j] = map.WaterSurfaceElevations[i] == long.MinValue ? values["elevation"][j] : (map.WaterSurfaceElevations[i] - map.BaseSeaLevel) / 1024d;
                values["oceanCurrentX"][j] = map.OceanCurrentX[i];
                values["oceanCurrentY"][j] = map.OceanCurrentY[i];
                var source = Math.Max(0, map.AdvectionSourceIndex[i]);
                values["advectionX"][j] = (bounds[0] + bounds[2]) / 2 + map.Grid.TriangleX(source) * scale;
                values["advectionY"][j] = (bounds[1] + bounds[3]) / 2 + map.Grid.TriangleY(source) * scale;
                values["carbonate"][j] = Math.Clamp((map.CumulativeDeposition[i] + map.SedimentThickness[i]) /
                    (double)Math.Max(1, map.CumulativeDeposition[i] + map.SedimentThickness[i] + map.VolcanicConstructionHistory[i] + map.ImpactEjectaThickness[i] + 1024), 0, 1);
                foreach (var rule in input.World.Magic)
                {
                    var intensity = magicalHistory?.GetValueOrDefault(rule.Id)?[i] ?? 0;
                    values[$"magic:{rule.Id}"][j] = values[$"magicApplied:{rule.Id}"][j] = intensity;
                    values[$"magicStored:{rule.Id}"][j] = intensity * rule.Storage * (1 - rule.Decay) *
                        (rule.Propagation == "cold" ? values["ice"][j] / (1 + values["ice"][j]) : 1);
                    var target = rule.Effect switch { "heat" or "cold" => "magicHeat", "hardening" => "magicHardening", "coastal" => "magicCoastal", _ => "magicPotential" };
                    values[target][j] += rule.Effect is "cold" or "gravity" ? -intensity : intensity;
                }
                values["naturalTemperature"][j] = values["temperature"][j] - values["magicHeat"][j];
                values["naturalRock"][j] = values["rock"][j] - values["magicHardening"][j];
                values["naturalElevation"][j] = values["elevation"][j];
            }
        var links = new List<FlowLink>();
        var dischargeScale = 1.2990381057 * scale * scale * .001 / RegionalGrid.SecondsPerYear;
        for (var i = 0; i < map.Grid.TriangleCount; i++)
        {
            if (map.FlowEdges[i] < 0 || map.FlowAccumulation[i] <= 0) continue;
            var target = map.Grid.NeighborTriangleIndex(i, map.FlowEdges[i]);
            if (target < 0) continue;
            Position Locate(int index) => new((bounds[0] + bounds[2]) / 2 + map.Grid.TriangleX(index) * scale,
                (bounds[1] + bounds[3]) / 2 + map.Grid.TriangleY(index) * scale);
            links.Add(new(Registry.Identity(input.World.Id, $"flow:{map.Grid.TriangleIdentity(i)}"), Locate(i), Locate(target),
                map.FlowAccumulation[i] * dischargeScale, map.WaterKindCodes[i] == 0 && (map.RiverOrders[i] > 0 || map.FlowAccumulation[i] * dischargeScale >= .16)));
        }
        Position Location(int index) => new((bounds[0] + bounds[2]) / 2 + map.Grid.TriangleX(index) * scale,
            (bounds[1] + bounds[3]) / 2 + map.Grid.TriangleY(index) * scale);
        var bodies = PhysicalFeatures.WaterFeatures(map, input, jobId, Location, scale)
            .Select(LakeStorage.FromFeature).OfType<WaterBodyState>().ToList();
        return field with { Links = links, WaterBodies = bodies };
    }

}
