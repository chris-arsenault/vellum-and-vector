using Atlas.Domain;
using NetTopologySuite.Geometries;

namespace Atlas.Generation;

public static class ConservativeSampling
{
    public static readonly HashSet<string> Stocks = ["ice", "groundwater", "surfaceStorage", "sediment", "rainfall", "snowfall", "suspendedSediment"];

    // Fields carry areal inventories. Integrate the parent's piecewise-constant control
    // volumes over the child's actual polygon rather than inventing or losing inventory
    // when sampling a denser lattice. Intensive terrain/climate values stay interpolated.
    public static double Average(SampledPatch source, string channel, Geometry support)
    {
        var result = RasterAverage(source, channel, support) * support.Area;
        if (channel is "sediment" or "surfaceStorage" && source.WaterIndex() is { } index)
            foreach (var (body, slice, shape) in index.Overlaps(support))
            {
                var overlap = support.Intersection(shape);
                if (overlap.Area == 0) continue;
                var value = channel == "sediment" ? slice.Sediment : Math.Max(0, LakeStorage.Level(body) - slice.Floor);
                result += (value - RasterAverage(source, channel, overlap)) * overlap.Area;
            }
        return result / support.Area;
    }

    private static double RasterAverage(SampledPatch source, string channel, Geometry support)
    {
        var dx = (source.Bounds[2] - source.Bounds[0]) / (source.Width - 1);
        var dy = (source.Bounds[3] - source.Bounds[1]) / (source.Height - 1);
        var envelope = support.EnvelopeInternal;
        var x0 = Math.Clamp((int)Math.Ceiling((envelope.MinX - source.Bounds[0]) / dx - .5), 0, source.Width - 1);
        var x1 = Math.Clamp((int)Math.Floor((envelope.MaxX - source.Bounds[0]) / dx + .5), 0, source.Width - 1);
        var y0 = Math.Clamp((int)Math.Ceiling((envelope.MinY - source.Bounds[1]) / dy - .5), 0, source.Height - 1);
        var y1 = Math.Clamp((int)Math.Floor((envelope.MaxY - source.Bounds[1]) / dy + .5), 0, source.Height - 1);
        double total = 0, area = 0;
        for (var y = y0; y <= y1; y++)
            for (var x = x0; x <= x1; x++)
            {
                var cell = Spatial.Read(Spatial.Rectangle(source.Bounds[0] + (x - .5) * dx, source.Bounds[1] + (y - .5) * dy, dx, dy));
                var weight = support.Intersection(cell).Area;
                total += source.Values[channel][y * source.Width + x] * weight; area += weight;
            }
        return area > 0 ? total / area : source.Sample(channel, new(support.Centroid.X, support.Centroid.Y));
    }
}
