using System.Text.Json.Nodes;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;

namespace Atlas.Domain;

public static class Spatial
{
    public const double PrecisionScale = 1_000_000;
    public static readonly PrecisionModel Precision = new(PrecisionScale);
    public static readonly GeometryFactory Factory = new NetTopologySuite.NtsGeometryServices(GeometryOverlay.NG).CreateGeometryFactory(Precision, 0);
    public static Geometry Read(JsonObject value)
    {
        Geometry result;
        try
        {
            result = new GeoJsonReader(Factory, new Newtonsoft.Json.JsonSerializerSettings()).Read<Geometry>(value.ToJsonString());
            result = NetTopologySuite.Precision.GeometryPrecisionReducer.Reduce(result, Precision);
            if (result is Polygon or MultiPolygon) result.Normalize();
        }
        catch (Exception e) when (e is Newtonsoft.Json.JsonException or ArgumentException or InvalidOperationException)
        { throw new DomainException("invalid_geometry", "Geometry must be valid OGC GeoJSON."); }
        Guard.Require(!result.IsEmpty && result.IsValid && result.Coordinates.All(c => double.IsFinite(c.X) && double.IsFinite(c.Y)),
            "invalid_geometry", "Geometry must be nonempty, finite and topologically valid.");
        return result;
    }

    public static JsonObject Write(Geometry geometry)
    {
        var quantized = NetTopologySuite.Precision.GeometryPrecisionReducer.Reduce(Factory.CreateGeometry(geometry), Precision);
        // Polygon ring starts/orientation are not semantic. Canonicalize them so
        // database round trips do not manufacture edits. Directed lines retain
        // their original vertex and component ordering.
        if (quantized is Polygon or MultiPolygon) quantized.Normalize();
        return JsonNode.Parse(new GeoJsonWriter().Write(quantized))!.AsObject();
    }
    public static Geometry Point(Position p)
    {
        var coordinate = new Coordinate(p.X, p.Y); Precision.MakePrecise(coordinate);
        return Factory.CreatePoint(coordinate);
    }
    public static Position Quantize(Position p)
    {
        var coordinate = new Coordinate(p.X, p.Y); Precision.MakePrecise(coordinate);
        return p with { X = coordinate.X, Y = coordinate.Y };
    }
    public static JsonObject Rectangle(double x, double y, double width, double height) =>
        Write(Factory.ToGeometry(new Envelope(x, x + width, y, y + height)));
    public static JsonObject Line(IEnumerable<Position> positions) =>
        Write(Factory.CreateLineString(positions.Select(p => new Coordinate(p.X, p.Y)).ToArray()));
    public static double[] Bounds(JsonObject geometry)
    {
        var e = Read(geometry).EnvelopeInternal;
        return [e.MinX, e.MinY, e.MaxX, e.MaxY];
    }

    public static List<Position> Crossings(JsonObject geometry, JsonObject footprint) =>
        Read(geometry).Intersection(Read(footprint).Boundary).Coordinates
            .Select(c => new Position(c.X, c.Y)).Distinct().ToList();

    public static JsonObject Transform(JsonObject geometry, LocalFrame frame)
    {
        var shape = (Geometry)Read(geometry).Copy();
        shape.Apply(new FrameFilter(frame));
        shape.GeometryChanged();
        return Write(shape);
    }

    private sealed class FrameFilter(LocalFrame frame) : ICoordinateSequenceFilter
    {
        public bool Done => false;
        public bool GeometryChanged => true;
        public void Filter(CoordinateSequence sequence, int i)
        {
            var p = frame.ToWorld(new(sequence.GetX(i), sequence.GetY(i)));
            sequence.SetX(i, p.X);
            sequence.SetY(i, p.Y);
            if (sequence.HasZ && double.IsFinite(sequence.GetZ(i)))
                sequence.SetOrdinate(i, Ordinate.Z, frame.Origin.Z + sequence.GetZ(i) * frame.MetresPerUnit);
        }
    }
}
