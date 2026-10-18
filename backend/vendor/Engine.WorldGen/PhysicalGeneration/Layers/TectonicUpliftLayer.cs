namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class TectonicUpliftLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "tectonic-uplift",
        0x4f2b17,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.ContinentalSutures |
        PhysicalGeographyFacts.TectonicMargins |
        PhysicalGeographyFacts.ContinentalDomains,
        PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.OrogenicConstruction |
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.VolcanicConstruction |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Fractures |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Warmth |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.AtmosphericFlow |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var potential = map.ContinentalPotential[triangleIndex] / 1000d;
            var continentalFraction = map.CrustContinentalFraction[triangleIndex] / 1000d;
            var assemblySeparation = map.CrustAssemblySeparation[triangleIndex] / 1000d;
            var interiorRelief = InteriorRelief(map, context, triangleIndex);

            if (!context.IsEvolutionEpoch)
            {
                InitializeSurface(
                    map,
                    context,
                    triangleIndex,
                    continentalFraction,
                    interiorRelief - assemblySeparation);
            }

            var inherited = InheritedRelief(map, triangleIndex, context.Profile);
            var suture = map.CrustSutureStrength[triangleIndex] / 1000d;
            map.Uplift[triangleIndex] = (float)Math.Clamp(
                (potential * 0.32d) + (inherited * 0.30d) + (suture * 0.74d),
                0d,
                1.5d);
            map.RidgeInfluence[triangleIndex] = (float)Math.Clamp(
                Math.Max(suture * 0.92d, inherited * 0.52d),
                0d,
                1d);
        }
    }

    private static void InitializeSurface(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex,
        double continentalFraction,
        double reliefContribution)
    {
        var variation = PhysicalNoise.FractalNoise(
            map.Grid.TriangleX(triangleIndex),
            map.Grid.TriangleY(triangleIndex),
            context.Seed ^ 0x52c9,
            context.Profile.ElevationVariationScale,
            3) * context.Profile.ElevationVariationStrength;
        var thicknessUnits = CrustThicknessUnits(
            map,
            context,
            triangleIndex,
            continentalFraction,
            reliefContribution + variation);
        map.CrustThickness[triangleIndex] = PhysicalElevation.FromUnits(thicknessUnits);
        var baseElevation = PhysicalCrust.HeightUnits(thicknessUnits, continentalFraction) /
            context.Profile.ElevationScale;
        map.Elevation[triangleIndex] = PhysicalElevation.FromScaled(
            baseElevation,
            context.Profile.ElevationScale);
    }

    /// <summary>
    /// Crustal thickness, from which height follows by isostasy.
    ///
    /// The continental mask decides continental against oceanic, which is the
    /// one job a saturating field does well. Everything that varies inland has
    /// to come from somewhere that does not clamp, so province identity
    /// carries terrane thickness and the relief terms are converted into
    /// thickness rather than added to height.
    /// </summary>
    private static double CrustThicknessUnits(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex,
        double continentalFraction,
        double reliefContribution)
    {
        var mask = PhysicalCrust.OceanicThicknessUnits +
            ((PhysicalCrust.ContinentalThicknessUnits - PhysicalCrust.OceanicThicknessUnits) *
                continentalFraction);
        var buoyancy = PhysicalCrust.BuoyancyPerMille(continentalFraction) / 1000d;
        var reliefUnits = reliefContribution * context.Profile.ElevationScale / buoyancy;
        return PhysicalCrust.ClampThicknessUnits(
            mask + (ProvinceThicknessOffsetUnits(map, context, triangleIndex) * continentalFraction) +
                reliefUnits);
    }

    /// <summary>
    /// Per-terrane thickness. Scaled by continental potential so it fades out
    /// over ocean, where crust is oceanic regardless of which province it
    /// belongs to.
    /// </summary>
    private static double ProvinceThicknessOffsetUnits(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex)
    {
        var province = map.CrustProvinceIds[triangleIndex];
        if (province < 0)
        {
            return 0d;
        }

        var hash = PhysicalNoise.HashUnit(context.Seed ^ 0x3d7b, province, 0x51a9);
        return (hash - 0.5d) * 2d * PhysicalCrust.ProvinceThicknessRangeUnits;
    }

    /// <summary>
    /// Persistent interior height structure on continental crust: broad
    /// highlands/basins plus elongated mountain belts along the zero contours
    /// of an epoch-stable belt field. Keeps a strong differential everywhere so
    /// downstream processes never operate on a flat plateau.
    /// </summary>
    private static double InteriorRelief(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex)
    {
        var profile = context.Profile;
        var continentality = Math.Clamp(
            ((map.ContinentalPotential[triangleIndex] / 1000d) - 0.45d) / 0.25d,
            0d,
            1d);
        if (continentality <= 0d)
        {
            return 0d;
        }

        var x = map.Grid.TriangleX(triangleIndex);
        var y = map.Grid.TriangleY(triangleIndex);
        var macro = PhysicalNoise.FractalNoise(
            x,
            y,
            context.EpochStableSeed ^ 0x5ee1,
            profile.InteriorReliefScale,
            4) * profile.InteriorReliefStrength;
        if (macro < 0d)
        {
            // Basins stay but shallower than highlands are tall: the land
            // skews vertical without drowning half the interior in lakes.
            macro *= profile.InteriorBasinDepthShare / 1000d;
        }
        return continentality * macro;
    }

    private static double InheritedRelief(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile) =>
        Math.Clamp(
            map.TectonicActivityHistory[triangleIndex] /
                Math.Max(1d, profile.EpochTectonicElevationStep * 1.8d),
            0d,
            1d);

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.RidgeInfluence[triangleIndex] is < 0f or > 1f)
            {
                throw new InvalidOperationException("Tectonic ridge influence is outside its scalar range.");
            }
        }
    }

}
